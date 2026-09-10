/**
 * Settings → Plugins → Composer pills.
 *
 * Paseo owns the header, the scroll, and the centered column, so this renders
 * sections and rows and nothing else. Every successful save is also written
 * into `settings-store`, so the pills already on screen pick the change up on
 * the same tap instead of on the next reload.
 */

import { useSettings, type PluginSurfaceProps } from "@getpaseo/plugin/client";
import {
  SettingsAction,
  SettingsCard,
  SettingsInput,
  SettingsSection,
  SettingsSelect,
} from "@getpaseo/plugin/client/ui";
import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { writeSettings } from "./settings-store";
import {
  DEFAULT_SHIP_COMMAND,
  LIMITS_POLL_SECONDS_OPTIONS,
  type PillSettings,
  pillSettings,
  pollSecondsLabel,
} from "../shared/settings";

const POLL_OPTIONS = LIMITS_POLL_SECONDS_OPTIONS.map((seconds) => ({
  label: pollSecondsLabel(seconds),
  value: String(seconds),
}));

export function SettingsScreen({ theme }: PluginSurfaceProps) {
  const settings = useSettings(pillSettings);
  const saved = settings.status === "ready" ? settings.values : null;

  // The input owns its in-progress text, so the draft lives here and only
  // reaches the document when Save is pressed.
  const [draft, setDraft] = useState<string | null>(null);
  const command = draft ?? saved?.shipCommand ?? DEFAULT_SHIP_COMMAND;
  const trimmed = command.trim();
  const commandError = trimmed.length === 0 ? "The command cannot be empty." : null;
  const commandDirty = saved !== null && trimmed !== saved.shipCommand;

  // A document changed on another client arrives here, so the store follows it
  // whenever this screen is open.
  useEffect(() => {
    if (saved) writeSettings(saved);
  }, [saved]);

  async function apply(patch: Partial<PillSettings>): Promise<void> {
    if (settings.status !== "ready") return;
    const next = { ...settings.values, ...patch };
    // `save` never throws; a false return leaves `saveError` on the state, and
    // the store keeps the value the pills are actually running with.
    if (await settings.save(next, settings.revision)) writeSettings(next);
  }

  const muted = { color: theme.colors.foregroundMuted, fontSize: 13, lineHeight: 18 };

  if (settings.status !== "ready") {
    return (
      <View style={{ gap: 12, paddingVertical: 12 }}>
        <Text style={muted}>
          {settings.status === "loading"
            ? "Loading settings…"
            : `Settings unavailable: ${settings.error}`}
        </Text>
        {settings.status === "invalid" || settings.status === "error" ? (
          <SettingsCard>
            <SettingsAction
              label="Restore defaults"
              hint="Replaces the stored document with the values this plugin shipped with."
              actionLabel="Reset"
              disabled={settings.saving}
              onPress={() => void settings.reset()}
            />
          </SettingsCard>
        ) : null}
      </View>
    );
  }

  return (
    <View style={{ gap: 4 }}>
      <SettingsSection title="Refresh">
        <SettingsCard>
          <SettingsSelect
            label="Claude limit poll"
            hint="How often the daemon is asked for fresh limit windows. The reset countdown still ticks every second."
            value={String(settings.values.limitsPollSeconds)}
            options={POLL_OPTIONS}
            disabled={settings.saving}
            onValueChange={(value) => void apply({ limitsPollSeconds: Number(value) })}
          />
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title="Ship">
        <SettingsCard>
          <SettingsInput
            label="Ship command"
            hint="Sent to the agent as ordinary message text when you press Ship on the timeline card."
            placeholder={DEFAULT_SHIP_COMMAND}
            initialValue={settings.values.shipCommand}
            error={commandError}
            disabled={settings.saving}
            onChangeText={setDraft}
          />
          <SettingsAction
            label="Save ship command"
            actionLabel={settings.saving ? "Saving…" : "Save"}
            disabled={settings.saving || commandError !== null || !commandDirty}
            onPress={() => {
              void apply({ shipCommand: trimmed }).then(() => setDraft(null));
            }}
          />
        </SettingsCard>
      </SettingsSection>

      {settings.saveError ? (
        <Text style={{ color: theme.colors.statusDanger, fontSize: 13, paddingHorizontal: 4 }}>
          {settings.saveError}
        </Text>
      ) : null}
    </View>
  );
}
