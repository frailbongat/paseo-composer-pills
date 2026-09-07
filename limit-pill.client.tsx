import { Icon, type PluginComposerPillProps, type PluginTheme } from "@getpaseo/plugin";
import { Text } from "react-native";
import {
  findWindow,
  formatCountdown,
  remainingPercent,
  useLimits,
  useNow,
} from "./limits-store.client";
import type { LimitWindow } from "./limits.shared";

export const LIMIT_PANEL_ID = "claude-limits";

export function limitColor(window: LimitWindow, theme: PluginTheme): string {
  const remaining = remainingPercent(window);
  if (remaining <= 10) return theme.colors.statusDanger;
  if (remaining <= 25) return theme.colors.statusWarning;
  return theme.colors.foregroundMuted;
}

export function LimitPill({ theme, layout }: PluginComposerPillProps) {
  const limits = useLimits();
  const now = useNow();
  const window = findWindow(limits);
  if (!window) return null;

  const color = limitColor(window, theme);
  const countdown = formatCountdown(window.resetsAt, now);
  const label = `${Math.round(remainingPercent(window))}% left${countdown ? ` · ${countdown}` : ""}`;

  return (
    <>
      <Icon name="Timer" size={layout.compact ? 13 : 14} color={color} />
      <Text
        numberOfLines={1}
        style={{
          color,
          flexShrink: 1,
          fontSize: layout.compact ? 13 : 14,
          fontVariant: ["tabular-nums"],
        }}
      >
        {label}
      </Text>
    </>
  );
}

const NON_CLAUDE = ["gpt", "codex", "gemini", "grok", "qwen", "glm", "kimi", "deepseek", "llama"];
const CLAUDE = ["claude", "anthropic", "opus", "sonnet", "haiku", "fable"];

/**
 * The limit is account-wide, so default to showing it. Only hide the pill on
 * agents whose provider or model clearly belongs to another vendor.
 */
export function isClaudeAgent(provider: string | null, model: string | null): boolean {
  const haystack = `${provider ?? ""} ${model ?? ""}`.toLowerCase();
  if (CLAUDE.some((needle) => haystack.includes(needle))) return true;
  return !NON_CLAUDE.some((needle) => haystack.includes(needle));
}
