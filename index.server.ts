import type { PluginServerContext } from "@getpaseo/plugin/server";
import { readClaudeLimitsHandler } from "./server/limits";
import {
  clearAgentVerdicts,
  readCachedShipVerdictRpc,
  readShipVerdictRpc,
  refreshAgentVerdict,
} from "./server/ship-cache";
import { clearQualityCache } from "./server/ship";
import { readClaudeLimits } from "./shared/limits";
import { readCachedShipVerdict, readShipVerdict, verdictLine } from "./shared/ship";

export default function contribute(server: PluginServerContext) {
  server.handle(readClaudeLimits, (input) => readClaudeLimitsHandler(input));
  server.handle(readShipVerdict, (input) => readShipVerdictRpc(input));
  server.handle(readCachedShipVerdict, (input) => readCachedShipVerdictRpc(input));

  // The end of a turn is the moment the tree stops moving, and the daemon sees
  // it whether or not an app is connected. Computing here is what lets the pill
  // show a finished verdict the instant the tab opens.
  const stopWatchingTurns = server.on("agent.turn_ended", async (event) => {
    const { id, cwd } = event.agent;
    if (!cwd.trim()) return;
    try {
      // Never forced: the quality cache key already carries the tree's dirty
      // state, so a turn that changed nothing reuses the previous run.
      const verdict = await refreshAgentVerdict(id, cwd);
      if (verdict.isRepo) console.log(`[ship] ${id}: ${verdictLine(verdict)}`);
    } catch (error) {
      console.error("[paseo-composer-pills] turn-end ship verdict failed", error);
    }
  });

  return () => {
    stopWatchingTurns();
    clearAgentVerdicts();
    clearQualityCache();
  };
}
