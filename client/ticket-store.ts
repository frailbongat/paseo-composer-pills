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
  /https?:\/\/(?:www\.)?github\.com\/([A-Za-z0-9][A-Za-z0-9._-]*)\/([A-Za-z0-9][A-Za-z0-9._-]*)\/(issues|pull)\/([1-9]\d*)(?![\w-])/i;

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

/** The first ticket cited in one user message, or null when it cites none. */
export function parseTicket(text: string): Ticket | null {
  const match = TICKET_URL.exec(text);
  if (match === null) return null;

  const [, owner, repo, kind, digits] = match;
  const number = Number.parseInt(digits, 10);
  if (!Number.isSafeInteger(number) || number <= 0) return null;

  return {
    owner,
    repo,
    number,
    url: `https://github.com/${owner}/${repo}/${kind.toLowerCase()}/${number}`,
    command: commandTitle(text),
  };
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
