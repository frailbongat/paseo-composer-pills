# paseo-composer-pills

Composer status pills for Paseo. Two pills sit in the agent composer track bar, left to right:

1. **Claude limit** (`⏱ 92% left · 3h 05m`) — headroom left in the account's rolling 5-hour window, with a countdown that ticks every second. Hidden on agents whose model clearly belongs to another vendor.
2. **Context** (`◔ 12k (6%)`) — context window usage for that agent, from the agent's last reported turn.

Tapping a pill opens its detail panel: **Claude limits** lists every reported window (5h, weekly, per-model weekly) with a refresh button; **Context** breaks down input, cached, output tokens and cost.

## Why one plugin

Paseo appends composer pills to a single shared store and renders them in registration order. There is no ordering API, and a plugin can only remove its own pills. Splitting these into two plugins made left-to-right order a startup race. One plugin can tear down and re-add its own pills, so `PILL_ORDER` in `pills.client.tsx` fixes the order on every change.

## Files

| File | Runtime | Role |
| --- | --- | --- |
| `index.ts` | shared | Registers the RPC handler, both panels, and the client entrypoint |
| `pills.client.tsx` | client | Owns pill lifecycle, ordering, agent tracking, limit polling |
| `limit-pill.client.tsx` | client | Claude limit pill, colors, vendor filter |
| `limit-panel.client.tsx` | client | Claude limits detail panel |
| `limits-store.client.ts` | client | Shared limit snapshot, 1s ticker, countdown formatting |
| `context-pill.client.tsx` | client | Context pill and usage colors |
| `context-panel.client.tsx` | client | Context detail panel |
| `usage-store.client.ts` | client | Per-agent context usage store |
| `limits.shared.ts` | shared | Zod RPC contract |
| `limits.server.ts` | server | Reads the Claude OAuth token and calls the usage endpoint |

## Credentials

`limits.server.ts` runs on the daemon and reads the first working Claude OAuth token from:

1. `$CLI_PROXY_API_AUTH_DIR` or `~/.cli-proxy-api/*.json` (entries with `type: "claude"`)
2. `~/.claude/.credentials.json`
3. `~/.pi/agent/auth.json`

It calls `https://api.anthropic.com/api/oauth/usage` and shares one snapshot across every pill. Tokens never reach the client bundle.

## Rate limits

The usage endpoint returns `429` if you poll it hard, and it stays angry for several minutes after a burst. The server layer is built around that:

- One network call every 15 minutes at most, no matter how many agents, pills, or app windows are open.
- On failure it backs off from 5 minutes to 60 minutes with jitter, and keeps serving the last good numbers with an `error` attached.
- The last good snapshot is written to `~/.cache/paseo-composer-pills/usage.json`, so a plugin reload or daemon restart shows numbers immediately instead of firing a fetch.
- A snapshot is discarded once its 5-hour window has passed, since stale percentages would be wrong after a reset.

The percentage can lag by up to 15 minutes. The countdown never does: it is computed on the client from `resets_at` and ticks every second.

## Develop

```bash
npm install
npm run typecheck
paseo plugin reload paseo-composer-pills
paseo plugin logs paseo-composer-pills
```
