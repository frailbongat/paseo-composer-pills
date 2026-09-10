import type { PluginTheme } from "@getpaseo/plugin";
import type { PluginButtonIconProps } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import {
  findWindow,
  formatCountdown,
  readLimits,
  remainingPercent,
  useLimits,
} from "./limits-store";
import type { LimitWindow } from "../shared/limits";

export const LIMIT_PANEL_ID = "claude-limits";

export function limitColor(window: LimitWindow, theme: PluginTheme): string {
  const remaining = remainingPercent(window);
  if (remaining <= 10) return theme.colors.statusDanger;
  if (remaining <= 25) return theme.colors.statusWarning;
  return theme.colors.foregroundMuted;
}

/**
 * Paseo owns the pill's text since 0.8, so the icon is the only part of the
 * pill a plugin still paints. Keeping it a component is what keeps the
 * headroom colour live without re-registering the pill.
 */
export function LimitPillIcon({ theme, size, color }: PluginButtonIconProps) {
  const window = findWindow(useLimits());
  return (
    <Icon name="Timer" size={size} color={window ? limitColor(window, theme) : color} />
  );
}

/** Pill text, computed outside React so the entrypoint can push it with `update`. */
export function limitPillLabel(now: number): string | null {
  const window = findWindow(readLimits());
  if (!window) return null;
  const countdown = formatCountdown(window.resetsAt, now);
  return `${Math.round(remainingPercent(window))}% left${countdown ? ` · ${countdown}` : ""}`;
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
