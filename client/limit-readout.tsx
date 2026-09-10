/**
 * The Claude limit readout, rendered in two places: the pill's popover and the
 * workspace panel. Paseo owns the popover's anchoring, padding, and scrolling,
 * so this component renders the body only and never its own outer padding.
 */

import type { PluginTheme } from "@getpaseo/plugin";
import { type PluginButtonContentProps, useRpc } from "@getpaseo/plugin/client";
import { useEffect } from "react";
import { Text, View } from "react-native";
import { limitColor } from "./limit-pill";
import {
  formatCountdown,
  formatResetClock,
  remainingPercent,
  useLimits,
  useNow,
  writeLimits,
} from "./limits-store";
import { type LimitWindow, readClaudeLimits } from "../shared/limits";

/** Anchored popovers size to their content, so give the readout a sane column. */
const POPOVER_WIDTH = 320;

const TITLES: Record<string, string> = {
  five_hour: "Session (5 hours)",
  seven_day: "Weekly (all models)",
  seven_day_opus: "Weekly (Opus)",
  seven_day_sonnet: "Weekly (Sonnet)",
};

function WindowCard({
  window,
  theme,
  now,
}: {
  window: LimitWindow;
  theme: PluginTheme;
  now: number;
}) {
  const remaining = remainingPercent(window);
  const color = limitColor(window, theme);
  const countdown = formatCountdown(window.resetsAt, now);
  const clock = formatResetClock(window.resetsAt);

  return (
    <View
      style={{
        gap: 10,
        padding: 16,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface1,
      }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 14 }}>
          {TITLES[window.id] ?? window.label}
        </Text>
        <Text
          style={{
            color,
            fontSize: 20,
            fontVariant: ["tabular-nums"],
          }}
        >
          {Math.round(remaining)}% left
        </Text>
      </View>

      <View
        style={{
          height: 8,
          borderRadius: 999,
          overflow: "hidden",
          backgroundColor: theme.colors.surface2,
        }}
      >
        <View
          style={{
            width: `${Math.max(2, window.usedPercent)}%`,
            height: "100%",
            borderRadius: 999,
            backgroundColor: color,
          }}
        />
      </View>

      <Text
        style={{
          color: theme.colors.foregroundMuted,
          fontSize: 13,
          fontVariant: ["tabular-nums"],
        }}
      >
        {countdown === null
          ? "No reset time reported"
          : `Resets in ${countdown}${clock ? ` · ${clock}` : ""}`}
      </Text>
    </View>
  );
}

export function LimitReadout({ theme, compact }: { theme: PluginTheme; compact: boolean }) {
  const limits = useLimits();
  const now = useNow();
  const read = useRpc(readClaudeLimits);

  /**
   * Opening the readout asks the daemon, which answers from its own 15-minute
   * snapshot and only hits Anthropic when that has expired. There is no manual
   * refresh because a forced fetch cannot buy a newer number inside that
   * window, and the endpoint answers `429` when pushed. The countdown below is
   * computed locally every second, so it is exact however old the percentage is.
   */
  useEffect(() => {
    let cancelled = false;
    void read({ force: false })
      .then((snapshot) => {
        if (!cancelled) writeLimits(snapshot);
      })
      .catch((error: unknown) => {
        console.error("[paseo-composer-pills] limit read failed", error);
      });
    return () => {
      cancelled = true;
    };
  }, [read]);

  return (
    <View style={{ gap: compact ? 12 : 16 }}>
      <Text style={{ color: theme.colors.foreground, fontSize: 16 }}>Claude usage limits</Text>

      {limits?.windows.map((window) => (
        <WindowCard key={window.id} window={window} theme={theme} now={now} />
      ))}

      {limits && limits.windows.length === 0 ? (
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 14 }}>
          No rate-limit windows reported yet.
        </Text>
      ) : null}

      {limits?.error ? (
        <Text style={{ color: theme.colors.statusDanger, fontSize: 13 }}>{limits.error}</Text>
      ) : null}

      {limits ? (
        /**
         * One line at the popover width, always. The account and source are the
         * compressible half, so they shrink and clip; the timestamp is the fact
         * this line exists to carry, so it never gives up a character.
         */
        <View style={{ flexDirection: "row", alignItems: "baseline", gap: 6 }}>
          <Text
            numberOfLines={1}
            ellipsizeMode="tail"
            style={{ flexShrink: 1, color: theme.colors.foregroundMuted, fontSize: 12 }}
          >
            {[limits.account, limits.source].filter(Boolean).join(" · ") || "Claude account"}
          </Text>
          <Text
            numberOfLines={1}
            style={{
              flexShrink: 0,
              color: theme.colors.foregroundMuted,
              fontSize: 12,
              fontVariant: ["tabular-nums"],
            }}
          >
            {"· updated "}
            {new Date(limits.fetchedAt).toLocaleTimeString([], {
              hour: "numeric",
              minute: "2-digit",
            })}
          </Text>
        </View>
      ) : (
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 14 }}>Loading…</Text>
      )}
    </View>
  );
}

/** Popover body for the limit pill: a sheet on compact clients, anchored on wide ones. */
export function LimitPopover({ theme, layout }: PluginButtonContentProps) {
  return (
    <View style={layout.compact ? undefined : { width: POPOVER_WIDTH }}>
      <LimitReadout theme={theme} compact={layout.compact} />
    </View>
  );
}
