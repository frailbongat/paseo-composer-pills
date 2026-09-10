import type { PluginTheme } from "@getpaseo/plugin";
import { type PluginAgentPanelProps, useRpc } from "@getpaseo/plugin/client";
import { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
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

export function LimitPanel({ theme, layout }: PluginAgentPanelProps) {
  const limits = useLimits();
  const now = useNow();
  const read = useRpc(readClaudeLimits);
  const [pending, setPending] = useState(false);

  const refresh = useCallback(
    async (force: boolean) => {
      setPending(true);
      try {
        writeLimits(await read({ force }));
      } catch (error) {
        console.error("[paseo-composer-pills] panel refresh failed", error);
      } finally {
        setPending(false);
      }
    },
    [read],
  );

  useEffect(() => {
    void refresh(false);
  }, [refresh]);

  const padding = layout.compact ? 16 : 24;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.colors.surface0 }}
      contentContainerStyle={{ padding, gap: layout.compact ? 12 : 16 }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <Text style={{ color: theme.colors.foreground, fontSize: 16 }}>Claude usage limits</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Refresh Claude usage limits"
          disabled={pending}
          onPress={() => void refresh(true)}
          style={{
            paddingHorizontal: 14,
            paddingVertical: 8,
            borderRadius: 10,
            opacity: pending ? 0.6 : 1,
            backgroundColor: theme.colors.accent,
          }}
        >
          <Text style={{ color: theme.colors.accentForeground, fontSize: 13 }}>
            {pending ? "Refreshing…" : "Refresh"}
          </Text>
        </Pressable>
      </View>

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
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
          {[limits.account, limits.source].filter(Boolean).join(" · ") || "Claude account"}
          {" · updated "}
          {new Date(limits.fetchedAt).toLocaleTimeString([], {
            hour: "numeric",
            minute: "2-digit",
          })}
        </Text>
      ) : (
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 14 }}>Loading…</Text>
      )}
    </ScrollView>
  );
}
