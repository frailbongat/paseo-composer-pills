import type { PluginServerContext } from "@getpaseo/plugin/server";
import { readClaudeLimitsHandler } from "./server/limits";
import {
  clearAgentVerdicts,
  readCachedShipVerdictRpc,
  readShipVerdictRpc,
  refreshAgentVerdict,
} from "./server/ship-cache";
import { clearQualityCache } from "./server/ship";
import { clearPublishedRows, publishShipRow } from "./server/timeline";
import { readClaudeLimits } from "./shared/limits";
import { pillSettings } from "./shared/settings";
import { readCachedShipVerdict, readShipVerdict, verdictLine } from "./shared/ship";

export default function contribute(server: PluginServerContext) {
  // Registers the daemon-side document plus its read/write/reset RPCs, which is
  // what `useSettings` in the screen and `settingsRpc` in the pill entrypoint
  // both talk to.
  server.registerSettings(pillSettings);

  server.handle(readClaudeLimits, (input) => readClaudeLimitsHandler(input));
  // A named agent is a re-check the user asked for, from the panel, the Command
  // Center, or `/ship-check`, so its result also refreshes that agent's
  // timeline row.
  server.handle(readShipVerdict, async (input, context) => {
    const verdict = await readShipVerdictRpc(input);
    if (input.agentId) await publishShipRow(context.paseo, input.agentId, verdict);
    return verdict;
  });
  server.handle(readCachedShipVerdict, (input) => readCachedShipVerdictRpc(input));

  // The end of a turn is the moment the tree stops moving, and the daemon sees
  // it whether or not an app is connected. Computing here is what lets the card
  // and the panel show a finished verdict the instant they are on screen.
  const stopWatchingTurns = server.on("agent.turn_ended", async (event, context) => {
    const { id, cwd } = event.agent;
    if (!cwd.trim()) return;
    try {
      // Never forced: the quality cache key already carries the tree's dirty
      // state, so a turn that changed nothing reuses the previous run.
      const verdict = await refreshAgentVerdict(id, cwd);
      if (verdict.isRepo) console.log(`[ship] ${id}: ${verdictLine(verdict)}`);
      // The row lands under the turn that just finished and replaces the one
      // the previous turn left, so the timeline carries one current verdict.
      await publishShipRow(context.paseo, id, verdict);
    } catch (error) {
      console.error("[paseo-composer-pills] turn-end ship verdict failed", error);
    }
  });

  return () => {
    stopWatchingTurns();
    clearPublishedRows();
    clearAgentVerdicts();
    clearQualityCache();
  };
}
