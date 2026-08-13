# Export Harness traces to Entire

English | [中文](entire.zh.md)

[Entire](https://github.com/entireio/cli) checkpoints can preserve a reviewable record of Harness work beside the Git changes it produced. The integration is optional: without Entire's exact clone-local marker, Harness does no sidecar I/O and starts no Entire process.

> Current availability: the `entire-agent-dsh` source currently lives on the `codex/dsh-adapter` branch of `entireio/external-agents`; it is not yet a released adapter. Its protocol and compliance tests pass, but a real Harness-to-Entire lifecycle remains unverified until the Harness bridge is merged and an end-to-end checkpoint capture passes. This paragraph is the single status statement to update after that verification.

## Before you enable it

- Install Entire CLI 0.10 and confirm `entire version` runs.
- Give each Harness workspace clone its own private GitHub checkpoint repository. Do not point checkpoints at the source repository or reuse one checkpoint repository across clones.
- Obtain `entire-agent-dsh` from a source or binary you trust. If building the current preview, review the `entireio/external-agents` `codex/dsh-adapter` branch, build `agents/entire-agent-dsh/cmd/entire-agent-dsh`, place the resulting executable on `PATH`, and run `entire-agent-dsh info` before enabling it.
- Keep `dsh`, `entire`, and `entire-agent-dsh` on `PATH` for the Harness process.

The adapter is an executable that Entire invokes. Treat installing it like installing any other local developer tool: review its provenance and permissions rather than accepting an unreviewed clone or binary.

## Enable one clone

From the root of the Harness workspace clone you want to checkpoint, run:

```sh
entire agent list
entire enable --local --agent dsh --checkpoint-remote github:OWNER/PRIVATE_REPO
```

Selecting the external `dsh` agent enables Entire's `external_agents` discovery and writes clone-local settings. A fresh Entire 0.10 setup selects the per-checkpoint `git-refs` backend; do not assume or automate against a checkpoint branch name. Existing repositories retain their configured backend unless you change it.

Successful setup installs the exact owned marker at `.entire/dsh-hooks.json`:

```json
{"schemaVersion":1,"agent":"dsh"}
```

Do not create or edit that marker by hand. The adapter refuses unknown, symlinked, or non-regular marker files and will not take ownership of another tool's content.

Entire telemetry is separate from Harness telemetry. To opt out while enabling, add `--telemetry=false`; to change it later, run `entire configure --telemetry=false`.

## Inspect before the first push

Run a small Harness task in this clone and make the intended local Git commit, then inspect it before pushing anything:

```sh
entire status
entire checkpoint list
entire checkpoint explain <checkpoint-id>
git show --stat HEAD
```

Confirm that the checkpoint belongs to the expected clone, contains only the intended Git changes and transcript facts, and targets `github:OWNER/PRIVATE_REPO`. Only then run your normal `git push`; Entire handles the configured checkpoint refs without requiring a checkpoint branch name.

Entire's Git diff is authoritative for changed files. Harness supplies conservative file hints for presentation, not a substitute for reviewing the diff.

## What is captured

Harness keeps one canonical append-only `SessionEvent` log. The Entire bridge projects committed facts from that log into a normalized JSONL sidecar:

- true user prompts, committed assistant messages, normalized provider usage, compaction, and session/subagent lineage;
- root `tool/call` and `tool/result` records plus nested Code Mode dispatches and results;
- `tool/policy-result`, including its bounded outcome/source, and the existing `approval/asked` / `approval/decided` audit pair when approval was requested;
- `tool/body-start` and `tool/body-end`, including returned/threw and aborted state, so timestamps reconstruct policy wait, body duration, and total duration.

The default projection omits raw assistant chunks, request headers, system prompts, complete tool schemas, environment data, credentials, opaque adapter state, and internal injected messages. Obvious credential-key values are masked and each complete tool-result record is byte-capped, but masking is best effort: secrets embedded in prose, source, prompts, or unexpected fields may remain.

Sidecars and native Harness session logs contain sensitive local data. They live under their respective local storage roots, follow those locations' retention policies, and must not be treated as secret storage. Use a separate private checkpoint remote and inspect locally before the first push.

### Strict capture

Set `strict: true` on the base bundle's `entire-bridge` Cordis row when prompts and committed assistant text are acceptable but tool inputs/results and reasoning-like assistant content must stay out of the sidecar. Strict mode does not redact the Git diff, ordinary prompt text, or ordinary committed assistant text; review those separately.

The bridge observes committed events after model work. It adds no prompt section or tool, consumes no model tokens, and cannot change model requests, approvals, tool execution, or results. Sidecar and hook failures are warnings, not proof that a checkpoint was created.

## Disable or uninstall

From the same clone:

```sh
entire disable
```

This disables Entire while retaining its local setup. To remove all Entire integrations from the clone, including the owned DSH marker, run:

```sh
entire disable --uninstall
```

To remove only the DSH adapter integration while keeping other Entire agents, use `entire agent remove dsh`. Uninstall refuses a marker it does not own; inspect `.entire/dsh-hooks.json` instead of deleting unexpected content automatically.

## Troubleshooting

- **`dsh` is absent from `entire agent list`** — Confirm `entire-agent-dsh` is on the same `PATH` as Entire, run `entire-agent-dsh info`, and rerun enable so `external_agents` is set for this clone.
- **No marker appears** — Run enable from the intended Git clone root. Do not copy a marker from another clone.
- **Harness succeeds but no checkpoint appears** — Bridge and hook failures are intentionally diagnostic-only. Check Harness warnings, `entire status`, executable discovery, and local sidecar/reference permissions.
- **The marker is rejected** — The adapter accepts only the exact owned regular file. A symlink, directory, unknown JSON field, different agent, or unsupported schema version fails closed.
- **A checkpoint contains too much transcript data** — Do not push it. Enable strict capture, start a new session, inspect the new local checkpoint, and rotate any exposed secret.
