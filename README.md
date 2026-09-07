# paseo-composer-pills

Three status pills in the Paseo agent composer track bar, left to right.

| Pill | Reads | Tap |
| --- | --- | --- |
| `⏱ 92% left · 3h 05m` | Claude headroom in the rolling 5h window, countdown ticks every second. Hidden for non-Claude models. | Opens **Claude limits**: every reported window (5h, weekly, per-model weekly) plus refresh. |
| `◔ 12k (6%)` | Context window usage from the agent's last turn. | Opens **Context**: input, cached, output tokens and cost. |
| `⛵ Ship` / `⛵ 2 blockers` | Whether `/ship` would succeed here right now. | Green sends `/ship` on the first tap. Blocked opens the read-only report. |

## Install

Requires Paseo with `pluginsEnabled: true` (Settings → Plugins → Enable plugins).

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

Without it the pill still reads correctly and the panel still reports. Only the one-tap ship goes nowhere: the agent just receives `/ship` as an ordinary message.

### Claude limits need a Claude token

`limits.server.ts` runs on the daemon and reads the first working OAuth token from:

1. `$CLI_PROXY_API_AUTH_DIR` or `~/.cli-proxy-api/*.json` (entries with `type: "claude"`)
2. `~/.claude/.credentials.json`
3. `~/.pi/agent/auth.json`

No token means no limit pill. Tokens never reach the client bundle.

## Ship readiness

The verdict mirrors the ship extension step for step, because a pill that disagrees with `/ship` is worse than no pill. It re-reads at the end of every agent turn, on a 60s backstop poll for idle agents, and from **Re-check ship readiness** in the Command Center (⌘K).

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

- One network call every 15 minutes at most, across all agents, pills, and windows.
- On failure, backoff from 5 to 60 minutes with jitter while still serving the last good numbers with an `error` attached.
- Last good snapshot cached at `~/.cache/paseo-composer-pills/usage.json`, so a reload shows numbers instead of firing a fetch.
- Snapshots are dropped once their 5h window passes.

The percentage can lag by up to 15 minutes. The countdown never does: the client computes it from `resets_at`.

## Layout

The row does not wrap or scroll, and Paseo's own diff pill shows up whenever the tree is dirty, which is exactly when the ship pill matters. Below 500pt window width the ship pill appears only when green, and takes the context pill's slot. Wider windows show all three.

## Files

Paseo renders composer pills in registration order with no ordering API, and a plugin can only remove its own pills. Hence one plugin, not two: `PILL_ORDER` in `pills.client.tsx` re-fixes the order on every change.

| File | Runtime | Role |
| --- | --- | --- |
| `index.ts` | shared | Registers RPC handlers, the three panels, the Command Center item, the client entrypoint |
| `pills.client.tsx` | client | Pill lifecycle, ordering, agent tracking, limit polling |
| `limit-pill.client.tsx` / `limit-panel.client.tsx` / `limits-store.client.ts` | client | Claude limit pill, panel, 1s ticker and countdown |
| `context-pill.client.tsx` / `context-panel.client.tsx` / `usage-store.client.ts` | client | Context pill, panel, per-agent usage store |
| `ship-pill.client.tsx` / `ship-panel.client.tsx` / `ship-store.client.ts` | client | Ship pill, panel with re-check and ship buttons, verdict store and width gate |
| `limits.shared.ts` / `ship.shared.ts` | shared | Zod RPC contracts, versioned verdict schema and helpers |
| `limits.server.ts` | server | Reads the Claude OAuth token, calls the usage endpoint |
| `ship.server.ts` | server | Git plumbing, quality checks, quality cache |

## Develop

```bash
npm run typecheck
paseo plugin reload paseo-composer-pills
paseo plugin logs paseo-composer-pills
```
