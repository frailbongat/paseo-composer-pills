/**
 * The plugin's persisted settings document.
 *
 * Every default here is the value the constant it replaced already had, so a
 * fresh install behaves exactly like the hardcoded version did:
 *
 * | Setting             | Replaced constant                              |
 * | ------------------- | ---------------------------------------------- |
 * | `limitsPollSeconds` | `LIMITS_POLL_INTERVAL_MS = 60_000` (pills.tsx) |
 * | `shipCommand`       | the literal `"/ship"` (ship-card.tsx)          |
 *
 * `compactWidth` was here too. It only ever decided which pill kept its slot on
 * a phone, and the ship pill it arbitrated is gone.
 */

import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

/** The Claude limits poll, which was `LIMITS_POLL_INTERVAL_MS / 1_000`. */
export const DEFAULT_LIMITS_POLL_SECONDS = 60;
/** What the ship card's button sends into the composer. */
export const DEFAULT_SHIP_COMMAND = "/ship";

/**
 * The countdown redraw stays fixed. It is a clock rather than a poll: it costs
 * one label diff per second and nothing on the wire, and slowing it would only
 * make the reset countdown skip seconds.
 */
export const LABEL_TICK_INTERVAL_MS = 1_000;

export const LIMITS_POLL_SECONDS_OPTIONS = [15, 30, 60, 120, 300] as const;

export const pillSettings = defineSettings({
  id: "pills",
  scope: "host",
  version: 1,
  schema: z.object({
    limitsPollSeconds: z
      .number()
      .int()
      .min(5)
      .max(3_600)
      .default(DEFAULT_LIMITS_POLL_SECONDS),
    shipCommand: z.string().trim().min(1).max(200).default(DEFAULT_SHIP_COMMAND),
  }),
});

export type PillSettings = z.output<typeof pillSettings.schema>;

/** Parsing `{}` produces the complete document, so this is the whole default. */
export const DEFAULT_PILL_SETTINGS: PillSettings = pillSettings.schema.parse({});

export function limitsPollIntervalMs(settings: PillSettings): number {
  return settings.limitsPollSeconds * 1_000;
}

/** Label for a poll option, so the screen and any hint text agree. */
export function pollSecondsLabel(seconds: number): string {
  if (seconds < 60) return `${seconds} seconds`;
  const minutes = seconds / 60;
  return minutes === 1 ? "1 minute" : `${minutes} minutes`;
}
