/**
 * Durable Tool event vocabulary shared with type-only consumers.
 *
 * @module @deepseek-ai/dsh-tools/types
 */

import type { CallId } from '@deepseek-ai/dsh-llm/brand'
import type { ContentBlock } from '@deepseek-ai/dsh-llm/types'

/** Stable identity shared by one tool call's durable policy and body records. */
export interface ToolLifecycleIdentity {
  readonly callId: CallId
  readonly rootCallId: CallId
  readonly name: string
}

/** Closed policy settlement recorded before dispatch or a policy-owned result. */
export type ToolPolicyResult =
  | { readonly outcome: 'allowed'; readonly source: 'pre-execute' | 'approval' }
  | { readonly outcome: 'denied'; readonly source: 'pre-execute' | 'approval' | 'guard' }
  | { readonly outcome: 'cancelled'; readonly source: 'approval' | 'caller' }
  | { readonly outcome: 'failed'; readonly source: 'pre-execute' | 'approval' | 'guard' }

/** Payload recorded when the ordered tool policy pipeline settles. */
export type ToolPolicyResultEventData = ToolLifecycleIdentity & ToolPolicyResult

/** Payload recorded immediately before a resolved tool body is invoked. */
export type ToolBodyStartEventData = ToolLifecycleIdentity

/** Payload recorded when an invoked tool body promise settles. */
export interface ToolBodyEndEventData extends ToolLifecycleIdentity {
  readonly outcome: 'returned' | 'threw'
  readonly aborted: boolean
}

/** Payload recorded when one nested Code Mode Tool dispatch starts. */
export interface CodeDispatchStartEventData {
  rootCallId: CallId
  parentCallId: CallId
  subCallId: CallId
  name: string
  arguments: unknown
}

/** Payload recorded when one nested Code Mode Tool dispatch settles. */
export interface CodeDispatchEventData extends CodeDispatchStartEventData {
  isError: boolean
  content: ContentBlock[]
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * The ordered pre-execute, optional approval, guard, and cancellation
     * policy settled. The event precedes dispatch or the policy-owned result;
     * it contains no reason or error text.
     */
    'tool/policy-result': ToolPolicyResultEventData
    /**
     * A resolved tool body is about to be invoked. Around-dispatch wrappers
     * that short-circuit and unknown tools produce no body start.
     */
    'tool/body-start': ToolBodyStartEventData
    /**
     * The invoked body promise fulfilled or rejected, before output
     * validation, rendering, post-execute policy, and finalization.
     */
    'tool/body-end': ToolBodyEndEventData
    /**
     * One sub-dispatch STARTING inside a `run_code` program: the parent
     * `run_code` call id, the deterministic sub-call id (`<parent>:code:<n>`,
     * numbered in submission order), and the tool `name` with its
     * JSON-normalized `arguments` — the exact value dispatched, normalized
     * BEFORE dispatch, so this append can never fail on payload shape.
     * Appended when the scheduler actually starts the call (not at
     * submission), so a start means the tool body pipeline was entered; a
     * call abandoned in the queue logs nothing. Log-only: `deriveMessages()`
     * ignores it; UIs use it for live per-sub-call running state and pair it
     * with `tool/code-dispatch` by `subCallId` (timing = the two events'
     * `time` fields).
     */
    'tool/code-dispatch-start': CodeDispatchStartEventData
    /**
     * One bridged sub-dispatch SETTLING: the pairing ids (matching the
     * `tool/code-dispatch-start` with the same `subCallId`), the tool `name`
     * with the same JSON-normalized `arguments`, and the sub-call's complete
     * model-facing outcome in `tool/result`'s own vocabulary
     * (`content` + `isError`), so UIs render a sub-call through the exact
     * code path that renders a native call. Every started sub-call settles
     * with exactly one of these (abort included: the aborted pipeline result
     * is an `isError` outcome).
     * Log-only: `deriveMessages()` ignores it, so sub-calls never re-enter
     * model context; persistence and UIs get every call. Appended inside the
     * parent `run_code`'s execution (the bridge drains in-flight dispatches
     * before returning), so its execution-enclosure relation holds by
     * construction.
     */
    'tool/code-dispatch': CodeDispatchEventData
  }
}
