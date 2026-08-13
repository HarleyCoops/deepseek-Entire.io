# DSH Entire Tool Traces Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete tool-policy/body tracing, expose it through the existing SDK and Trajectory UI, improve workspace-folder onboarding, and ship an opt-in Entire bridge plus user documentation.

**Architecture:** The append-only SessionEvent log remains the only runtime truth. Three ignorable tool lifecycle events add policy settlement and body timing; SDK and Web fold the existing stream. A dormant base-bundle plugin writes a bounded normalized sidecar and calls Entire hooks only for repositories containing an adapter-installed marker.

**Tech Stack:** TypeScript, Cordis, React, Vitest, Playwright/Web snapshots, JSONL, Entire external-agent protocol v1.

**Spec:** `docs/superpowers/specs/2026-08-13-entire-tool-traces-design.md`

## Global Constraints

- Node is `^22.19.0 || >=24.0.0`; pnpm is `11.7.0` through Corepack.
- Follow root, `packages/`, `packages/client/`, and `docs/` AGENTS.md files.
- Every production behavior begins with a focused failing test and preserves one authoritative event source.
- New lifecycle records are non-surface, `ignorable: true`, bounded metadata only, and never model-visible.
- Entire integration is dormant by default, per-repository opt-in, and cannot fail an agent turn.
- English/Chinese documentation pairs and their consistency records change together.

---

### Task 1: Workspace-folder onboarding

**Files:**
- Modify: `packages/client/ui-workspace/src/client/WorkspacePicker.tsx`
- Modify: `packages/client/ui-workspace/src/client/WorkspacePickFlow.tsx` or the current owner of picker status rendering
- Modify: `packages/client/ui-workspace/src/client/locales/en.ts`
- Modify: `packages/client/ui-workspace/src/client/locales/zh.ts`
- Modify: `packages/client/ui-workspace/tests/workspace-picker.client.spec.tsx`
- Modify: `packages/client/ui-directory-picker-native/tests/client-flow.client.spec.tsx`
- Modify: `packages/client/ui-workspace/README.md`
- Modify: `packages/client/ui-workspace/README.zh.md`

**Interfaces:**
- Consumes: existing directory-flow owner conversation `{ open, busy, onPicked, onCancel, onError }`.
- Produces: visible `opening | cancelled | failed` state, “Choose workspace folder” copy, and an existing browse-flow retry action after native failure.

- [ ] **Step 1: Pin the empty-state copy and cancellation behavior with failing component tests.** Assert the accessible action label is `Choose workspace folder`, the helper text is `Folders only; files are not attached here.`, opening exposes a progress status, and a native cancellation produces a dismissible `No folder selected` status instead of silently returning to the identical frame.
- [ ] **Step 2: Run the focused workspace tests and confirm they fail on the old label/silent cancellation.** Run `corepack pnpm vitest run packages/client/ui-workspace/tests/workspace-picker.client.spec.tsx packages/client/ui-directory-picker-native/tests/client-flow.client.spec.tsx`.
- [ ] **Step 3: Add only the owner-local status state and copy needed by the tests.** Keep directory selection and adoption in their current owners; do not turn a Workspace into a file attachment or add a second picker service.
- [ ] **Step 4: Add the native-failure retry test.** Drive `onError`, assert the modal preserves the error and offers `Browse folders in the app`, then assert activating it switches to the already-composed browse interaction when available and otherwise keeps `Choose again`.
- [ ] **Step 5: Implement the retry through the existing directory-flow slot contract.** Do not call browse Host APIs from the native client package; make the owner select an available composed flow or retain the native retry when only one occupant exists.
- [ ] **Step 6: Run `corepack pnpm vitest run packages/client/ui-workspace packages/client/ui-directory-picker-native packages/client/ui-directory-picker-browse` and update both package READMEs/locales.**
- [ ] **Step 7: Commit the independently working onboarding change.** Use `git commit -m "fix(web): clarify workspace folder selection"` after staging only Task 1 files.

### Task 2: Durable tool policy and body lifecycle

**Files:**
- Modify: `packages/core/session/src/types.ts`
- Modify: `packages/core/session/src/index.ts`
- Modify: `packages/core/session/tests/session.spec.ts`
- Modify: `packages/core/tools/src/types.ts`
- Modify: `packages/core/tools/src/index.ts`
- Modify: `packages/core/tools/src/invariant.ts`
- Modify: `packages/core/tools/tests/tools.spec.ts`
- Modify: `packages/core/tools/tests/invariant.spec.ts`
- Modify: `packages/core/tools/tests/code-mode.spec.ts`
- Modify: `packages/core/agent-loop/tests/tool-calls.spec.ts`

**Interfaces:**
- Produces: `ToolLifecycleIdentity`, `ToolPolicyResultEventData`, `ToolBodyStartEventData`, and `ToolBodyEndEventData` exactly as specified in the approved design.
- Produces SessionEventMap members: `tool/policy-result`, `tool/body-start`, `tool/body-end`.
- Produces non-surface append intent `{ ignorable?: true }`; surface append typing stays unchanged.

- [ ] **Step 1: Write a failing Session test for an ignorable non-surface event.** Append a test-merged log-only event with `{ ignorable: true }`, assert the committed envelope contains only `ignorable: true`, and add a compile-time assertion that a surface event cannot accept that option.
- [ ] **Step 2: Run `corepack pnpm vitest run packages/core/session/tests/session.spec.ts` and confirm the option is rejected or lost.**
- [ ] **Step 3: Implement the conditional append intent.** Snapshot only `ignorable === true`; do not widen `SurfaceIntent` or allow arbitrary envelope fields.
- [ ] **Step 4: Add failing tools tests for direct allow/return.** Assert exact order `tool/policy-result`, `tool/body-start`, `tool/body-end`; stable `{ callId, rootCallId, name }`; `allowed/pre-execute`; `returned`; `aborted: false`; and `ignorable: true`.
- [ ] **Step 5: Add failing policy-matrix tests.** Cover existing approval pair before `allowed/approval`, pre-execute denial, approval rejection/unavailability/cancellation, guard denial, caller cancellation, and thrown policy stages. Invalid arguments that never enter policy must emit none of the three records.
- [ ] **Step 6: Implement one policy settlement append.** Build the complete scheduled preparation inside the stage-aware try/catch, append once, then invoke downstream `next(prepared)` outside that catch so later failures cannot be mislabeled.
- [ ] **Step 7: Add failing body-boundary tests.** Cover resolved tool success, body throw, aborted settlement, returned-but-invalid output, unknown tool, and around-wrapper short circuit. The last two have no body pair; returned-but-invalid records `returned` before a final error result.
- [ ] **Step 8: Implement the exact body bracket.** Append start synchronously immediately before `tool.execute`; append end immediately on fulfillment/rejection before validation, rendering, post hooks, and finalization.
- [ ] **Step 9: Add Code Mode and parallel integration failures.** Nested events use `subCallId` as `callId`, retain `rootCallId`, and sit inside the code-dispatch bracket. Parallel body ends use physical settlement order while root results remain model ordered.
- [ ] **Step 10: Extend the runtime invariant test-first.** Reject duplicates, body-before-allow, identity drift, outside-turn records, end-without-start, and completed results with open bodies. Accept legacy calls with no lifecycle records and crash tails with an unmatched start.
- [ ] **Step 11: Run `corepack pnpm vitest run packages/core/session packages/core/tools packages/core/agent-loop/tests/tool-calls.spec.ts` and `corepack pnpm run typecheck`.**
- [ ] **Step 12: Commit the lifecycle contract.** Use `git commit -m "feat(tools): record policy and body lifecycle"`.

### Task 3: SDK trace helpers

**Files:**
- Modify: `packages/sdk/client/src/api.ts`
- Modify: `packages/sdk/client/src/index.ts`
- Modify: `packages/sdk/client/package.json`
- Modify: `packages/sdk/client/tsconfig.json`
- Modify: `packages/sdk/client/tests/sdk-client.spec.ts`
- Modify: `packages/sdk/client/README.md`
- Modify: `packages/sdk/client/README.zh.md`
- Modify: `python/README.md`
- Modify: `python/README.zh.md`

**Interfaces:**
- Consumes: the existing unfiltered `session.event` wire notification.
- Produces: `ToolTraceEventType`, `ToolTraceEvent`, `isToolTraceEvent(event)`, and `toolTraceEvents(events)` with the exact union in the approved design.

- [ ] **Step 1: Add a failing mixed-log helper test.** Use literal events covering one member of every accepted tool/approval type plus unrelated events; assert exact filtered order and reference identity.
- [ ] **Step 2: Run `corepack pnpm vitest run packages/sdk/client/tests/sdk-client.spec.ts` and confirm the exports are missing.**
- [ ] **Step 3: Implement the pure type guard and filter.** Add type-only workspace dependencies/references for tools and user approval; do not change SDK protocol/server source or create a second subscription.
- [ ] **Step 4: Add a high-level `run()` regression assertion.** Feed the new events through the existing notification path and assert root events retain them while descendant events retain the existing notifications-only behavior.
- [ ] **Step 5: Run SDK client/protocol/server tests and typecheck.** Use `corepack pnpm vitest run packages/sdk/client packages/sdk/protocol packages/sdk/server`.
- [ ] **Step 6: Document the helper and raw-event fallback in both SDK language pairs, then commit with `git commit -m "feat(sdk): add tool trace event helpers"`.**

### Task 4: Trajectory tool-chain timing

**Files:**
- Modify: `packages/client/ui-trajectory/src/client/trajectory-tool-definition.ts`
- Create or modify: `packages/client/ui-trajectory/src/client/trajectory-approval-definition.ts`
- Modify: `packages/client/ui-trajectory/src/client/contract.ts`
- Modify: `packages/client/ui-trajectory/src/client/snapshot-builder.ts`
- Modify: `packages/client/ui-trajectory/src/client/layout.ts`
- Modify: `packages/client/ui-trajectory/src/client/TrajectoryTable.tsx`
- Modify: `packages/client/ui-trajectory/src/client/TrajectoryToolbar.tsx`
- Modify: `packages/client/ui-trajectory/tests/*.spec.ts*` at the owning test files
- Modify: `packages/client/ui-tool/src/client/tool/ToolRow.tsx`
- Modify: `packages/client/ui-tool/tests/tool-call-tree.client.spec.tsx`
- Modify: `apps/web/tests/navigation-panes.e2e.ts`
- Modify: `packages/client/ui-trajectory/README.md`
- Modify: `packages/client/ui-trajectory/README.zh.md`

**Interfaces:**
- Consumes: root/nested call identities, the three new lifecycle events, and existing approval pairs.
- Produces: per-call Total, Policy, Approval, and Body timing data; existing chat inspection opens the exact call in Trajectory under a discoverable `View tool chain` label.

- [ ] **Step 1: Write failing definition tests for root and nested lifecycle folding.** Assert identity-based joins survive interleaving and body time uses envelope timestamps rather than stored durations.
- [ ] **Step 2: Write failing approval projection tests.** Join asked/decided by approval id then call id; a decided-only truncated window remains unknown and does not throw.
- [ ] **Step 3: Run the owning `ui-trajectory` tests and verify missing timing fields.**
- [ ] **Step 4: Implement target-local lifecycle and approval state.** Keep business events in the Session window and viewing state in Trajectory; do not add a generic runtime projection or scan the full history on every update.
- [ ] **Step 5: Write failing layout/render tests.** The inspector shows Total, Policy outcome/source, Approval outcome when present, and Body outcome/aborted state; zero and incomplete spans render truthfully.
- [ ] **Step 6: Implement the smallest layout and inspector changes, then expose `View tool chain` on every tool row without requiring expansion.** Reuse the existing one-shot call-id handoff.
- [ ] **Step 7: Run `corepack pnpm run test:gui`, update the keyless Trajectory snapshot, and run `DSH_SNAPSHOT=replay corepack pnpm run test:web:built` after rebuilding the affected client bundles.**
- [ ] **Step 8: Update both package READMEs and commit with `git commit -m "feat(web): show complete tool-chain timing"`.**

### Task 5: Optional Entire bridge

**Files:**
- Create: `packages/hooks/entire-bridge/package.json`
- Create: `packages/hooks/entire-bridge/tsconfig.json`
- Create: `packages/hooks/entire-bridge/tsdown.config.ts`
- Create: `packages/hooks/entire-bridge/src/index.ts`
- Create: `packages/hooks/entire-bridge/src/types.ts`
- Create: `packages/hooks/entire-bridge/src/marker.ts`
- Create: `packages/hooks/entire-bridge/src/storage.ts`
- Create: `packages/hooks/entire-bridge/src/transcript.ts`
- Create: `packages/hooks/entire-bridge/src/redaction.ts`
- Create: `packages/hooks/entire-bridge/src/hook-runner.ts`
- Create: `packages/hooks/entire-bridge/src/invariant.ts`
- Create: `packages/hooks/entire-bridge/tests/*.spec.ts`
- Create: `packages/hooks/entire-bridge/README.md`
- Create: `packages/hooks/entire-bridge/README.zh.md`
- Modify: `packages/bundle/base/package.json`
- Modify: `packages/bundle/base/cordis.patch.yml`
- Modify: `packages/bundle/base/tests/base.spec.ts`
- Modify: TypeScript aggregate references and workspace metadata required by the package cookbook

**Interfaces:**
- Consumes: committed `session/event`, `session/created`/`session/disposed`, subagent lifecycle, session header cwd/lineage, and the subprocess argument-vector capability.
- Consumes marker: `<session cwd>/.entire/dsh-hooks.json` with `{ "schemaVersion": 1, "agent": "dsh" }`.
- Produces sidecar: `<temp>/entire-dsh/<sha256-canonical-cwd>/sessions/<session-id>.jsonl` plus `.entire/tmp/dsh-<session-id>.json` reference.
- Produces hook calls: `entire hooks dsh <session-start|turn-start|turn-end|compaction|session-end|subagent-start|subagent-end>` with one JSON payload on stdin.

- [ ] **Step 1: Scaffold only tests and package metadata.** Follow the adding-a-package cookbook and declare dependencies on session, tools, user approval, subprocess, and runtime invariants.
- [ ] **Step 2: Write failing marker tests.** Missing, malformed, future-version, wrong-agent, outside-cwd, and symlink-escaped markers stay inactive; a valid version-1 marker activates only that repository/session.
- [ ] **Step 3: Implement bounded marker reading with canonical containment checks.** Preserve clone-local opt-in and never search user-wide configuration.
- [ ] **Step 4: Write failing storage tests.** Assert stable hashed temp root, owner-only creation where supported, path traversal rejection, Windows separator handling, serial append order, concurrent-session isolation, marker content without transcript bodies, and disposal drain.
- [ ] **Step 5: Implement the sidecar writer and marker reference atomically.** Queue writes per session; contain cleanup and I/O failures as diagnostics without breaking agent work.
- [ ] **Step 6: Write failing transcript normalization tests with literal records.** Include true user prompts, committed assistant messages, root/nested tool calls/results, new timing facts, approvals, usage, compaction, and lineage. Assert omission of raw chunks, request/system/schema/env/credential/opaque/internal-injection fields.
- [ ] **Step 7: Implement bounded normalization and redaction.** Always mask obvious credential-key values; cap tool-result bytes on the complete serialized record; strict mode omits tool inputs/results and reasoning-like content.
- [ ] **Step 8: Write failing hook-runner tests.** Assert argument-vector invocation, exact stdin payload, append-before-hook ordering, unavailable/failed Entire isolation, no stdout transcript logging, cancellation, and quiescent disposal.
- [ ] **Step 9: Implement lifecycle mapping and hook runner through the repository subprocess seam.** Do not use shell interpolation or network calls.
- [ ] **Step 10: Add the package invariant and a real Loader/base-bundle composition test.** The base bundle always mounts the plugin, but no marker means zero sidecar or child process activity.
- [ ] **Step 11: Add a keyless mock lifecycle fixture and snapshot.** Drive session start, prompt, tool call/result, turn end, nested subagent, and session disposal; assert the normalized sidecar and captured hook payload sequence.
- [ ] **Step 12: Run bridge tests, typecheck, invariant/package gates, and the real composition test; commit with `git commit -m "feat(entire): add opt-in Harness trace bridge"`.**

### Task 6: Public architecture and setup documentation

**Files:**
- Modify: `README.md`
- Modify: `README.zh.md`
- Modify: `README.i18n.yaml`
- Create: `docs/user/guide/entire.md`
- Create: `docs/user/guide/entire.zh.md`
- Create: `docs/user/guide/entire.i18n.yaml`
- Modify: user-guide navigation files for both languages
- Modify: `docs/architecture.md`
- Modify: `docs/architecture.zh.md`
- Modify: generated session/persistence event catalogs through their owning generator inputs
- Create: `.agents/notes/implemented/architecture/2026-08-13-entire-tool-trace-integration.md`
- Create: matching Chinese Agent Note and pairing record

**Interfaces:**
- Documents executable `entire-agent-dsh`, adapter slug `dsh`, clone-local marker/settings, and a separate private checkpoint remote.
- Uses a repository-owned Mermaid diagram; no Entire website asset is copied.

- [ ] **Step 1: Add the concise root README section after Run and before Community.** Describe what Harness captures, Web/SDK exposure, optional Entire checkpointing, one-time trusted adapter install, per-clone enable, and private-remote/security recommendation.
- [ ] **Step 2: Write the user tutorial pair.** Prerequisites, verified install, private GitHub repo selection, `external_agents`, `entire enable --local --agent dsh --checkpoint-remote github:OWNER/REPO`, first local checkpoint inspection, first push, disable/uninstall, strict mode, and troubleshooting each end in observable checks.
- [ ] **Step 3: Update architecture/subsystem/package references at their owning tiers and regenerate event catalogs.** Link instead of duplicating the full event inventory.
- [ ] **Step 4: Add the implemented Agent Note pair.** Record why SessionEvent stays canonical, why Entire is optional/external, why the adapter belongs upstream, rejected HTTP/second-stream/artifact-parsing/clone-install alternatives, privacy consequences, and required verification.
- [ ] **Step 5: Re-record translations and run documentation gates.** Run `corepack pnpm run verify-translation-pairing --write README.md docs/user/guide/entire.md docs/architecture.md <changed-package-readmes>`, `corepack pnpm run doc-sync`, `corepack pnpm run website:build`, and `git diff --check`.
- [ ] **Step 6: Run the final relevant check ladder.** Focused unit suites, `corepack pnpm run test:gui`, keyless Web replay, typecheck, build, and the keyless Entire mock composition.
- [ ] **Step 7: Commit documentation with `git commit -m "docs: explain Harness traces and Entire checkpoints"`.**

### Task 7: Whole-branch verification

**Files:**
- Review only the complete branch diff and generated artifacts.

**Interfaces:**
- Consumes all prior task outputs.
- Produces a clean verification record; no external push or repository creation occurs in this task.

- [ ] **Step 1: Run a spec-compliance review against the approved design and resolve every load-bearing finding.**
- [ ] **Step 2: Run `corepack pnpm run typecheck`, focused package tests, `corepack pnpm run test:gui`, `DSH_SNAPSHOT=replay corepack pnpm run test:web`, bridge composition smoke, `corepack pnpm run doc-sync`, and `corepack pnpm run website:build`.**
- [ ] **Step 3: Run `git status --short`, `git diff --check`, and inspect the complete diff for secrets, generated-file drift, vendor changes, and accidental Entire checkpoint data.**
- [ ] **Step 4: Record any intentionally deferred adapter-distribution work in the user guide and Agent Note; do not claim the external adapter is installable until its own repository passes protocol compliance.**
