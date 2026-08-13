# DeepSeek Harness

English | [中文](README.zh.md)

DeepSeek Harness (`dsh`) commits every observable fact of an agent session — every prompt, every message, and **every tool call the model makes and every result a tool returns** — into a single canonical, append-only event log. This document describes how the harness exposes that tool-calling surface as typed events, and how the optional [Entire](https://github.com/entireio/cli) bridge turns those committed events into Git-linked checkpoints.

## The canonical session log

One log per session, append-only, with every record carrying a sequence number and a timestamp. It is the single source of truth for everything the harness derives:

- model history — the messages the model actually saw;
- live UI rendering (Chat and Trajectory);
- TypeScript and Python SDK notifications;
- persistence and replay;
- telemetry and compaction;
- the Entire export.

The rule is **model-visible means logged**: anything that reaches a model request must be reconstructable from the log, and a runtime invariant asserts that. Adding a new model-visible input therefore means adding a new session event type.

## Tool-calling exposure

Every tool interaction is committed as a sequence of typed events that join together by call identity, so a reader can reconstruct the complete lifecycle of a single call from invocation to final result — including nested sub-calls and their timing — with no second trace stream.

### `tool/call` — the root invocation

When the model invokes a tool, the harness commits a `tool/call` event carrying:

- the tool `name`;
- the parsed `arguments`;
- a stable `callId`;
- the `turn` and `step` in which the call was made.

### Nested Code Mode dispatches

A single root call can, through Code Mode, invoke further tools. Each nested invocation is committed separately so the full tree is preserved:

- `tool/code-dispatch-start` records that a sub-call began, with `rootCallId`, `parentCallId`, and `subCallId`;
- `tool/code-dispatch` records the sub-call's `name`, `arguments`, `content`, and whether it errored (`isError`).

### Policy and approval

- `tool/policy-result` records the outcome and source of tool-call policy evaluation — for example, whether a call was allowed or denied before dispatch;
- `approval/asked` and `approval/decided` form the audit pair when a call required human approval: what was asked, and how it was answered.

### Tool-body timing

`tool/body-start` and `tool/body-end` bracket the actual execution of a tool's body. `tool/body-end` records only whether the body returned or threw and whether it was aborted.

Because every event carries a timestamp, the policy wait, the body duration, and the total duration of a call are all reconstructable from the log.

### `tool/result` — the authoritative outcome

`tool/result` is the model-facing result of the call: the final value after validation and any post-execution policy. It remains authoritative even though body-level events exist for timing and diagnostics.

### Consumers of the log

The Web UI renders Chat and Trajectory directly from `session/event`. The TypeScript and Python SDKs expose the same notifications with ergonomic tool-trace filtering. The Entire bridge projects a bounded subset of these events into a sidecar for checkpoints.

## Logging traces into Entire

### What Entire checkpoints are

[Entire](https://github.com/entireio/cli) is a separate tool that creates Git-linked checkpoints of agent work: a checkpoint pairs the Git changes a session produced with a transcript of what the agent did, so the work can be reviewed, searched, and resumed later.

Harness does not require Entire. The integration is an optional export — without Entire's exact clone-local marker, the harness performs no sidecar I/O and starts no Entire process.

### The bridge

The export is implemented by the base-bundle plugin `@deepseek-ai/dsh-entire-bridge` (`packages/hooks/entire-bridge`). It is a dormant observer of the session log.

### Activation

The bridge activates only when the trusted `entire-agent-dsh` adapter installs the exact clone-local marker:

```json
{"schemaVersion":1,"agent":"dsh"}
```

The marker is clone-local by design: cloning the repository never installs or executes the adapter, and the bridge never creates the marker itself.

### What happens once active

When a session starts in a marked clone, the bridge:

1. Projects committed facts into a normalized JSONL sidecar — one line per event — beneath the operating-system temporary directory:

   `<temp>/entire-dsh/<sha256-of-repository-root>/sessions/<session-id>.jsonl`

2. Writes a body-free reference at `.entire/tmp/dsh-<session-id>.json` containing only the sidecar path and bounded session metadata.

3. Emits fixed-argument lifecycle hooks that the adapter consumes, with one versioned JSON payload on stdin:

   `entire hooks dsh <hook>` for `session-start`, `turn-start`, `turn-end`, `compaction`, `session-end`, `subagent-start`, and `subagent-end`.

The adapter reads the sidecar, reassembles the tool trace, and produces the Entire checkpoint (git refs, with an optional private remote).

### What is captured

The default projection includes:

- true user prompts;
- committed assistant messages and normalized usage;
- root `tool/call` and `tool/result` records;
- nested Code Mode dispatches and their results;
- `tool/policy-result` with its bounded outcome and source;
- the `approval/asked` / `approval/decided` audit pair when approval was requested;
- `tool/body-start` / `tool/body-end` (returned / threw / aborted) for timing;
- compaction summaries;
- session and subagent lineage.

The projection omits raw assistant chunks, request headers, system prompts, complete tool schemas, environment data, credentials, opaque adapter state, and internal injected messages. Obvious credential-key values are masked, and each complete tool-result record is byte-capped.

A `strict` mode goes further: it omits tool inputs/results and reasoning-like assistant content while retaining lifecycle, prompts, final assistant text, usage, and filenames.

### Guarantees

The bridge observes committed events after model work. It adds no prompt content and no tools, consumes no model tokens, and cannot change a model request, an approval, a tool execution, or a tool result. Sidecar and hook failures are warnings only — they never fail harness work and are not proof that a checkpoint was created. Entire's Git diff remains the authoritative record of file changes.

### Enabling

The integration requires the Entire CLI (0.10) and a trusted `entire-agent-dsh` adapter on `PATH`:

```sh
entire-agent-dsh info
entire enable --local --agent dsh --checkpoint-remote github:OWNER/PRIVATE_REPO
```

### Storage and security

Sidecars and native harness session logs are sensitive local data. Use a separate private checkpoint remote, and review a checkpoint locally before its first push. Masking is best effort, not a secrecy guarantee.
