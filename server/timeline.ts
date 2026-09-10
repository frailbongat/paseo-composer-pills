/**
 * Publishing the verdict as a timeline row.
 *
 * The daemon already computes a verdict when a turn ends, so this only has to
 * hand it to the agent's timeline. Appending under a fixed plugin id replaces
 * the previous row, which is why a re-check moves the row already on screen
 * instead of adding a second one below it.
 */

import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { type ShipVerdict, hasVerdict } from "../shared/ship";
import { SHIP_ROW_ID, SHIP_ROW_KIND, SHIP_ROW_VERSION, toShipRow } from "../shared/timeline";

/** The SDK the daemon hands every handler and hook. */
type Paseo = PluginHandlerContext["paseo"];

/**
 * Agents that already carry a row. A clean tree has nothing to report, so the
 * first row waits for something to ship; after that the row keeps updating even
 * once the tree goes clean, because a stale `2 blockers` sitting above a
 * finished turn is worse than a `Nothing to ship` line.
 */
const publishedAgents = new Set<string>();

export async function publishShipRow(
  paseo: Paseo,
  agentId: string,
  verdict: ShipVerdict,
): Promise<void> {
  if (!verdict.isRepo) return;
  if (!hasVerdict(verdict) && !publishedAgents.has(agentId)) return;

  try {
    await paseo.agents.ref(agentId).timeline.append({
      type: "plugin",
      id: SHIP_ROW_ID,
      kind: SHIP_ROW_KIND,
      version: SHIP_ROW_VERSION,
      data: toShipRow(verdict),
    });
    publishedAgents.add(agentId);
  } catch (error) {
    // A daemon without `features.pluginTimelineItems` refuses the append, and
    // that must not take the verdict itself down with it: the pill and the
    // panel still work on a host that cannot carry the row.
    console.error("[paseo-composer-pills] could not append the ship row", error);
  }
}

export function clearPublishedRows(): void {
  publishedAgents.clear();
}
