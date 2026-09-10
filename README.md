# paseo-composer-pills

Three status pills in the Paseo agent composer track bar, left to right.

| Pill | Reads | Tap |
| --- | --- | --- |
| `⏱ 92% left · 3h 05m` | Claude headroom in the rolling 5h window, countdown ticks every second. Hidden for non-Claude models. | Opens the limits readout in place: every reported window (5h, weekly, per-model weekly). |
| `◔ 12k (6%)` | Context window usage from the agent's last turn. | Opens the context readout in place: input, cached, output tokens and cost. |
| `⛵ Ship` / `⛵ 2 blockers` | Whether `/ship` would succeed here right now. | Opens a menu: **Ship now**, **Re-check ship readiness**. |

The two readouts open where they are: a bottom sheet on a narrow window, an anchored popover on a
wide one. Nothing opens a new workspace tab. The same three panels stay registered, so **Claude
limits**, **Context**, and **Ship check** are still there for anyone who wants a tab. No pill opens
one; the Command Center's **Re-check ship readiness** is what does.

**Ship now** is the first item, so a ready branch ships in one tap after the menu opens. It is
disabled whenever the verdict is not ready, and the send still refuses a second tap while the first
is on the wire or an agent that started running since the menu was built. A refused or failed send
reports the reason instead of sending anything.

## Install

Requires Paseo 0.8 or later with `pluginsEnabled: true` (Settings → Plugins → Enable plugins).

```bash
git clone https://github.com/frailbongat/paseo-composer-pills
cd paseo-composer-pills
npm install
npm run typecheck
paseo plugin install "$PWD"
paseo plugin ls   # expect: running
```

### The ship pill needs the ship extension

Computing the verdict needs nothing but `git` plus whatever quality tools the repo already declares. **Acting** on it does: a green tap sends the literal text `/ship`, so the agent must be a pi session with the [ship extension](https://github.com/frailbongat/dotfiles/tree/main/pi/agent/extensions/ship) installed at `~/.pi/agent/extensions/ship`.

```bash
ls ~/.pi/agent/extensions/ship   # if this is empty, one-tap ship does nothing
```

Without it the pill still reads correctly and the panel still reports. Only the one-tap ship goes nowhere: the agent just receives `/ship` as an ordinary message, and since the plugin hides that message (below), it answers a question that is not on screen.

### The `/ship` message is hidden

Paseo submits a provider slash command as ordinary message text, so a tap on **Ship now** and a hand-typed `/ship` both leave a user row reading `/ship`. pi never treats it as conversation: the ship extension registers `ship` as a command, runs it, and the turn carries the ship's own output. A timeline transformer in `client/ship-echo.ts` drops that row, so the timeline shows what ship did instead of the keystroke that started it.

It matches on the first word, so `/ship main` and `/ship verbose` go too, and it follows the **Ship command** setting. A message with a line break is prose and stays. Only the echo is removed: ship's notices and the verdict row still show.

### Claude limits need a Claude token

`server/limits.ts` runs on the daemon and reads the first working OAuth token from:

1. `$CLI_PROXY_API_AUTH_DIR` or `~/.cli-proxy-api/*.json` (entries with `type: "claude"`)
2. `~/.claude/.credentials.json`
3. `~/.pi/agent/auth.json`

No token means no limit pill. Tokens never reach the client bundle.

## Ship readiness

The verdict mirrors the ship extension step for step, because a pill that disagrees with `/ship` is worse than no pill. The daemon recomputes it when a turn ends, through an `agent.turn_ended` lifecycle hook, and parks it per agent. That runs with no app connected, so the pill and the panel read a finished verdict the moment the tab opens instead of starting a check and spinning. **Re-check ship readiness** in the ship menu and in the Command Center (⌘K), and the panel's **Re-check** button, force a fresh run.

`/ship-check` in the composer runs the same forced re-check without opening anything, so it can be typed mid-message. The pill and the panel move with it.

When a turn ends, the daemon also appends the verdict to that agent's timeline as a row: the headline, the branch line, and every blocker and warning. The row uses one fixed plugin id per agent, so the next turn and every re-check replace it in place instead of stacking a second verdict. The first row waits until there is something to ship; after that the row keeps updating even once the tree goes clean. Rows live in the daemon's memory, so they survive scroll, refetch, and reconnect, but not a daemon restart.

Blockers, in the order `/ship` hits them:

1. A git operation in progress
2. Unmerged index entries
3. An unresolvable destination
4. An `origin` with no push URL
5. A sensitive path in the change set
6. A failing quality check (`prettier --check`, `eslint`, locally installed only, never `npx`)

Shown but not blocking, because `/ship` handles them: a base branch that moved (it rebases), and existing commits riding along to the trunk (it asks first). Formatter style findings are not reported at all, since `/ship` rewrites and restages those files. A formatter that cannot parse a file does block.

Undecidable checks, such as a linter running past 30s, count as blockers, never passes. One-tap ship is never offered for a branch `/ship` would refuse.

**Cost.** A cold eslint run on a large repo is over ten seconds, so results are cached per working directory, HEAD, and exact dirty state (size and mtime) of the checked files. Quality is skipped entirely while a cheaper blocker is unresolved. Only the manual re-check forces past the cache.

## Rate limits

The Anthropic usage endpoint returns `429` under load and stays angry for minutes. The server layer is built around that:

- One network call every 15 minutes at most, across all agents, pills, and windows. Nothing in the UI forces past it: opening the readout asks the daemon, which usually answers from that snapshot.

- On failure, backoff from 5 to 60 minutes with jitter while still serving the last good numbers with an `error` attached.
- Last good snapshot cached at `~/.cache/paseo-composer-pills/usage.json`, so a reload shows numbers instead of firing a fetch.
- Snapshots are dropped once their 5h window passes.

The percentage can lag by up to 15 minutes. The countdown never does: the client computes it from `resets_at`.

## Layout

The row does not wrap or scroll, and Paseo's own diff pill shows up whenever the tree is dirty, which is exactly when the ship pill matters. Below the compact width, 500pt by default, the ship pill appears only when green, and takes the context pill's slot. Wider windows show all three.

## Settings

**Settings → Plugins → Composer pills**, or `Composer pill settings` in the Command Center (⌘K). Values are host-scoped: every client of that daemon shares them, and they survive reload and restart.

| Setting | Default | What it changes |
| --- | --- | --- |
| Claude limit poll | 1 minute | How often the limits RPC runs. The reset countdown still redraws every second. |
| Treat as a phone below | 500 px | The window width under which the layout rule above applies. `Never` shows all three pills at any width. |
| Ship command | `/ship` | The text **Ship now** sends, in the pill menu and the panel. |

The pill entrypoint registers pills outside React, where no hook can run, so it reads the document over the settings RPC into `client/settings-store.ts` and re-reads it on the poll beat. Saving in the screen writes the same store, so a change lands on the pills already on screen.

## Files

Paseo renders composer pills in registration order with no ordering API, and a plugin can only remove its own pills. Hence one plugin, not two: `PILL_ORDER` in `client/pills.tsx` re-fixes the order on every change.

Since Paseo 0.8 a pill is a button descriptor rather than a component: Paseo draws the text, so each pill file exports an icon component for the live colour and a label function the entrypoint pushes with `update`. A menu item's `disabled` is a value on that descriptor rather than something a component re-reads, so `syncShipMenu` republishes the whole ship menu when readiness flips.

| File | Runtime | Role |
| --- | --- | --- |
| `index.client.tsx` | client | Registers the settings screen, the three panels, the Command Center items, the `/ship-check` slash command, the timeline transformer and renderer, the pill entrypoint |
| `index.server.ts` | server | Registers the settings document, the RPC handlers and the turn-end hook |
| `client/settings-screen.tsx` / `client/settings-store.ts` / `shared/settings.ts` | both | Settings screen, client-side value cache, the persisted document and its defaults |
| `client/pills.tsx` | client | Pill lifecycle, ordering, labels, agent tracking, limit polling |
| `client/limit-pill.tsx` / `client/limit-readout.tsx` / `client/limit-panel.tsx` / `client/limits-store.ts` | client | Claude limit pill, the readout shared by its popover and panel, 1s ticker and countdown |
| `client/context-pill.tsx` / `client/context-readout.tsx` / `client/context-panel.tsx` / `client/usage-store.ts` | client | Context pill, the readout shared by its popover and panel, per-agent usage store |
| `client/ship-pill.tsx` / `client/ship-panel.tsx` / `client/ship-store.ts` | client | Ship pill, panel with re-check and ship buttons, verdict store and width gate |
| `client/ship-actions.ts` | client | The forced re-check shared by the pill menu, the Command Center item and `/ship-check` |
| `client/ship-row.tsx` | client | Timeline renderer for the daemon's blocker row |
| `client/ship-echo.ts` | client | Timeline transformer that hides the `/ship` message the send leaves behind |
| `shared/limits.ts` / `shared/ship.ts` / `shared/timeline.ts` | shared | Zod RPC contracts, versioned verdict schema and helpers, the timeline row contract |
| `server/limits.ts` | server | Reads the Claude OAuth token, calls the usage endpoint |
| `server/ship.ts` | server | Git plumbing, quality checks, quality cache |
| `server/ship-cache.ts` | server | Per-agent verdict cache filled at turn end, read by the pill |
| `server/timeline.ts` | server | Appends the verdict to the agent timeline under a fixed row id |

## Develop

```bash
npm run typecheck
paseo plugin reload paseo-composer-pills
paseo plugin logs paseo-composer-pills
```
