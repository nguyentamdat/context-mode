# Vendored upstream packages

These directories are source copies maintained by Pitada. Their original package metadata and license files are retained. Update them deliberately, record local changes in Git, and preserve upstream notices.

| Directory | Upstream package | Version | License |
| --- | --- | --- | --- |
| `context-mode` | `context-mode` | 1.0.169 | Elastic-2.0 |
| `pi-worktrees` | `pi-worktrees` | 0.1.0 | no declared license |
| `pi-hashline-edit-pro` | `pi-hashline-edit-pro` | 2.6.5 | MIT |
| `pi-hindsight` | `@luxusai/pi-hindsight` | 0.12.0 | MIT |
| `pi-codex-multi` | `pi-codex-multi` | 1.3.4 | MIT |
| `pi-web-access` | `pi-web-access` | 0.24.2 | MIT |
| `pi-mcp-adapter` | `pi-mcp-adapter` | 2.27.0 | MIT |
| `pi-fff` | `@ff-labs/pi-fff` | 0.10.5 | MIT |
| `ponytail` | `@dietrichgebert/ponytail` | 4.9.0 | MIT |
| `pi-intercom` | `pi-intercom` | 0.12.0 | MIT |
| `pi-background-tasks` | `pi-background-tasks` | 2.4.2 | ISC |

`pi-worktrees` has no declared license: do not redistribute it without upstream permission. Context Mode's Elastic-2.0 terms apply to its copy.

## Upstream workflow

Each vendor is a Git subtree backed by a fork under `nguyentamdat`. The authoritative mapping is [`upstreams.json`](./upstreams.json); it records the vendor path, fork, upstream, and branch.

```bash
# First-time migration only: record the current copy as the subtree baseline.
node scripts/sync-vendor.mjs pi-worktrees --adopt

# Sync the fork from its upstream and squash-merge the update into Pitada.
node scripts/sync-vendor.mjs pi-worktrees --apply
```

Do local changes in Pitada, then push the subtree to the fork with `git subtree push --prefix=vendor/<name> https://github.com/nguyentamdat/<fork>.git <branch>`. Open a PR from that fork to its upstream when appropriate. `pi-intercom` has no published upstream repository; `nguyentamdat/pi-intercom` is its canonical source.
