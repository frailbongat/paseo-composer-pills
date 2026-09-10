/**
 * The blocker row the daemon drops into the agent timeline.
 *
 * The pill and the panel only exist while an app is on screen, so a turn that
 * ended with nobody watching left its verdict nowhere a person reads later.
 * The timeline is the one place that keeps history, so the same verdict is
 * published there as a row.
 *
 * `SHIP_ROW_ID` is fixed per agent on purpose: re-appending the same plugin id
 * replaces the earlier row rather than stacking a second one, so the next turn
 * updates the row in place and the timeline never carries two verdicts that
 * disagree.
 */

import { z } from "zod";
import {
  ShipCheckSchema,
  type ShipVerdict,
  blockingChecks,
  branchLine,
  isReady,
  passedCount,
  verdictLine,
  warningChecks,
} from "./ship";

export const SHIP_ROW_KIND = "ship-blockers";
export const SHIP_ROW_VERSION = 1;
/** One row per agent. Reusing it is what makes a re-run replace the old one. */
export const SHIP_ROW_ID = "ship-blockers";

export const ShipRowSchema = z.object({
  /** `Ready to ship`, `2 blockers`, or whatever the verdict says in one line. */
  headline: z.string(),
  /** `main → origin/main · 2 ahead`, the same line the panel shows. */
  branch: z.string(),
  /** Changed-file count plus `/ship`'s reason for the destination. */
  detail: z.string(),
  ready: z.boolean(),
  checkedAt: z.string(),
  blockers: z.array(ShipCheckSchema),
  warnings: z.array(ShipCheckSchema),
  passed: z.number(),
});

export type ShipRow = z.infer<typeof ShipRowSchema>;

/** The row's copy, built once on the daemon so the renderer only draws it. */
export function toShipRow(verdict: ShipVerdict): ShipRow {
  const files =
    verdict.changedFiles === 0
      ? "Nothing to ship"
      : `${verdict.changedFiles} changed file${verdict.changedFiles === 1 ? "" : "s"}`;

  return {
    headline: verdictLine(verdict),
    branch: branchLine(verdict),
    detail: verdict.destinationReason ? `${files} · ${verdict.destinationReason}` : files,
    ready: isReady(verdict),
    checkedAt: verdict.checkedAt,
    blockers: blockingChecks(verdict),
    warnings: warningChecks(verdict),
    passed: passedCount(verdict),
  };
}
