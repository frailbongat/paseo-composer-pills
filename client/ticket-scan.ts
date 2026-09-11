import type { PluginClientContext } from "@getpaseo/plugin/client";
import { type Ticket, parseTicket, writeTicket } from "./ticket-store";

/**
 * Finds the ticket an agent cites by reading the agent's own timeline.
 *
 * The opening prompt is the first row of the timeline, so `direction: "after"`
 * with no cursor lands exactly on it: the daemon reads that as "from the oldest
 * row I hold" and one bounded page answers for the whole history. Nothing here
 * walks a conversation, and no history is kept in memory past the scan.
 *
 * The live subscription is what catches a URL pasted after the plugin loaded,
 * and what covers the race where an agent is announced before its opening
 * prompt is committed. It is dropped the moment a ticket is found, since the
 * first match sticks for the agent's life.
 */

/** How many of the oldest timeline entries the one-off scan reads. */
const SCAN_LIMIT = 60;

interface Watch {
  /** The live timeline listener, dropped as soon as a ticket is found. */
  unsubscribe: (() => void) | null;
  /** True once the history page has been read, or has failed to read. */
  scanned: boolean;
  /** Earliest live match seen while the history page was still in flight. */
  pending: Ticket | null;
  found: boolean;
}

export interface TicketScanner {
  /** Idempotent: one history read and one live watch per agent, ever. */
  track(agentId: string): void;
  forget(agentId: string): void;
  dispose(): void;
}

export function createTicketScanner(
  client: PluginClientContext,
  onTicket: (agentId: string) => void,
): TicketScanner {
  const watches = new Map<string, Watch>();
  let disposed = false;

  function settle(agentId: string, ticket: Ticket): void {
    const watch = watches.get(agentId);
    if (disposed || watch === undefined || watch.found) return;

    watch.found = true;
    watch.pending = null;
    watch.unsubscribe?.();
    watch.unsubscribe = null;

    writeTicket(agentId, ticket);
    onTicket(agentId);
  }

  async function scan(
    agentId: string,
    handle: ReturnType<PluginClientContext["paseo"]["agents"]["ref"]>,
  ): Promise<void> {
    try {
      const page = await handle.timeline.refetch({
        direction: "after",
        limit: SCAN_LIMIT,
        // The canonical projection returns the rows as stored, without the
        // merging the composer's own view asks for. Prompts are all this needs.
        projection: "canonical",
      });

      const watch = watches.get(agentId);
      if (disposed || watch === undefined || watch.found) return;

      let found: Ticket | null = null;
      for (const entry of page.entries) {
        if (entry.item.type !== "user_message") continue;
        found = parseTicket(entry.item.text);
        if (found !== null) break;
      }

      watch.scanned = true;
      // History outranks anything that arrived live during the read, so the
      // oldest prompt still wins the pill.
      const ticket = found ?? watch.pending;
      watch.pending = null;
      if (ticket !== null) settle(agentId, ticket);
    } catch (error) {
      console.error(`[paseo-composer-pills] failed to read the timeline of ${agentId}`, error);
      // A failed read must not deafen the live watch: the next prompt can still
      // answer, and an agent nobody prompts again simply gets no pill.
      const watch = watches.get(agentId);
      if (watch) watch.scanned = true;
    }
  }

  function track(agentId: string): void {
    if (disposed || watches.has(agentId)) return;

    const watch: Watch = { unsubscribe: null, scanned: false, pending: null, found: false };
    watches.set(agentId, watch);

    const handle = client.paseo.agents.ref(agentId);

    // Subscribed before the history read, so a prompt landing mid-read is seen
    // rather than missed between the two.
    const subscription = handle.timeline.subscribe((event) => {
      const current = watches.get(agentId);
      if (disposed || current === undefined || current.found) return;

      if (event.event.type === "replacement") {
        // A replacement invalidates the page that was fetched, so the read
        // starts over rather than trusting what it saw.
        current.scanned = false;
        current.pending = null;
        void scan(agentId, handle);
        return;
      }

      if (event.event.type !== "timeline") return;
      const { item } = event.event;
      if (item.type !== "user_message") return;

      const ticket = parseTicket(item.text);
      if (ticket === null) return;
      if (current.scanned) {
        settle(agentId, ticket);
        return;
      }
      current.pending ??= ticket;
    });
    watch.unsubscribe = subscription;
    // Establishment failures are the daemon's to report. The history read below
    // runs either way.
    void subscription.ready.catch(() => {});

    void scan(agentId, handle);
  }

  function forget(agentId: string): void {
    const watch = watches.get(agentId);
    if (watch === undefined) return;
    watch.unsubscribe?.();
    watches.delete(agentId);
  }

  function dispose(): void {
    disposed = true;
    for (const watch of watches.values()) watch.unsubscribe?.();
    watches.clear();
  }

  return { track, forget, dispose };
}
