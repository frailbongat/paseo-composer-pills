/**
 * Client-only store for the GitHub ticket an agent is working on.
 *
 * The ticket comes out of the agent's own timeline, not out of an agent label,
 * so an agent typed by hand gets the same pill as one a board dispatched. Both
 * carry the issue URL in their opening prompt, and that text is the whole
 * source: nothing here calls the network or `gh` to name an issue.
 */

export interface Ticket {
  readonly owner: string;
  readonly repo: string;
  readonly number: number;
  /** Rebuilt from the parts, so query strings and stray punctuation are dropped. */
  readonly url: string;
  /** `Route` for a `/skill:route` prompt, else null. */
  readonly command: string | null;
}

/**
 * A GitHub issue or pull request URL inside a prompt.
 *
 * Written to survive what people actually paste: a markdown link, angle
 * brackets, `?query` and `#fragment`, a trailing slash, a full stop at the end
 * of the sentence. The number is `[1-9]\d*`, so `/issues/0` and `/issues/012`
 * never match at all rather than drawing a half-parsed pill, and the trailing
 * lookahead keeps `/issues/112abc` from reading as 112.
 */
const TICKET_URL =
  /https?:\/\/(?:www\.)?github\.com\/([A-Za-z0-9][A-Za-z0-9._-]*)\/([A-Za-z0-9][A-Za-z0-9._-]*)\/(issues|pull)\/([1-9]\d*)(?![\w-])/gi;

/**
 * Words that name the link as the work itself: "The ticket is <url>".
 *
 * A dispatched prompt can cite two tickets, and the first one is not always the
 * one being worked: a skill invoked on a map or spec carries the parent on the
 * command line and names the real ticket in the sentence under it.
 */
const WORK_CUE =
  /\b(?:ticket|issue|resolve[sd]?|fix(?:es|ing)?|close[sd]?|implement(?:s|ing)?|work(?:ing)? on)\b/gi;

/** Words that name the link as the ground around the work, not the work. */
const CONTEXT_CUE =
  /\b(?:parent(?: (?:issue|ticket))?|sub-?issue of|part of|map|spec|epic|tracked by|tracking|blocked by|blocks|depends on|related|see also|context|background|follow(?:s|-?up)? from)\b/gi;

/** A line that is nothing but a slash command, so its argument reads neutral. */
const BARE_COMMAND = /^\/[\w.:-]+\s*$/;

/** A sentence ends at `.`, `!` or `?` only when whitespace follows, never mid-URL. */
const SENTENCE_END = /[.!?](?=\s)|\n/g;

/** Where a pattern last matches, or -1. The cues are ranked by which is nearer. */
function lastMatch(pattern: RegExp, text: string): number {
  pattern.lastIndex = 0;
  let last = -1;
  for (let hit = pattern.exec(text); hit !== null; hit = pattern.exec(text)) last = hit.index;
  return last;
}

/**
 * The message with every GitHub link blanked out, same length so match offsets
 * still line up. A URL carries the word `issues` and a pile of full stops, both
 * of which would otherwise read as sentence text about the next link.
 */
function maskUrls(text: string): string {
  return text.replace(TICKET_URL, (url) => " ".repeat(url.length));
}

/**
 * How strongly the sentence around a link claims it is the ticket: 2 named as
 * the work, 1 unmarked, 0 named as context. The window stops at the previous
 * sentence or line break, so "Work through that map. The ticket is <url>" reads
 * the second sentence only and the map does not drag the ticket down with it.
 */
function citationRank(masked: string, index: number): number {
  const before = masked.slice(0, index);

  let boundary = -1;
  SENTENCE_END.lastIndex = 0;
  for (let hit = SENTENCE_END.exec(before); hit !== null; hit = SENTENCE_END.exec(before)) {
    boundary = hit.index;
  }
  const sentence = before.slice(boundary + 1);

  // The argument of `/skill:wayfinder <url>` is whatever the skill was pointed
  // at, which says nothing about whether it is the ticket. A skill named after
  // a cue word, `/skill:implement`, must not promote its own argument.
  if (BARE_COMMAND.test(sentence.trim())) return 1;

  const context = lastMatch(CONTEXT_CUE, sentence);
  // Context words are blanked before the work scan because the two overlap:
  // "sub-issue of" contains `issue` and means the opposite of it. What is left
  // is ranked by which cue sits nearer the link, so a sentence carrying both,
  // "context: <a>, the ticket is <b>", reads each link by the words next to it.
  const plain = sentence.replace(CONTEXT_CUE, (cue) => " ".repeat(cue.length));

  if (lastMatch(WORK_CUE, plain) > context) return 2;
  return context === -1 ? 1 : 0;
}

/** `/skill:route`, `/route`, `/ship-check`. Anything else is not a command. */
const SLASH_COMMAND = /^\/([A-Za-z][\w.-]*(?::[\w.-]+)*)/;

/** A git remote, in either `git@github.com:owner/repo.git` or URL form. */
const REMOTE_SLUG =
  /github\.com[:/]([A-Za-z0-9][A-Za-z0-9._-]*)\/([A-Za-z0-9][A-Za-z0-9._-]*?)(?:\.git)?\/*$/i;

/**
 * The skill a prompt invoked, titled for the pill. Without the board's `kind`
 * label this is the only thing in the message that names the work, so
 * `/skill:route` reads as `Route` and `/ship-check` as `Ship Check`.
 */
function commandTitle(text: string): string | null {
  const match = SLASH_COMMAND.exec(text.trimStart());
  if (match === null) return null;

  const name = match[1].split(":").pop() ?? "";
  const words = name.split(/[-_.]+/).filter((word) => word.length > 0);
  if (words.length === 0) return null;

  return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
}

/**
 * The ticket one user message is about, or null when it cites none.
 *
 * Every GitHub link in the message is read, not just the first, because a
 * prompt that hands an agent a map or a spec cites the parent first and the
 * ticket second. The best-claimed link wins, and ties go to the earliest, so a
 * message that marks nothing behaves exactly as it did before.
 */
export function parseTicket(text: string): Ticket | null {
  const command = commandTitle(text);
  const masked = maskUrls(text);
  let best: Ticket | null = null;
  let bestRank = -1;

  for (const match of text.matchAll(TICKET_URL)) {
    const [, owner, repo, kind, digits] = match;
    const number = Number.parseInt(digits, 10);
    if (!Number.isSafeInteger(number) || number <= 0) continue;

    const rank = citationRank(masked, match.index);
    if (rank <= bestRank) continue;

    bestRank = rank;
    best = {
      owner,
      repo,
      number,
      url: `https://github.com/${owner}/${repo}/${kind.toLowerCase()}/${number}`,
      command,
    };
    // Nothing outranks a link the prompt calls the ticket.
    if (rank === 2) break;
  }

  return best;
}

/** `owner/repo`, lowercased for comparison, from an agent's project placement. */
export function repoSlugFromProject(project: unknown): string | null {
  if (!project || typeof project !== "object") return null;
  const checkout = (project as Record<string, unknown>).checkout;
  if (!checkout || typeof checkout !== "object") return null;

  const remoteUrl = (checkout as Record<string, unknown>).remoteUrl;
  if (typeof remoteUrl !== "string") return null;

  const match = REMOTE_SLUG.exec(remoteUrl.trim());
  return match === null ? null : `${match[1]}/${match[2]}`.toLowerCase();
}

const ticketByAgent = new Map<string, Ticket>();
/** The repo the agent is checked out on, so a cross-repo link can say so. */
const repoByAgent = new Map<string, string>();

export function readTicket(agentId: string): Ticket | null {
  return ticketByAgent.get(agentId) ?? null;
}

/** First match wins and sticks, so a ticket already recorded is never replaced. */
export function writeTicket(agentId: string, ticket: Ticket): void {
  if (ticketByAgent.has(agentId)) return;
  ticketByAgent.set(agentId, ticket);
}

export function writeAgentRepo(agentId: string, slug: string): void {
  repoByAgent.set(agentId, slug);
}

export function clearTicket(agentId: string): void {
  ticketByAgent.delete(agentId);
  repoByAgent.delete(agentId);
}

export function clearAllTickets(): void {
  ticketByAgent.clear();
  repoByAgent.clear();
}

/**
 * Pill text, computed outside React so the entrypoint can push it with `update`.
 *
 * `#112` on the agent's own repo, `owner/repo#112` when the link points
 * somewhere else, so a cross-repo ticket is not mistaken for a local one. An
 * agent whose checkout has no GitHub remote is left unqualified: nothing says
 * the link is foreign.
 */
export function ticketPillLabel(agentId: string): string | null {
  const ticket = readTicket(agentId);
  if (ticket === null) return null;

  const ownRepo = repoByAgent.get(agentId) ?? null;
  const slug = `${ticket.owner}/${ticket.repo}`.toLowerCase();
  const base =
    ownRepo !== null && ownRepo !== slug
      ? `${ticket.owner}/${ticket.repo}#${ticket.number}`
      : `#${ticket.number}`;

  return ticket.command === null ? base : `${base} · ${ticket.command}`;
}
