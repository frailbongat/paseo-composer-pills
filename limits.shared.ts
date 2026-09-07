import { defineRpc } from "@getpaseo/plugin/server";
import { z } from "zod";

/** Rolling window ID reported by the Anthropic OAuth usage endpoint. */
export const FIVE_HOUR_ID = "five_hour";

export const LimitWindowSchema = z.object({
  /** Stable key, e.g. `five_hour`, `seven_day`, `seven_day_opus`. */
  id: z.string(),
  /** Short human label, e.g. `5h`, `week`. */
  label: z.string(),
  /** 0-100 percent of the window already consumed. */
  usedPercent: z.number(),
  /** ISO timestamp when the window resets, or null when unknown. */
  resetsAt: z.string().nullable(),
});

export type LimitWindow = z.infer<typeof LimitWindowSchema>;

export const LimitsSnapshotSchema = z.object({
  fetchedAt: z.string(),
  /** Account the credential belongs to, when it can be inferred. */
  account: z.string().nullable(),
  /** Where the OAuth token came from, e.g. `cliproxyapi`. */
  source: z.string().nullable(),
  windows: z.array(LimitWindowSchema),
  error: z.string().nullable(),
});

export type LimitsSnapshot = z.infer<typeof LimitsSnapshotSchema>;

export const readClaudeLimits = defineRpc({
  name: "claude.limits.read",
  input: z.object({ force: z.boolean().optional() }),
  output: LimitsSnapshotSchema,
});
