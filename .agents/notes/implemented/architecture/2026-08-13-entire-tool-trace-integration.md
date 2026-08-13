# Agent Note: Canonical tool traces and optional Entire checkpoints

Status: implemented

English | [中文](2026-08-13-entire-tool-trace-integration.zh.md)

## Problem

The durable session log already records model messages, root and nested tool calls/results, approvals, compaction, usage, and lineage, but it did not say whether policy admitted a call or whether the registered tool body actually ran. External checkpoint tooling also needs committed facts without becoming a second runtime authority, parsing backend-specific persistence artifacts, or affecting the model experience.

## Decision

`SessionEvent` remains the canonical trace. The tool registry appends three narrow log-only events around its existing call/result records: `tool/policy-result`, `tool/body-start`, and `tool/body-end`. They carry stable call/root identity, bounded outcome/source enums, and an aborted bit; they carry no policy explanation, error text, arguments, or result body. Existing `approval/asked` and `approval/decided` events remain the only approval audit. Runtime invariants enforce call-before-policy, allowed-policy-before-body, paired body start/end, result termination, root/nested identity, and valid interleaving for parallel calls.

The Web UI and SDKs consume the same durable stream. Timing is derived from event timestamps, so no execution telemetry stream is added. `tool/result` remains the authoritative model-facing result after validation and post-execute policy; body end describes only the registered body promise.

The base bundle mounts a dormant Entire bridge. Only the adapter-owned clone-local `.entire/dsh-hooks.json` marker activates it. The bridge projects bounded normalized sidecars from committed events and invokes fixed-argument Entire lifecycle hooks; failures are diagnostic-only. The executable adapter belongs upstream in `entireio/external-agents`, not in this repository. Its current `codex/dsh-adapter` implementation passes protocol/compliance coverage, while a real Harness-to-Entire lifecycle remains unverified until the bridge lands and an end-to-end capture passes.

## Privacy boundary

Default export keeps true prompts, committed assistant text and usage, root/nested tool calls/results, policy and approval facts, body timing, compaction, and lineage. It omits raw chunks, request headers, system prompts, full tool schemas, environment data, credentials, opaque adapter state, and injected internal context. Credential-key masking and per-result byte bounds are best effort, not secrecy. Strict mode additionally omits tool inputs/results and reasoning-like assistant content. Users must use a separate private checkpoint remote and inspect locally before the first push.

## Alternatives considered

- **A second trace stream or HTTP exporter** — rejected because consumers could observe different ordering and durability from `SessionEvent`, and an exporter would add a network and failure boundary to agent work.
- **Parsing native session artifacts in the adapter** — rejected because persistence is backend-specific and compressed; the normalized sidecar is a bounded compatibility contract.
- **Duplicating approval wait events** — rejected because the existing asked/decided pair already supplies the durable wait bracket.
- **Installing an adapter from Harness or teaching a blind clone-and-run flow** — rejected because Harness must not install an external executable or normalize unreviewed supply-chain behavior.

## Consequences

- One replay-safe stream drives the model transcript, Web trace, SDK notifications, and optional checkpoint projection.
- Denied, cancelled, unknown, wrapper-short-circuited, thrown, and aborted paths remain distinguishable without persisting error prose.
- The bridge has no prompt, token, or KV-cache effect and cannot make a successful Harness turn depend on Entire.
- Entire checkpoint creation is optional and not guaranteed by a successful Harness run; current adapter/bridge lifecycle verification status stays explicit in the user guide.
