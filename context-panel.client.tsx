import {
  type PluginAgentPanelProps,
  type PluginTheme,
  useAgent,
  usePaseo,
} from "@getpaseo/plugin";
import { useEffect, useMemo } from "react";
import { ScrollView, Text, View } from "react-native";
import { useAgentUsage, usageColor } from "./context-pill.client";
import {
  formatExactTokens,
  formatTokens,
  toContextUsage,
  usageRatio,
  writeUsage,
} from "./usage-store.client";

function formatCost(costUsd: number): string {
  return costUsd >= 1 ? `$${costUsd.toFixed(2)}` : `$${costUsd.toFixed(4)}`;
}

function Row({
  label,
  value,
  theme,
}: {
  label: string;
  value: string;
  theme: PluginTheme;
}) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 16,
        paddingVertical: 8,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.border,
      }}
    >
      <Text style={{ color: theme.colors.foregroundMuted, fontSize: 14 }}>{label}</Text>
      <Text
        style={{
          color: theme.colors.foreground,
          fontSize: 14,
          fontVariant: ["tabular-nums"],
        }}
      >
        {value}
      </Text>
    </View>
  );
}

export function ContextPanel({ theme, layout, agentId }: PluginAgentPanelProps) {
  const paseo = usePaseo();
  const usage = useAgentUsage(agentId);
  const agent = useAgent(agentId, ({ model, provider }) => ({ model, provider }));

  // The panel can be restored before any agent update arrives.
  useEffect(() => {
    let cancelled = false;
    const handle = paseo.agents.ref(agentId);
    void handle
      .refresh()
      .then(() => {
        if (cancelled) return;
        const refreshed = toContextUsage(handle.current());
        if (refreshed) writeUsage(agentId, refreshed);
      })
      .catch((error: unknown) => {
        console.error("[paseo-composer-pills] refresh failed", error);
      });
    return () => {
      cancelled = true;
    };
  }, [paseo, agentId]);

  const padding = layout.compact ? 16 : 24;
  const rows = useMemo(() => {
    if (!usage) return [];
    const entries: { label: string; value: string }[] = [
      { label: "Context used", value: `${formatExactTokens(usage.usedTokens)} tokens` },
    ];
    if (usage.maxTokens !== null) {
      entries.push(
        { label: "Context limit", value: `${formatExactTokens(usage.maxTokens)} tokens` },
        {
          label: "Remaining",
          value: `${formatExactTokens(Math.max(0, usage.maxTokens - usage.usedTokens))} tokens`,
        },
      );
    }
    if (usage.inputTokens !== null) {
      entries.push({ label: "Input (last turn)", value: formatExactTokens(usage.inputTokens) });
    }
    if (usage.cachedInputTokens !== null) {
      entries.push({
        label: "Cached input (last turn)",
        value: formatExactTokens(usage.cachedInputTokens),
      });
    }
    if (usage.outputTokens !== null) {
      entries.push({ label: "Output (last turn)", value: formatExactTokens(usage.outputTokens) });
    }
    if (usage.totalCostUsd !== null) {
      entries.push({ label: "Cost", value: formatCost(usage.totalCostUsd) });
    }
    return entries;
  }, [usage]);

  if (!usage) {
    return (
      <View
        style={{ flex: 1, padding, backgroundColor: theme.colors.surface0, gap: 8 }}
      >
        <Text style={{ color: theme.colors.foreground, fontSize: 16 }}>Context window</Text>
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 14 }}>
          No usage reported yet. Send a message and this fills in after the turn.
        </Text>
      </View>
    );
  }

  const ratio = usageRatio(usage);
  const color = usageColor(usage, theme);
  const headline =
    usage.maxTokens === null
      ? formatTokens(usage.usedTokens)
      : `${formatTokens(usage.usedTokens)} / ${formatTokens(usage.maxTokens)}`;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.colors.surface0 }}
      contentContainerStyle={{ padding, gap: layout.compact ? 12 : 16 }}
    >
      <View style={{ gap: 4 }}>
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 13 }}>
          Context window
        </Text>
        <Text
          style={{
            color: theme.colors.foreground,
            fontSize: layout.compact ? 28 : 34,
            fontVariant: ["tabular-nums"],
          }}
        >
          {usage.maxTokens === null ? headline : `${Math.round(ratio * 100)}%`}
        </Text>
        <Text
          style={{
            color: theme.colors.foregroundMuted,
            fontSize: 14,
            fontVariant: ["tabular-nums"],
          }}
        >
          {headline} tokens
        </Text>
      </View>

      {usage.maxTokens === null ? null : (
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
              width: `${Math.max(2, ratio * 100)}%`,
              height: "100%",
              borderRadius: 999,
              backgroundColor: color,
            }}
          />
        </View>
      )}

      <View
        style={{
          borderRadius: 16,
          borderWidth: 1,
          borderColor: theme.colors.border,
          backgroundColor: theme.colors.surface1,
          paddingHorizontal: 16,
          paddingVertical: 4,
        }}
      >
        {rows.map((row) => (
          <Row key={row.label} label={row.label} value={row.value} theme={theme} />
        ))}
      </View>

      {agent?.model ? (
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 13 }}>
          {agent.provider} · {agent.model}
        </Text>
      ) : null}
    </ScrollView>
  );
}
