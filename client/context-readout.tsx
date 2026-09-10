/**
 * The context-window readout, rendered in two places: the pill's popover and
 * the workspace panel. Paseo owns the popover's anchoring, padding, and
 * scrolling, so this renders the body only and never its own outer padding.
 */

import type { PluginTheme } from "@getpaseo/plugin";
import { type PluginButtonContentProps, useAgent, usePaseo } from "@getpaseo/plugin/client";
import { useEffect, useMemo } from "react";
import { Text, View } from "react-native";
import { useAgentUsage, usageColor } from "./context-pill";
import {
  formatExactTokens,
  formatTokens,
  toContextUsage,
  usageRatio,
  writeUsage,
} from "./usage-store";

/** Anchored popovers size to their content, so give the readout a sane column. */
const POPOVER_WIDTH = 320;

function formatCost(costUsd: number): string {
  return costUsd >= 1 ? `$${costUsd.toFixed(2)}` : `$${costUsd.toFixed(4)}`;
}

function Row({
  label,
  value,
  theme,
  divider,
}: {
  label: string;
  value: string;
  theme: PluginTheme;
  divider: boolean;
}) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "baseline",
        justifyContent: "space-between",
        gap: 16,
        paddingVertical: 6,
        borderBottomWidth: divider ? 1 : 0,
        borderBottomColor: theme.colors.border,
      }}
    >
      <Text
        numberOfLines={1}
        ellipsizeMode="tail"
        style={{ flexShrink: 1, color: theme.colors.foregroundMuted, fontSize: 13 }}
      >
        {label}
      </Text>
      <Text
        numberOfLines={1}
        style={{
          flexShrink: 0,
          color: theme.colors.foreground,
          fontSize: 13,
          fontVariant: ["tabular-nums"],
        }}
      >
        {value}
      </Text>
    </View>
  );
}

export function ContextReadout({
  theme,
  compact,
  agentId,
}: {
  theme: PluginTheme;
  compact: boolean;
  agentId: string;
}) {
  const paseo = usePaseo();
  const usage = useAgentUsage(agentId);
  const agent = useAgent(agentId, ({ model, provider }) => ({ model, provider }));

  // The readout can open before any agent update arrives.
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

  /**
   * The popover shows everything without scrolling, so the card carries only
   * what the headline cannot. Used, limit, and remaining are all stated exactly
   * by the figure above, so the rows are the last turn's split alone, and the
   * group heading buys back the `(last turn)` suffix each label used to repeat.
   */
  const rows = useMemo(() => {
    if (!usage) return [];
    const entries: { label: string; value: string }[] = [];
    if (usage.inputTokens !== null) {
      entries.push({ label: "Input", value: formatExactTokens(usage.inputTokens) });
    }
    if (usage.cachedInputTokens !== null) {
      entries.push({ label: "Cached", value: formatExactTokens(usage.cachedInputTokens) });
    }
    if (usage.outputTokens !== null) {
      entries.push({ label: "Output", value: formatExactTokens(usage.outputTokens) });
    }
    return entries;
  }, [usage]);

  if (!usage) {
    return (
      <View style={{ gap: 8 }}>
        <Text style={{ color: theme.colors.foreground, fontSize: 16 }}>Context window</Text>
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 14 }}>
          No usage reported yet. Send a message and this fills in after the turn.
        </Text>
      </View>
    );
  }

  const ratio = usageRatio(usage);
  const color = usageColor(usage, theme);
  // Exact here, because the rows that used to spell these out are gone.
  const headline =
    usage.maxTokens === null
      ? `${formatExactTokens(usage.usedTokens)} tokens`
      : `${formatExactTokens(usage.usedTokens)} / ${formatExactTokens(usage.maxTokens)} tokens`;

  return (
    <View style={{ gap: compact ? 12 : 16 }}>
      <View style={{ gap: 4 }}>
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 13 }}>Context window</Text>
        <Text
          style={{
            color: theme.colors.foreground,
            fontSize: compact ? 28 : 34,
            fontVariant: ["tabular-nums"],
          }}
        >
          {usage.maxTokens === null
            ? formatTokens(usage.usedTokens)
            : `${Math.round(ratio * 100)}%`}
        </Text>
        <Text
          numberOfLines={1}
          style={{
            color: theme.colors.foregroundMuted,
            fontSize: 14,
            fontVariant: ["tabular-nums"],
          }}
        >
          {headline}
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

      {rows.length === 0 ? null : (
        <View
          style={{
            gap: 2,
            borderRadius: 16,
            borderWidth: 1,
            borderColor: theme.colors.border,
            backgroundColor: theme.colors.surface1,
            paddingHorizontal: 16,
            paddingVertical: 12,
          }}
        >
          <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>Last turn</Text>
          {rows.map((row, index) => (
            <Row
              key={row.label}
              label={row.label}
              value={row.value}
              theme={theme}
              divider={index < rows.length - 1}
            />
          ))}
        </View>
      )}

      {/* Model and session cost are both footnotes, so they share one line. */}
      {agent?.model || usage.totalCostUsd !== null ? (
        <View style={{ flexDirection: "row", alignItems: "baseline", gap: 12 }}>
          <Text
            numberOfLines={1}
            ellipsizeMode="tail"
            style={{ flex: 1, color: theme.colors.foregroundMuted, fontSize: 13 }}
          >
            {agent?.model ? `${agent.provider} · ${agent.model}` : ""}
          </Text>
          {usage.totalCostUsd === null ? null : (
            <Text
              numberOfLines={1}
              style={{
                flexShrink: 0,
                color: theme.colors.foregroundMuted,
                fontSize: 13,
                fontVariant: ["tabular-nums"],
              }}
            >
              {"Cost "}
              <Text style={{ color: theme.colors.foreground }}>
                {formatCost(usage.totalCostUsd)}
              </Text>
            </Text>
          )}
        </View>
      ) : null}
    </View>
  );
}

/** Popover body for the context pill: a sheet on compact clients, anchored on wide ones. */
export function ContextPopover(props: PluginButtonContentProps) {
  const { theme, layout } = props;
  const agentId = props.context === "agent" ? props.agentId : "";
  return (
    <View style={layout.compact ? undefined : { width: POPOVER_WIDTH }}>
      <ContextReadout theme={theme} compact={layout.compact} agentId={agentId} />
    </View>
  );
}
