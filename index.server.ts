import type { PluginServerContext } from "@getpaseo/plugin/server";
import { readClaudeLimitsHandler } from "./server/limits";
import { readClaudeLimits } from "./shared/limits";
import { pillSettings } from "./shared/settings";

export default function contribute(server: PluginServerContext) {
  // Registers the daemon-side document plus its read/write/reset RPCs, which is
  // what `useSettings` in the screen and `settingsRpc` in the pill entrypoint
  // both talk to.
  server.registerSettings(pillSettings);

  server.handle(readClaudeLimits, (input) => readClaudeLimitsHandler(input));

  // The daemon rejects a contribution that returns nothing, and a rejected
  // reload leaves the previously loaded build running. Nothing here owns a
  // timer or a subscription, so the cleanup is empty on purpose.
  return () => {};
}
