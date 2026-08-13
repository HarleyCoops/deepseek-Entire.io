# DeepSeek Harness Tool Traces and Entire Checkpoints Design

Status: approved on 2026-08-13

## Goal

DeepSeek Harness records one replayable account of agent work, renders it in Web, exposes it through the SDKs, and can optionally link it to Git commits through Entire. A clone is ready for opt-in setup, while every operator chooses their own checkpoint destination and retains local trace capture when Entire is absent.

## Product boundary

Harness owns runtime truth. Its append-only session log remains the canonical source for live rendering, reload, SDK delivery, export, and downstream adapters. Entire remains optional: it consumes a deliberately normalized Harness transcript, creates Git-linked checkpoints, and synchronizes its own `entire/checkpoints/v1` branch.

The integration has two code owners:

- This repository owns the durable trace vocabulary, SDK/Web projections, workspace onboarding, and a dormant Cordis bridge that observes committed Harness events.
- `entireio/external-agents` owns the `entire-agent-dsh` protocol executable and its release assets. The adapter is not duplicated as a second authoritative implementation here.

Cloning this repository never installs or executes an external binary. Entire discovers trusted external-agent executables only from `PATH`, so each machine explicitly installs `entire-agent-dsh` once. Each clone then opts in locally and selects its own checkpoint remote.

## Trace contents

The durable session log already records the following facts and continues to own them:

| Area | Durable facts | Correlation |
|---|---|---|
| Conversation | human and injected messages, assistant chunks and committed messages, reasoning content supplied by the provider | message identity, event sequence |
| Requests | request headers/context, provider and model provenance, token usage | turn and step |
| Agent lifecycle | turn and step start/end, cancellation and terminal errors | turn and step |
| Root tools | tool name, submitted JSON arguments, normalized model-facing result, structured failure identity, presentation metadata | `callId`, turn, step |
| Nested Code Mode tools | root/parent/subcall identity, arguments, settled content and error state | `rootCallId`, `parentCallId`, `subCallId` |
| Approval | request time, associated tool call, decision time and outcome | approval id and `callId` |
| Subagents | parent/child session lineage, lifecycle notifications and child session events | session id and parent session id |
| Compaction and hooks | durable replacements, retry/compaction facts, invoked hook and result records | event sequence and domain ids |

Three small informational events complete body-level timing without duplicating existing records:

```ts
interface ToolLifecycleIdentity {
  readonly callId: CallId
  readonly rootCallId: CallId
  readonly name: string
}

type ToolPolicyResult =
  | { readonly outcome: 'allowed'; readonly source: 'pre-execute' | 'approval' }
  | { readonly outcome: 'denied'; readonly source: 'pre-execute' | 'approval' | 'guard' }
  | { readonly outcome: 'cancelled'; readonly source: 'approval' | 'caller' }
  | { readonly outcome: 'failed'; readonly source: 'pre-execute' | 'approval' | 'guard' }

type ToolPolicyResultEventData = ToolLifecycleIdentity & ToolPolicyResult
type ToolBodyStartEventData = ToolLifecycleIdentity
type ToolBodyEndEventData = ToolLifecycleIdentity & {
  readonly outcome: 'returned' | 'threw'
  readonly aborted: boolean
}
```

The event names are `tool/policy-result`, `tool/body-start`, and `tool/body-end`. `tool/call` or `tool/code-dispatch-start` already anchors policy admission. Existing `approval/asked` and `approval/decided` events delimit approval waits. The body pair brackets only the awaited tool body; it deliberately excludes policy, wrappers, return validation, rendering, post-processing, and ordered result commit.

The new payloads contain identifiers, a tool name, closed enums, and one boolean. They never copy arguments, results, approval reasons, exceptions, stacks, signal reasons, credentials, environment variables, or durations. Envelope time is authoritative. The records carry `ignorable: true`, allowing an older reader to skip them without changing model history.

## Trace ordering and completeness

For a root tool that reaches its body, the relevant order is:

```text
tool/call
  approval/asked? -> approval/decided?
  tool/policy-result
  tool/body-start
  tool/body-end
tool/result
```

Nested Code Mode activity uses `tool/code-dispatch-start` and `tool/code-dispatch` as its outer pair. Parallel calls may interleave. Body ends reflect physical settlement order; root tool results retain model order. Consumers join by call identity rather than adjacency.

An invalid call that never enters policy emits none of the new records. A denied call emits a policy result and no body pair. An around-wrapper short circuit can be allowed without invoking the body. A process crash can leave an open body start; replay reports an incomplete span and never synthesizes an end. A body can return successfully and still produce a final tool error if later validation or post-processing fails.

## SDK and Web

The JSON-RPC server already forwards every committed `SessionEvent` as `session.event`; no second stream or wire method is added. The TypeScript SDK adds `isToolTraceEvent()` and `toolTraceEvents()` as pure helpers over existing event arrays. Python continues to receive the same typed wire records through its existing notification stream; documentation names the new event members.

Trajectory remains the verbose tool-chain view. It joins call/result, policy, approval, body, nested dispatch, and subagent facts by identity. Its Timing inspector presents Total, Policy, Approval when present, and Body. Chat exposes the existing call-to-Trajectory deep link more clearly as “View tool chain”; no parallel state model or duplicate panel is introduced.

## Entire bridge

The dormant `@deepseek-ai/dsh-entire-bridge` plugin is shipped in the base bundle but activates only when the adapter-installed `.entire/dsh-hooks.json` marker is valid. It observes committed `session/event` and lifecycle edges, serializes writes per session, and maintains a backend-independent normalized sidecar beneath an OS temporary directory:

```text
<temp>/entire-dsh/<sha256-repository-root>/sessions/<session-id>.jsonl
```

`.entire/tmp/dsh-<session-id>.json` contains only the sidecar reference and bounded session metadata. Every path is canonicalized and checked to remain beneath its expected root. Sidecar files use owner-only permissions where the platform supports them.

The normalized transcript retains session/turn lifecycle, true human prompts, committed assistant messages, root/nested tool calls and results, policy/approval/body timing, provider token usage, compaction, and subagent lineage. It omits raw assistant chunks, request headers, system prompts, full tool schemas, environment data, credentials, opaque adapter state, and internal injected context by default. Tool-result content is bounded and obvious credential-key fields are masked before the local sidecar write.

The bridge invokes Entire with an argument vector, never a shell-built command. Hook failures are contained and diagnostic-only: Harness trace persistence and the agent turn continue. Plugin disposal drains or cancels every queued append and detached hook invocation.

## Entire adapter and setup

`entire-agent-dsh` implements Entire external-agent protocol version 1 as a native Go executable. It owns discovery, marker installation, lifecycle payload parsing, transcript reads/chunking, prompt and modified-file extraction, provider-token accounting, subagent aggregation, and the best truthful resume command supported by the originating profile.

The adapter declares hooks, transcript analysis, token calculation, and subagent-aware extraction. It does not provide text generation or rewrite Harness data in place. Entire’s Git diff remains authoritative for checkpoint contents; transcript-derived filenames are normalized, repository-relative hints only.

The supported setup is explicit:

```sh
# one time per machine
entire-agent-dsh info

# once per clone, after creating or selecting a private checkpoint repository
entire enable --local --agent dsh \
  --checkpoint-remote github:OWNER/PRIVATE-CHECKPOINT-REPOSITORY
```

The adapter enables `external_agents` in clone-local Entire settings and writes only its versioned marker. It never creates a GitHub repository, authenticates an account, installs packages, or edits a user profile without a separate explicit user action.

## Workspace onboarding

“Choose workspace” means selecting an existing directory, not attaching one file. The empty-state action becomes “Choose workspace folder” with “Folders only; files are not attached here.” Native selection shows visible opening, cancellation, and error states. A native capability failure offers the already-shipped in-app browser as a retry path. Selecting the directory that contains a file makes that file reachable through Harness filesystem tools. General prompt file attachment remains a separate future capability; current attachment support stays image-only.

## Privacy and GitHub storage

Harness JSONL and the normalized local sidecar are sensitive local data and are not represented as automatically redacted. Entire applies best-effort redaction to checkpoint metadata, but redaction is not a guarantee. Entire shadow branches can contain unredacted source snapshots and must never be pushed manually.

For a public or shared source repository, documentation recommends a separate private checkpoint repository. The destination is clone-local and never committed as the project default. Operators review `entire/checkpoints/v1` before its first push and can choose a strict bridge mode that omits tool inputs/results and reasoning-like content while retaining lifecycle, prompts, final assistant messages, usage, and filenames.

## Verification

Each behavioral change follows red-green-refactor. Focused tests cover policy outcomes, approval joins, body success/throw/abort, invalid return handling, denied and wrapper-short-circuit calls, nested Code Mode, parallel settlement, invariant failures, crash tails, SDK filtering, live/reloaded Trajectory presentation, marker activation, storage containment, redaction, hook failure isolation, and shutdown drain.

The Entire adapter must pass the official external-agent protocol compliance suite plus repository-local lifecycle coverage. A keyless mock composition proves the complete Harness-to-sidecar-to-hook flow without a model key or GitHub account. Documentation validation includes bilingual pairing, generated event catalogs, Web snapshots, `doc-sync`, website build, and diff checks.

## Alternatives rejected

**A second trace service or SDK stream.** The session log already provides durable ordering, replay, transport, and export. A parallel stream would drift and complicate recovery.

**An Entire HTTP uploader in the agent loop.** Entire’s supported integration is a local external-agent protocol plus Git checkpoints. Network delivery in the loop would couple agent success to a vendor and bypass Git ownership.

**Parsing persistence artifacts directly.** JSONL can be absent, open, or compressed, while other backends do not expose an equivalent raw path. A bridge-owned normalized sidecar is stable across persistence providers.

**Installing an adapter on clone.** Clone-triggered executable installation is unsafe, and repository-local PATH changes do not reliably reach later Git hooks.

**Copying Entire website artwork.** No inspected asset carried explicit reuse terms, and a screenshot would age quickly. A source-owned Mermaid diagram communicates the stable ownership flow.
