# paseo-composer-pills

Composer status pills for Paseo. Three pills sit in the agent composer track bar, left to right:

1. **Claude limit** (`⏱ 92% left · 3h 05m`) — headroom left in the account's rolling 5-hour window, with a countdown that ticks every second. Hidden on agents whose model clearly belongs to another vendor.
2. **Context** (`◔ 12k (6%)`) — context window usage for that agent, from the agent's last reported turn.
3. **Ship** (`⛵ Ship` or `⛵ 2 blockers`) — whether `/ship` would succeed on this workspace right now. It reads `Ship` rather than `Ready to ship` because a green pill is a button, not a status.

Tapping a pill opens its detail panel: **Claude limits** lists every reported window (5h, weekly, per-model weekly) with a refresh button; **Context** breaks down input, cached, output tokens and cost. The ship pill is the exception: when the verdict is green it sends `/ship` on the first tap instead of opening anything.

## Ship readiness

The verdict mirrors `~/.pi/agent/extensions/ship` step for step, because a pill that disagrees with `/ship` is worse than no pill. It re-reads at the end of every agent turn, on a 60-second backstop poll for idle agents, and on demand from **Re-check ship readiness** in the Command Center.

Blockers, in the order `/ship` hits them: a git operation in progress, unmerged index entries, an unresolvable destination, an `origin` with no push URL, a sensitive path in the change set, and a failing quality check.

Two things are shown but do not block, because `/ship` handles them itself: a base branch that moved, which it rebases onto, and existing commits riding along to the trunk, which it asks about first. Style findings from a formatter are not reported at all, since `/ship` rewrites and restages those files. A formatter that cannot parse a file does block.

The card stays honest in one direction only. A check that cannot be decided, such as a linter that runs past 30 seconds, is recorded as a blocker rather than a pass, so the one-tap ship is never offered for a branch `/ship` would refuse.

### Placement

The row does not wrap or scroll. Four pills on a phone squeeze every label into an ellipsis, and Paseo's own diff pill appears whenever the tree is dirty, which is exactly when the ship pill matters. So on a window narrower than 500pt the ship pill appears only when the verdict is green, and it takes the context pill's slot while it does. A wide window shows all three.

### Cost

Quality checks are the expensive part: a cold eslint run on a large repository is over ten seconds. Results are cached per working directory, HEAD, and the exact dirty state of the files being checked, including their size and mtime, so a turn that changed nothing reuses the previous run. Quality is also skipped outright while a cheaper blocker is unresolved. Only the manual re-check forces past the cache.

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
| `ship-pill.client.tsx` | client | Ship pill, verdict colors, panel id |
| `ship-panel.client.tsx` | client | Ship detail panel, re-check and ship buttons |
| `ship-store.client.ts` | client | Per-agent verdict store and the compact width gate |
| `limits.shared.ts` | shared | Zod RPC contract |
| `ship.shared.ts` | shared | Zod RPC contract, versioned verdict schema, verdict helpers |
| `limits.server.ts` | server | Reads the Claude OAuth token and calls the usage endpoint |
| `ship.server.ts` | server | Git plumbing, quality checks, quality cache |

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
