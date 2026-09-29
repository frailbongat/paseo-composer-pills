import { execFile } from "node:child_process";
import { accessSync, constants, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import {
  FIVE_HOUR_ID,
  type LimitWindow,
  type LimitsSnapshot,
  SEVEN_DAY_ID,
} from "../shared/limits";

const USAGE_ARGS = [
  "-p",
  "/usage",
  "--output-format",
  "json",
  // Without this every poll saves a session and clutters `claude --resume`.
  "--no-session-persistence",
];
const COMMAND_TIMEOUT_MS = 20_000;

/**
 * Each poll starts a whole Claude Code process, and the numbers move slowly,
 * so poll rarely. Pills stay live because the reset countdown is computed on
 * the client from `resetsAt`.
 */
const FRESH_TTL_MS = 15 * 60_000;
const MIN_RETRY_MS = 5 * 60_000;
const MAX_RETRY_MS = 60 * 60_000;

/** Survives plugin reloads so a restart does not force an immediate refetch. */
const CACHE_DIR = join(homedir(), ".cache", "paseo-composer-pills");
const CACHE_FILE = join(CACHE_DIR, "usage.json");

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const RESET_GRACE_MS = 60_000;

/**
 * One line of the `/usage` text, e.g.
 * `Current week (all models): 2% used · resets Oct 1 at 2:59pm (Asia/Manila)`.
 */
const USAGE_LINE =
  /^Current (session|week \((.+?)\)):\s*(\d+(?:\.\d+)?)% used(?:.*?\bresets (.+?)(?:\s*\(([^()]+)\))?)?\s*$/;

/** `Sep 29 at 4:39pm`, `Oct 1 at 3pm`, or a bare `4:39pm`. */
const RESET_TEXT =
  /^(?:([A-Za-z]{3})[a-z]*\.? (\d{1,2})(?:, (\d{4}))? at )?(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i;

interface UsageResult {
  readonly type?: string;
  readonly is_error?: boolean;
  readonly result?: string;
}

interface WallClock {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
}

function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * The daemon may start without the login shell's PATH, so fall back to the
 * native installer's location when `claude` is not on it.
 */
function findClaudeBinary(): string | null {
  const onPath = (process.env.PATH ?? "")
    .split(delimiter)
    .filter(Boolean)
    .map((dir) => join(dir, "claude"));
  return [...onPath, join(homedir(), ".local", "bin", "claude")].find(isExecutable) ?? null;
}

/** The wall clock in `timeZone` at `instant`. Throws on an unknown zone. */
function wallClockIn(instant: number, timeZone: string): WallClock {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
  }).formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);
  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    hour: read("hour"),
    minute: read("minute"),
  };
}

/**
 * The instant a wall-clock time in `timeZone` names. Measures the zone's
 * offset at a first guess, then again at the corrected instant, so a DST
 * change between the two still lands on the right hour.
 */
function zonedInstant(clock: WallClock, timeZone: string): number {
  const asUtc = Date.UTC(clock.year, clock.month - 1, clock.day, clock.hour, clock.minute);
  const offsetAt = (instant: number) => {
    const seen = wallClockIn(instant, timeZone);
    return Date.UTC(seen.year, seen.month - 1, seen.day, seen.hour, seen.minute) - instant;
  };
  const guess = asUtc - offsetAt(asUtc);
  return asUtc - offsetAt(guess);
}

function closestTo(now: number, instants: number[]): number {
  return instants.reduce((best, instant) =>
    Math.abs(instant - now) < Math.abs(best - now) ? instant : best,
  );
}

/**
 * The CLI prints resets without a year, and sometimes without a date. A bare
 * time means the next time the clock reads it, with a minute of grace so a
 * reset that just passed stays today. A dated reset sits within a week of now,
 * so the closest year is the one meant: `Jan 2` read on Dec 30 lands next
 * year, and a reset that passed a minute ago does not jump a year ahead.
 */
function parseResetTime(
  text: string,
  timeZone: string,
  now: number = Date.now(),
): string | null {
  const match = RESET_TEXT.exec(text.trim());
  if (!match) return null;
  const [, monthName, dayText, yearText, hourText, minuteText, meridiem] = match;

  const hour12 = Number(hourText);
  const minute = minuteText ? Number(minuteText) : 0;
  if (hour12 < 1 || hour12 > 12 || minute > 59) return null;
  const hour = (hour12 % 12) + (meridiem.toLowerCase() === "pm" ? 12 : 0);

  try {
    const today = wallClockIn(now, timeZone);
    let instant: number;

    if (monthName === undefined) {
      // No date means the next time the clock reads this, today or tomorrow.
      const days = [0, 1].map((offset) => {
        const date = new Date(Date.UTC(today.year, today.month - 1, today.day + offset));
        return {
          year: date.getUTCFullYear(),
          month: date.getUTCMonth() + 1,
          day: date.getUTCDate(),
          hour,
          minute,
        };
      });
      const [todayAt, tomorrowAt] = days.map((clock) => zonedInstant(clock, timeZone));
      instant = todayAt >= now - RESET_GRACE_MS ? todayAt : tomorrowAt;
    } else {
      const month = MONTHS.indexOf(monthName.toLowerCase()) + 1;
      const day = Number(dayText);
      if (month === 0 || day < 1 || day > 31) return null;
      const years = yearText ? [Number(yearText)] : [today.year - 1, today.year, today.year + 1];
      instant = closestTo(
        now,
        years.map((year) => zonedInstant({ year, month, day, hour, minute }, timeZone)),
      );
    }

    return Number.isFinite(instant) ? new Date(instant).toISOString() : null;
  } catch {
    // Unknown time zone.
    return null;
  }
}

function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

/**
 * Keeps the ids the Anthropic usage API used (`five_hour`, `seven_day`,
 * `seven_day_<model>`), which the client titles and the pill's weekly-first
 * choice key off.
 */
function toWindow(scope: string, model: string | undefined): Pick<LimitWindow, "id" | "label"> {
  if (scope === "session") return { id: FIVE_HOUR_ID, label: "5h" };
  if (model === undefined || model.toLowerCase() === "all models") {
    return { id: SEVEN_DAY_ID, label: "week" };
  }
  // The label keeps the model name as the CLI printed it, so the readout can
  // title the card `Weekly (Fable)`.
  return { id: `${SEVEN_DAY_ID}_${slug(model)}`, label: `${model} week` };
}

/** Reads the `Current ...: N% used · resets ...` lines out of the `/usage` text. */
function toWindows(text: string, now: number = Date.now()): LimitWindow[] {
  const windows: LimitWindow[] = [];

  for (const line of text.split("\n")) {
    const match = USAGE_LINE.exec(line.trim());
    if (!match) continue;
    const [, scope, model, percentText, resetText, zone] = match;
    const timeZone = zone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
    windows.push({
      ...toWindow(scope, model),
      usedPercent: Math.min(100, Math.max(0, Number(percentText))),
      resetsAt: resetText === undefined ? null : parseResetTime(resetText, timeZone, now),
    });
  }

  return windows;
}

/**
 * Runs the unmodified Claude Code CLI, which reports the same numbers the
 * usage API does, so this plugin never reads the Claude login token. Async so
 * a slow CLI never blocks the daemon. Resolves with stdout even on a non-zero
 * exit, because the CLI still prints its JSON result there.
 */
function runUsageCommand(binary: string): Promise<{ stdout: string; failure: string | null }> {
  return new Promise((resolve) => {
    const child = execFile(
      binary,
      USAGE_ARGS,
      { cwd: tmpdir(), timeout: COMMAND_TIMEOUT_MS },
      (error, stdout, stderr) => {
        if (!error) return resolve({ stdout, failure: null });
        const code = (error as NodeJS.ErrnoException).code;
        let failure: string;
        if (code === "ENOENT") failure = `Claude Code CLI not found at ${binary}.`;
        else if (error.killed) failure = "Claude Code `/usage` timed out.";
        else {
          const detail = String(stderr).trim().split("\n")[0];
          failure = `Claude Code \`/usage\` exited with ${code ?? "an error"}${
            detail ? `: ${detail}` : "."
          }`;
        }
        resolve({ stdout, failure });
      },
    );
    // `-p` reads a piped stdin as extra prompt text, so close it rather than
    // leave the CLI waiting on it.
    child.stdin?.end();
  });
}

/** A window's numbers stop being true once it resets. */
function isLive(window: LimitWindow, now: number): boolean {
  return window.resetsAt === null || Date.parse(window.resetsAt) > now;
}

/**
 * A snapshot is worth showing while any window in it is still running. The
 * 5-hour window lapses long before the weekly one, and the pill leads with the
 * weekly one, so tying the whole snapshot to the 5-hour reset hid a good weekly
 * number whenever a refetch failed.
 */
function isUsable(snapshot: LimitsSnapshot | null): snapshot is LimitsSnapshot {
  if (!snapshot) return false;
  const now = Date.now();
  return snapshot.windows.some((window) => isLive(window, now));
}

/** Drops windows that have already reset, so a stale snapshot never shows old usage. */
function liveWindows(snapshot: LimitsSnapshot): LimitWindow[] {
  const now = Date.now();
  return snapshot.windows.filter((window) => isLive(window, now));
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
  if (isUsable(cached)) return { ...cached, windows: liveWindows(cached), error: lastError };
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
  const failed = (error: string): LimitsSnapshot => ({
    fetchedAt,
    account: null,
    source: null,
    windows: [],
    error,
  });

  const binary = findClaudeBinary();
  if (binary === null) {
    return failed("Claude Code CLI not found. Put `claude` on PATH or in ~/.local/bin.");
  }

  const { stdout, failure } = await runUsageCommand(binary);
  let result: UsageResult;
  try {
    result = JSON.parse(stdout) as UsageResult;
  } catch {
    return failed(failure ?? "Claude Code `/usage` did not print JSON.");
  }

  const text = typeof result.result === "string" ? result.result.trim() : "";
  if (result.type !== "result" || result.is_error) {
    return failed(`Claude Code \`/usage\` failed: ${text.split("\n")[0] || "no details"}.`);
  }
  if (failure !== null) return failed(failure);

  const windows = toWindows(text);
  if (windows.length === 0) {
    // An API-key login has no subscription limits to report.
    const said = text.split("\n")[0];
    return failed(
      `Claude Code \`/usage\` shows no subscription limits. Sign Claude Code in with a Claude subscription.${
        said ? ` It said: ${said}` : ""
      }`,
    );
  }

  return { fetchedAt, account: null, source: "claude-cli", windows, error: null };
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
