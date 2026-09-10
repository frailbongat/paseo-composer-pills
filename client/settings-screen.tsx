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
  SettingsSection,
  SettingsSelect,
} from "@getpaseo/plugin/client/ui";
import { useEffect } from "react";
import { Text, View } from "react-native";
import { writeSettings } from "./settings-store";
import {
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

      {settings.saveError ? (
        <Text style={{ color: theme.colors.statusDanger, fontSize: 13, paddingHorizontal: 4 }}>
          {settings.saveError}
        </Text>
      ) : null}
    </View>
  );
}
