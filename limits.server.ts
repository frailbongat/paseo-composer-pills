import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { FIVE_HOUR_ID, type LimitWindow, type LimitsSnapshot } from "./limits.shared";

const USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const OAUTH_BETA = "oauth-2025-04-20";
const USER_AGENT = "paseo-composer-pills/1.0";
const REQUEST_TIMEOUT_MS = 10_000;

/**
 * The usage endpoint rate-limits aggressively, and the numbers move slowly, so
 * hit the network rarely. Pills stay live because the reset countdown is
 * computed on the client from `resets_at`.
 */
const FRESH_TTL_MS = 15 * 60_000;
const MIN_RETRY_MS = 5 * 60_000;
const MAX_RETRY_MS = 60 * 60_000;

/** Survives plugin reloads so a restart does not force an immediate refetch. */
const CACHE_DIR = join(homedir(), ".cache", "paseo-composer-pills");
const CACHE_FILE = join(CACHE_DIR, "usage.json");

interface Credential {
  readonly token: string;
  readonly source: string;
  readonly account: string | null;
}

interface WindowPayload {
  readonly utilization?: number | null;
  readonly resets_at?: string | null;
}

interface UsagePayload {
  readonly five_hour?: WindowPayload | null;
  readonly seven_day?: WindowPayload | null;
  readonly seven_day_opus?: WindowPayload | null;
  readonly seven_day_sonnet?: WindowPayload | null;
}

const WINDOW_LABELS: ReadonlyArray<readonly [keyof UsagePayload, string]> = [
  ["five_hour", "5h"],
  ["seven_day", "week"],
  ["seven_day_opus", "opus week"],
  ["seven_day_sonnet", "sonnet week"],
];

function readCliProxyCredentials(): Credential[] {
  const authDir = process.env.CLI_PROXY_API_AUTH_DIR ?? join(homedir(), ".cli-proxy-api");
  const credentials: Credential[] = [];

  let entries: string[];
  try {
    entries = readdirSync(authDir);
  } catch {
    return credentials;
  }

  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    try {
      const data = JSON.parse(readFileSync(join(authDir, entry), "utf8")) as {
        type?: string;
        disabled?: boolean;
        access_token?: string;
        email?: string;
      };
      if (data.type !== "claude" || data.disabled === true || !data.access_token) continue;
      const account = data.email ?? entry.replace(/^claude-/, "").replace(/\.json$/, "");
      credentials.push({ token: data.access_token, source: "cliproxyapi", account });
    } catch {
      // Unreadable or malformed credential file.
    }
  }

  return credentials;
}

function readClaudeCodeCredentials(): Credential[] {
  try {
    const data = JSON.parse(
      readFileSync(join(homedir(), ".claude", ".credentials.json"), "utf8"),
    ) as { claudeAiOauth?: { accessToken?: string } };
    const token = data.claudeAiOauth?.accessToken;
    if (!token) return [];
    return [{ token, source: "claude-code", account: null }];
  } catch {
    return [];
  }
}

function readPiCredentials(): Credential[] {
  try {
    const data = JSON.parse(
      readFileSync(join(homedir(), ".pi", "agent", "auth.json"), "utf8"),
    ) as Record<string, { access?: string } | undefined>;
    const token = data.anthropic?.access;
    if (!token) return [];
    return [{ token, source: "pi", account: null }];
  } catch {
    return [];
  }
}

/** Most trustworthy first: proxies keep their tokens refreshed. */
function readCredentials(): Credential[] {
  return [...readCliProxyCredentials(), ...readClaudeCodeCredentials(), ...readPiCredentials()];
}

function toWindows(payload: UsagePayload): LimitWindow[] {
  const windows: LimitWindow[] = [];

  for (const [key, label] of WINDOW_LABELS) {
    const value = payload[key];
    if (!value || typeof value.utilization !== "number") continue;
    const resetsAt = typeof value.resets_at === "string" ? value.resets_at : null;
    windows.push({
      id: key,
      label,
      usedPercent: Math.min(100, Math.max(0, value.utilization)),
      resetsAt: resetsAt !== null && !Number.isNaN(Date.parse(resetsAt)) ? resetsAt : null,
    });
  }

  return windows;
}

function toMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/** A snapshot is only worth showing while its 5-hour window is still running. */
function isUsable(snapshot: LimitsSnapshot | null): snapshot is LimitsSnapshot {
  if (!snapshot) return false;
  const fiveHour = snapshot.windows.find((window) => window.id === FIVE_HOUR_ID);
  if (!fiveHour) return false;
  if (fiveHour.resetsAt === null) return true;
  return Date.parse(fiveHour.resetsAt) > Date.now();
}

let cached: LimitsSnapshot | null = null;
let cachedAt = 0;
let failures = 0;
let nextAttemptAt = 0;
let lastError: string | null = null;
let inFlight: Promise<LimitsSnapshot> | null = null;
let restored = false;

function restoreOnce(): void {
  if (restored) return;
  restored = true;
  try {
    const stored = JSON.parse(readFileSync(CACHE_FILE, "utf8")) as {
      snapshot?: LimitsSnapshot;
      at?: number;
    };
    if (!stored.snapshot || !isUsable(stored.snapshot)) return;
    cached = stored.snapshot;
    cachedAt = typeof stored.at === "number" ? stored.at : 0;
  } catch {
    // No usable snapshot on disk.
  }
}

function persist(): void {
  try {
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(CACHE_FILE, JSON.stringify({ at: cachedAt, snapshot: cached }), "utf8");
  } catch {
    // Cache persistence is best effort.
  }
}

function currentSnapshot(): LimitsSnapshot {
  if (isUsable(cached)) return { ...cached, error: lastError };
  return {
    fetchedAt: new Date().toISOString(),
    account: null,
    source: null,
    windows: [],
    error: lastError ?? "Claude usage is not available yet.",
  };
}

async function fetchSnapshot(): Promise<LimitsSnapshot> {
  const fetchedAt = new Date().toISOString();
  const credentials = readCredentials();

  if (credentials.length === 0) {
    return {
      fetchedAt,
      account: null,
      source: null,
      windows: [],
      error: "No Claude OAuth credential found on this machine.",
    };
  }

  let error = "Claude usage endpoint returned no data.";

  for (const credential of credentials) {
    try {
      const response = await fetch(USAGE_URL, {
        headers: {
          authorization: `Bearer ${credential.token}`,
          "anthropic-beta": OAUTH_BETA,
          "user-agent": USER_AGENT,
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (!response.ok) {
        error =
          response.status === 429
            ? "Claude usage endpoint is rate limiting, backing off."
            : `Claude usage request failed (${response.status}).`;
        continue;
      }

      const windows = toWindows((await response.json()) as UsagePayload);
      if (windows.length === 0) {
        error = "Claude usage response had no rate-limit windows.";
        continue;
      }

      return {
        fetchedAt,
        account: credential.account,
        source: credential.source,
        windows,
        error: null,
      };
    } catch (caught) {
      error = toMessage(caught);
    }
  }

  return { fetchedAt, account: null, source: null, windows: [], error };
}

function onSuccess(snapshot: LimitsSnapshot): LimitsSnapshot {
  cached = snapshot;
  cachedAt = Date.now();
  failures = 0;
  nextAttemptAt = 0;
  lastError = null;
  persist();
  const summary = snapshot.windows
    .map((window) => `${window.label}:${Math.round(100 - window.usedPercent)}%`)
    .join(" ");
  console.log(`[limits] fetched ${summary}`);
  return snapshot;
}

function onFailure(error: string): LimitsSnapshot {
  failures += 1;
  lastError = error;
  const backoff = Math.min(MAX_RETRY_MS, MIN_RETRY_MS * 2 ** (failures - 1));
  // Jitter keeps several daemons from retrying in lockstep.
  nextAttemptAt = Date.now() + backoff + Math.floor(Math.random() * 15_000);
  console.log(
    `[limits] ${error} retry in ${Math.round(backoff / 60_000)}m (attempt ${failures}, stale=${
      isUsable(cached) ? "yes" : "no"
    })`,
  );
  return currentSnapshot();
}

export async function readClaudeLimitsHandler(
  input: { force?: boolean } = {},
): Promise<LimitsSnapshot> {
  restoreOnce();
  const now = Date.now();

  if (!input.force && isUsable(cached) && now - cachedAt < FRESH_TTL_MS) return currentSnapshot();
  // A manual refresh may skip the freshness window, never the backoff.
  if (now < nextAttemptAt) return currentSnapshot();
  if (inFlight) return inFlight;

  inFlight = fetchSnapshot()
    .then((snapshot) => (snapshot.error === null ? onSuccess(snapshot) : onFailure(snapshot.error)))
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
}
