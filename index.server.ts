import type { PluginServerContext } from "@getpaseo/plugin/server";
import { readClaudeLimitsHandler } from "./server/limits";
import { clearQualityCache, readShipVerdictHandler } from "./server/ship";
import { readClaudeLimits } from "./shared/limits";
import { readShipVerdict } from "./shared/ship";

export default function contribute(server: PluginServerContext) {
  server.handle(readClaudeLimits, (input) => readClaudeLimitsHandler(input));
  server.handle(readShipVerdict, (input) => readShipVerdictHandler(input));
  return () => {
    clearQualityCache();
  };
}
