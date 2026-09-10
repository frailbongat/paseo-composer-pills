# paseo-composer-pills

Two status pills in the Paseo agent composer track bar.

| Pill | Reads | Tap |
| --- | --- | --- |
| `⏱ 92% left · 3h 05m` | Claude headroom in the rolling 5h window, countdown ticks every second. Hidden for non-Claude models. | Opens the limits readout in place: every reported window (5h, weekly, per-model weekly). |
| `◔ 12k (6%)` | Context window usage from the agent's last turn. | Opens the context readout in place: input, cached, output tokens and cost. |

Both readouts open where they are: a bottom sheet on a narrow window, an anchored popover on a wide
one. Nothing opens a new workspace tab. Both panels stay registered, so **Claude limits** and
**Context** are still there for anyone who wants a tab.

Ship readiness used to be here as a third pill. It now lives in
[`paseo-ship-check`](https://github.com/frailbongat/paseo-ship-check), because a verdict is a list
of blockers rather than a number and never fitted in a pill. Nothing here depends on it.

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

### Claude limits need a Claude token

`server/limits.ts` runs on the daemon and reads the first working OAuth token from:

1. `$CLI_PROXY_API_AUTH_DIR` or `~/.cli-proxy-api/*.json` (entries with `type: "claude"`)
2. `~/.claude/.credentials.json`
3. `~/.pi/agent/auth.json`

No token means no limit pill. Tokens never reach the client bundle.

## Rate limits

The Anthropic usage endpoint returns `429` under load and stays angry for minutes. The server layer is built around that:

- One network call every 15 minutes at most, across all agents, pills, and windows. Nothing in the UI forces past it: opening the readout asks the daemon, which usually answers from that snapshot.

- On failure, backoff from 5 to 60 minutes with jitter while still serving the last good numbers with an `error` attached.
- Last good snapshot cached at `~/.cache/paseo-composer-pills/usage.json`, so a reload shows numbers instead of firing a fetch.
- Snapshots are dropped once their 5h window passes.

The percentage can lag by up to 15 minutes. The countdown never does: the client computes it from `resets_at`.

## Layout

The composer row does not wrap or scroll, and Paseo's own diff pill shows up whenever the tree is dirty, so two pills is what it can carry. That is part of why ship left for the timeline, the other part being that a verdict does not fit in a pill.

## Settings

**Settings → Plugins → Composer pills**, or `Composer pill settings` in the Command Center (⌘K). The value is host-scoped: every client of that daemon shares it, and it survives reload and restart.

| Setting | Default | What it changes |
| --- | --- | --- |
| Claude limit poll | 1 minute | How often the limits RPC runs. The reset countdown still redraws every second. |

The pill entrypoint registers pills outside React, where no hook can run, so it reads the document over the settings RPC into `client/settings-store.ts` and re-reads it on the poll beat. Saving in the screen writes the same store, so a change lands on the pills already on screen.

## Files

Paseo renders composer pills in registration order with no ordering API, and a plugin can only remove its own pills. Hence one plugin for both pills, not two: `PILL_ORDER` in `client/pills.tsx` re-fixes the order on every change.

Since Paseo 0.8 a pill is a button descriptor rather than a component: Paseo draws the text, so each pill file exports an icon component for the live colour and a label function the entrypoint pushes with `update`.

| File | Runtime | Role |
| --- | --- | --- |
| `index.client.tsx` | client | Registers the settings screen, both panels, the Command Center item, the pill entrypoint |
| `index.server.ts` | server | Registers the settings document and the limits RPC handler |
| `client/pills.tsx` | client | Pill lifecycle, ordering, labels, agent tracking, limit polling |
| `client/limit-pill.tsx` / `client/limit-readout.tsx` / `client/limit-panel.tsx` / `client/limits-store.ts` | client | Claude limit pill, the readout shared by its popover and panel, 1s ticker and countdown |
| `client/context-pill.tsx` / `client/context-readout.tsx` / `client/context-panel.tsx` / `client/usage-store.ts` | client | Context pill, the readout shared by its popover and panel, per-agent usage store |
| `client/settings-screen.tsx` / `client/settings-store.ts` / `shared/settings.ts` | both | Settings screen, client-side value cache, the persisted document and its defaults |
| `shared/limits.ts` | shared | The Zod RPC contract for the limits read |
| `server/limits.ts` | server | Reads the Claude OAuth token, calls the usage endpoint |

## Develop

```bash
npm run typecheck
paseo plugin reload paseo-composer-pills
paseo plugin logs paseo-composer-pills
```
