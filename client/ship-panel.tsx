import type { PluginTheme } from "@getpaseo/plugin";
import { type PluginAgentPanelProps, useAgent, usePaseo, useRpc } from "@getpaseo/plugin/client";
import { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { shipColor } from "./ship-pill";
import { useShipVerdict, writeVerdict } from "./ship-store";
import {
  type ShipCheck,
  blockingChecks,
  branchLine,
  isReady,
  passedCount,
  readShipVerdict,
  verdictLine,
  warningChecks,
} from "../shared/ship";

function CheckRow({ check, theme }: { check: ShipCheck; theme: PluginTheme }) {
  const color = check.status === "fail" ? theme.colors.statusDanger : theme.colors.statusWarning;
  return (
    <View style={{ flexDirection: "row", gap: 8, alignItems: "flex-start" }}>
      <Text style={{ color, fontSize: 13, lineHeight: 18 }}>{check.status === "fail" ? "×" : "!"}</Text>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ color: theme.colors.foreground, fontSize: 13, lineHeight: 18 }}>
          {check.label}
        </Text>
        {check.reason ? (
          <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12, lineHeight: 16 }}>
            {check.reason}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

export function ShipPanel({ theme, layout, agentId }: PluginAgentPanelProps) {
  const verdict = useShipVerdict(agentId);
  const cwd = useAgent(agentId, (agent) => agent.cwd);
  const status = useAgent(agentId, (agent) => agent.status);
  const read = useRpc(readShipVerdict);
  const paseo = usePaseo();
  const [pending, setPending] = useState(false);
  const [shipping, setShipping] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const refresh = useCallback(
    async (force: boolean) => {
      if (!cwd) return;
      setPending(true);
      setFailure(null);
      try {
        writeVerdict(agentId, await read({ cwd, force }));
      } catch (error) {
        setFailure(error instanceof Error ? error.message : String(error));
      } finally {
        setPending(false);
      }
    },
    [agentId, cwd, read],
  );

  useEffect(() => {
    void refresh(false);
  }, [refresh]);

  const ship = useCallback(async () => {
    setShipping(true);
    setFailure(null);
    try {
      await paseo.agents.ref(agentId).send("/ship");
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error));
    } finally {
      setShipping(false);
    }
  }, [agentId, paseo]);

  const padding = layout.compact ? 16 : 24;
  const blockers = verdict ? blockingChecks(verdict) : [];
  const warnings = verdict ? warningChecks(verdict) : [];
  const canShip = verdict !== null && isReady(verdict) && status === "idle";

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.colors.surface0 }}
      contentContainerStyle={{ padding, gap: layout.compact ? 12 : 16 }}
    >
      {verdict === null ? (
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 14 }}>
          {pending ? "Checking…" : "No verdict yet."}
        </Text>
      ) : !verdict.isRepo ? (
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 14 }}>
          This workspace is not a git repository.
        </Text>
      ) : (
        <View style={{ gap: 10 }}>
          <Text style={{ color: shipColor(verdict, theme), fontSize: 18 }}>
            {verdictLine(verdict)}
          </Text>
          <Text style={{ color: theme.colors.foregroundMuted, fontSize: 13 }}>
            {branchLine(verdict)}
          </Text>
          <Text style={{ color: theme.colors.foregroundMuted, fontSize: 13 }}>
            {verdict.changedFiles === 0
              ? "Nothing to ship."
              : `${verdict.changedFiles} changed file${verdict.changedFiles === 1 ? "" : "s"}`}
            {verdict.destinationReason ? ` · ${verdict.destinationReason}` : ""}
          </Text>

          {blockers.length > 0 || warnings.length > 0 ? (
            <View
              style={{
                gap: 10,
                padding: 14,
                borderRadius: 14,
                borderWidth: 1,
                borderColor: theme.colors.border,
                backgroundColor: theme.colors.surface1,
              }}
            >
              {blockers.map((check) => (
                <CheckRow key={check.id} check={check} theme={theme} />
              ))}
              {warnings.map((check) => (
                <CheckRow key={check.id} check={check} theme={theme} />
              ))}
            </View>
          ) : null}

          <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
            {passedCount(verdict)} check{passedCount(verdict) === 1 ? "" : "s"} passed
            {verdict.qualityFromCache ? " · quality reused from cache" : ""}
            {" · "}
            {new Date(verdict.checkedAt).toLocaleTimeString([], {
              hour: "numeric",
              minute: "2-digit",
            })}
          </Text>
        </View>
      )}

      {failure ? (
        <Text style={{ color: theme.colors.statusDanger, fontSize: 13 }}>{failure}</Text>
      ) : null}

      <View style={{ flexDirection: "row", gap: 10 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Re-check ship readiness"
          disabled={pending}
          onPress={() => void refresh(true)}
          style={{
            paddingHorizontal: 14,
            paddingVertical: 8,
            borderRadius: 10,
            borderWidth: 1,
            borderColor: theme.colors.border,
            opacity: pending ? 0.6 : 1,
            backgroundColor: theme.colors.surface1,
          }}
        >
          <Text style={{ color: theme.colors.foreground, fontSize: 13 }}>
            {pending ? "Checking…" : "Re-check"}
          </Text>
        </Pressable>

        {canShip ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Run /ship now"
            disabled={shipping}
            onPress={() => void ship()}
            style={{
              paddingHorizontal: 14,
              paddingVertical: 8,
              borderRadius: 10,
              opacity: shipping ? 0.6 : 1,
              backgroundColor: theme.colors.accent,
            }}
          >
            <Text style={{ color: theme.colors.accentForeground, fontSize: 13 }}>
              {shipping ? "Sending…" : "Ship now"}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </ScrollView>
  );
}
