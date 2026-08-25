# Coding memory evaluation notes

What Vectorize’s own evaluation surface implies for **pi-hindsight** defaults. Not a harness in this repo—alignment notes for agents and maintainers.

## Sources

| Source                                   | What it measures                                                                                                                 | Link                                                                                                                                                                                                                                               |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hindsight continuous perf monitor        | Retain throughput, recall p95, recall+obs, temporal recall, consolidation throughput, graph maintenance                          | [dashboard](https://vectorize-io.github.io/hindsight-continuous-performance-monitor)                                                                                                                                                               |
| AMB (Agent Memory Benchmark)             | Accuracy **and** latency/token cost; modes `rag` / `agentic-rag` / `agent` (native reflect); datasets include PersonaMem (prefs) | [repo](https://github.com/vectorize-io/agent-memory-benchmark), [leaderboard](https://agentmemorybenchmark.ai)                                                                                                                                     |
| sde-bench                                | Does a **coding agent** benefit from memory on non-guessable project decisions? `conversation` vs `history` source               | [repo](https://github.com/vectorize-io/sde-bench)                                                                                                                                                                                                  |
| Best practices / oh-my-pi / MM deep dive | Retain/recall/reflect hygiene; MM seeds; delta refresh                                                                           | [best practices](https://hindsight.vectorize.io/best-practices), [oh-my-pi post](https://hindsight.vectorize.io/blog/2026/06/08/oh-my-pi-hindsight-memory), [MM deep dive](https://hindsight.vectorize.io/blog/2026/06/05/mental-models-deep-dive) |

## Implications → pi-hindsight defaults

| Learning                                                                             | Extension implication                                                                                        |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| Conversation-only decisions are the hard discriminator for strong models (sde-bench) | Auto-**retain** of real Pi sessions is the product; do not rely on git alone                                 |
| Ranking amid noise is the problem                                                    | Prefer observations + **narrow** mental models over dumping raw facts every turn                             |
| Cost is co-equal with accuracy (AMB)                                                 | Cap MM `max_tokens` (600–800 seeds); keep recall budgets mid/low unless deep context is required             |
| Consolidation is a server hot path (perf monitor)                                    | Client should not re-synthesize every turn: inject cached MMs; use **delta** + `refresh_after_consolidation` |
| Prefs applied to multi-step work (PersonaMem / AMB)                                  | Bank-global prefs MM + explicit retain of durable prefs (not probe harness noise)                            |
| Life vs coding user banks                                                            | Coding user bank: cross-project coding prefs missions; conversation/life: `defaultLifeBankMissions()`        |
| Retain then same-turn recall is an anti-pattern                                      | Retain at `agent_end`; recall at `context` (already)                                                         |
| One MM for everything is an anti-pattern                                             | One model per knowledge dimension (architecture / conventions / decisions / prefs)                           |

## What we intentionally do **not** do

- Auto-`reflect` every turn (expensive; tools already expose reflect).
- Mega bank-global “everything about the user” models.
- Pre-summarizing before retain.
- Silent background MM create on every boot (setup / hub `t` is explicit).
- Default session-start `reflect` or per-repo banks (ADR-005 domain-tagged + Pi `context`/`recall` stay).

## Conversation / amended-rule eval tasks (in-repo)

sde-bench treats **non-guessable project decisions from conversation** (including later amendments that must win) as the hard discriminator. We do **not** vendor sde-bench; we encode client-side signals that preserve that evaluation path:

| Task id                 | Scenario                                                        | What must hold in pi-hindsight                                                                                                               | Enforced by                                                                       |
| ----------------------- | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `conv-final-state`      | User proposes rule A, then amends to rule B in the same session | Project + conversation retain missions require FINAL/LAST state only; superseded proposals only as rejected                                  | `tests/coding-memory-eval.test.ts`, bank missions / `CONVERSATION_RETAIN_MISSION` |
| `conv-not-git-only`     | Decision exists only in chat, not in git history                | Live session retain uses strategy `conversation` and remains the product core; git seed is opt-in only                                       | retain job strategy + seed tool dry-run defaults                                  |
| `tool-noise`            | Assistant runs many tools with large args                       | Compact tool-call write-back keeps name + target, drops full args by default                                                                 | `retain.compactToolCalls` + retain projection tests                               |
| `amended-cross-session` | Later session revises an earlier rule                           | Append + stable live document IDs + final-state mission text (server consolidation); client does not re-emit intermediate proposals as facts | missions + append/cursor design (docs)                                            |

Release validation priority: **conversation-amended / cross-session consolidation** over git-only smoke. Prefer live or fixture paths that retain a short decision chat that revises itself, then recall/reflect for the **last** rule.

## Related issues

- Setup ensure project + bank-global starters: #528
- Delta MM triggers on templates: #529
- MM size discipline: #530
- Mission wording vs best practices: #531
- Coding-agents shortlist stack: #557–#562
