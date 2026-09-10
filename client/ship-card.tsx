/**
 * The ship card: one verdict, drawn once.
 *
 * The timeline row the daemon appends and the ship panel both render this, so
 * the two can never disagree about what a verdict looks like. The card also
 * carries the ship itself. That trigger used to be a composer pill, which put
 * the button at the bottom of the window and the reasons it was disabled
 * somewhere else entirely, and handed the pending state to Paseo's own button
 * chrome. Here the verdict and its one action are the same object, and the
 * button reports its own progress: it spins, it refuses a second press, and
 * nothing else on the agent spins on its behalf.
 */

import type { PluginTheme } from "@getpaseo/plugin";
import { useAgent, usePaseo } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Text, View } from "react-native";
import { ActionButton } from "./action-button";
import { usePillSettings } from "./settings-store";
import type { ShipCheck } from "../shared/ship";
import type { ShipRow } from "../shared/timeline";

/** How long a sent command has to start a turn before the button stops waiting. */
const HANDOFF_GRACE_MS = 5_000;

type ShipPhase = "idle" | "sending" | "shipping";

function statusColor(row: ShipRow, theme: PluginTheme): string {
  if (row.ready) return theme.colors.statusSuccess;
  return row.blockers.length > 0 ? theme.colors.statusDanger : theme.colors.foregroundMuted;
}

function checkTime(checkedAt: string): string {
  return new Date(checkedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function CheckLine({ check, theme }: { check: ShipCheck; theme: PluginTheme }) {
  const failed = check.status === "fail";
  const color = failed ? theme.colors.statusDanger : theme.colors.statusWarning;

  return (
    <View style={{ flexDirection: "row", gap: 8, alignItems: "flex-start" }}>
      <View style={{ paddingTop: 2 }}>
        <Icon name={failed ? "X" : "AlertTriangle"} size={13} color={color} />
      </View>
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

/**
 * The ship, and nothing else: it sends the command or it says why it could not.
 * The card only renders it for a ready verdict, so what is left to guard is a
 * second press while the first is on the wire and an agent that started running
 * since the card was drawn.
 */
function ShipButton({
  agentId,
  theme,
  stretch,
  onError,
}: {
  agentId: string;
  theme: PluginTheme;
  stretch: boolean;
  onError: (message: string | null) => void;
}) {
  const paseo = usePaseo();
  const command = usePillSettings().shipCommand;
  const status = useAgent(agentId, (agent) => agent.status);
  const [phase, setPhase] = useState<ShipPhase>("idle");
  /** Whether the turn this button started has actually begun. */
  const turnBegan = useRef(false);

  /**
   * The turn the send starts is the ship, so the spinner runs until that turn
   * ends rather than until the send is acknowledged. `turnBegan` is what
   * separates the two moments that both read as "not running": the gap before
   * the agent picks the command up, and the end of the work itself.
   */
  useEffect(() => {
    if (phase !== "shipping") {
      turnBegan.current = false;
      return;
    }
    if (status === "running") {
      turnBegan.current = true;
      return;
    }
    if (turnBegan.current) {
      setPhase("idle");
      return;
    }
    // A command that never produced a turn, which is what an agent that quietly
    // dropped it looks like. Hand the button back instead of spinning forever.
    const timer = setTimeout(() => setPhase("idle"), HANDOFF_GRACE_MS);
    return () => clearTimeout(timer);
  }, [phase, status]);

  const busy = phase !== "idle";
  // `null` is an agent this client has no snapshot for, which is not a reason
  // to refuse the press; the send reports its own failure.
  const agentBusy = status !== null && status !== "idle";

  const ship = useCallback(() => {
    if (phase !== "idle") return;
    setPhase("sending");
    onError(null);

    void (async () => {
      try {
        // Paseo submits a provider slash command as ordinary message text, so
        // this is exactly what typing the command into the composer does.
        await paseo.agents.ref(agentId).send(command);
        setPhase("shipping");
      } catch (error) {
        console.error("[paseo-composer-pills] ship command failed to send", error);
        const reason = error instanceof Error ? error.message : String(error);
        setPhase("idle");
        onError(`Could not send ${command}: ${reason}`);
      }
    })();
  }, [agentId, command, onError, paseo, phase]);

  return (
    <ActionButton
      theme={theme}
      tone="primary"
      icon="Ship"
      label={phase === "sending" ? "Sending…" : phase === "shipping" ? "Shipping…" : "Ship"}
      accessibilityLabel={`Run ${command} now`}
      {...(agentBusy && !busy
        ? { accessibilityHint: "Available once the agent finishes its turn." }
        : {})}
      busy={busy}
      disabled={agentBusy}
      stretch={stretch}
      onPress={ship}
    />
  );
}

export interface ShipCardProps {
  row: ShipRow;
  agentId: string;
  theme: PluginTheme;
  compact: boolean;
  /** One more muted footer clause. The panel uses it for the cache note. */
  footnote?: string | null;
}

export function ShipCard({ row, agentId, theme, compact, footnote = null }: ShipCardProps) {
  const [failure, setFailure] = useState<string | null>(null);
  const checks = [...row.blockers, ...row.warnings];
  const headline = statusColor(row, theme);
  const padding = compact ? 14 : 16;

  const styles = useMemo(
    () => ({
      card: {
        borderRadius: 14,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface1,
        paddingHorizontal: padding,
        paddingVertical: compact ? 13 : 15,
        overflow: "hidden" as const,
      },
      head: {
        flexDirection: (compact ? "column" : "row") as "column" | "row",
        alignItems: (compact ? "stretch" : "center") as "stretch" | "center",
        gap: compact ? 12 : 14,
      },
      title: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 8,
        flexShrink: 1,
        ...(compact ? {} : { flexGrow: 1, flexBasis: 0 }),
      },
      headline: { fontSize: compact ? 15 : 16, fontWeight: "600" as const, flexShrink: 1 },
      branch: { color: theme.colors.foreground, fontSize: 13, lineHeight: 18 },
      detail: { color: theme.colors.foregroundMuted, fontSize: 12, lineHeight: 16 },
      rule: {
        height: 1,
        backgroundColor: theme.colors.border,
        marginTop: 13,
        marginHorizontal: -padding,
      },
      footer: {
        marginTop: 12,
        flexDirection: "row" as const,
        alignItems: "center" as const,
        justifyContent: "space-between" as const,
        gap: 10,
      },
      footnote: { color: theme.colors.foregroundMuted, fontSize: 11 },
      failure: {
        color: theme.colors.statusDanger,
        fontSize: 12,
        lineHeight: 16,
        marginTop: 12,
      },
    }),
    [compact, padding, theme],
  );

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <View style={styles.title}>
          <Icon name="Ship" size={16} color={headline} />
          <Text style={[styles.headline, { color: headline }]} numberOfLines={2}>
            {row.headline}
          </Text>
        </View>
        {row.ready ? (
          <ShipButton agentId={agentId} theme={theme} stretch={compact} onError={setFailure} />
        ) : null}
      </View>

      <View style={{ marginTop: 10, gap: 2 }}>
        <Text style={styles.branch} numberOfLines={1}>
          {row.branch}
        </Text>
        <Text style={styles.detail}>{row.detail}</Text>
      </View>

      {checks.length > 0 ? (
        <>
          <View style={styles.rule} />
          <View style={{ marginTop: 13, gap: 11 }}>
            {checks.map((check) => (
              <CheckLine key={check.id} check={check} theme={theme} />
            ))}
          </View>
        </>
      ) : null}

      {failure ? <Text style={styles.failure}>{failure}</Text> : null}

      <View style={styles.rule} />
      <View style={styles.footer}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 1 }}>
          <Icon name="Check" size={12} color={theme.colors.foregroundMuted} />
          <Text style={styles.footnote} numberOfLines={1}>
            {row.passed} check{row.passed === 1 ? "" : "s"} passed
            {footnote ? ` · ${footnote}` : ""}
          </Text>
        </View>
        <Text style={styles.footnote}>{checkTime(row.checkedAt)}</Text>
      </View>
    </View>
  );
}
