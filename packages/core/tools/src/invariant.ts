/** Package-owned tool-pipeline invariants. @module @deepseek-ai/dsh-tools/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type { ToolExecution, ToolExecutionResult } from './index.ts'
import type { ToolLifecycleIdentity, ToolPolicyResult } from './types.ts'

const PACKAGE_NAME = '@deepseek-ai/dsh-tools'

/** Cordis companion plugin name. */
export const name = 'tools-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

type ToolStage = 'pre' | 'execute' | 'post'

interface ToolLifecycleState {
  readonly identity: ToolLifecycleIdentity
  policy?: ToolPolicyResult['outcome']
  bodyStarted: boolean
  bodyEnded: boolean
}

type ToolLifecycleEvent = Extract<SessionEvent, {
  type: 'tool/policy-result' | 'tool/body-start' | 'tool/body-end'
}>

function isLifecycleEvent(event: SessionEvent): event is ToolLifecycleEvent {
  return event.type === 'tool/policy-result'
    || event.type === 'tool/body-start'
    || event.type === 'tool/body-end'
}

function sameIdentity(left: ToolLifecycleIdentity, right: ToolLifecycleIdentity): boolean {
  return left.callId === right.callId
    && left.rootCallId === right.rootCallId
    && left.name === right.name
}

function admissionIdentity(event: SessionEvent): ToolLifecycleIdentity | undefined {
  if (event.type === 'tool/call') {
    return {
      callId: event.data.callId,
      rootCallId: event.data.callId,
      name: event.data.name,
    }
  }
  if (event.type === 'tool/code-dispatch-start') {
    return {
      callId: event.data.subCallId,
      rootCallId: event.data.rootCallId,
      name: event.data.name,
    }
  }
  return undefined
}

function completedCallId(event: SessionEvent): string | undefined {
  if (event.type === 'tool/result') return String(event.data.message.source.callId)
  if (event.type === 'tool/code-dispatch') return String(event.data.subCallId)
  return undefined
}

/** Validate the immutable final execution/result snapshot. */
function validateResult(
  exec: Readonly<ToolExecution>,
  result: Readonly<ToolExecutionResult>,
  fail: InvariantFailure,
): void {
  if (!Object.isFrozen(exec)) fail('tools/result execution must be frozen before publication')
  if (!Object.isFrozen(result) || !Object.isFrozen(result.content)) {
    fail('tools/result outcome and content must be frozen before publication')
  }
  if (exec.name.length === 0 || String(exec.callId).length === 0) {
    fail('tools/result execution must carry non-empty name and callId')
  }
}

/** Install monotonic pipeline, final-snapshot, and code-dispatch enclosure checks. */
const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  const stages = new WeakMap<object, ToolStage>()
  const openTurns = new WeakMap<Session, number | null>()
  const dispatchRoots = new WeakMap<Session, Map<string, string>>()
  const admissionIdentities = new WeakMap<Session, Map<string, ToolLifecycleIdentity>>()
  const lifecycles = new WeakMap<Session, Map<string, ToolLifecycleState>>()
  const validateDispatch = (session: Session, event: SessionEvent): void => {
    if (event.type !== 'tool/code-dispatch-start' && event.type !== 'tool/code-dispatch') return
    const root = String(event.data.rootCallId)
    const parent = String(event.data.parentCallId)
    const child = String(event.data.subCallId)
    if (root.length === 0 || parent.length === 0 || child.length === 0) {
      fail(`${event.type} must carry non-empty rootCallId, parentCallId, and subCallId`)
      return
    }
    const roots = dispatchRoots.get(session)
    const known = roots?.get(child)
    if (known !== undefined && known !== root) fail(`${event.type} changed rootCallId for subCallId ${child}`)
    if (parent !== root && roots?.get(parent) !== root) {
      fail(`${event.type} parentCallId ${parent} does not belong to rootCallId ${root}`)
    }
  }
  const commitDispatch = (session: Session, event: SessionEvent): void => {
    if (event.type !== 'tool/code-dispatch-start' && event.type !== 'tool/code-dispatch') return
    const roots = dispatchRoots.get(session) as Map<string, string>
    roots.set(String(event.data.subCallId), String(event.data.rootCallId))
  }
  const commitAdmission = (session: Session, event: SessionEvent): void => {
    const identity = admissionIdentity(event)
    if (identity === undefined) return
    const admissions = admissionIdentities.get(session) as Map<string, ToolLifecycleIdentity>
    admissions.set(String(identity.callId), identity)
  }
  const validateLifecycle = (session: Session, event: SessionEvent): void => {
    if (event.type === 'turn/end') {
      for (const [callId, state] of lifecycles.get(session) ?? []) {
        if (state.bodyStarted && !state.bodyEnded) {
          fail(`turn/end completed with an open tool body for callId ${callId}`)
        }
      }
    }
    const callId = completedCallId(event)
    if (callId !== undefined) {
      const state = lifecycles.get(session)?.get(callId)
      if (state?.bodyStarted === true && !state.bodyEnded) {
        fail(`${event.type} for callId ${callId} completed with an open tool body`)
      }
    }
    if (!isLifecycleEvent(event)) return
    if (event.ignorable !== true) fail(`${event.type} must be marked ignorable`)
    const identity: ToolLifecycleIdentity = event.data
    const key = String(identity.callId)
    if (key.length === 0 || String(identity.rootCallId).length === 0 || identity.name.length === 0) {
      fail(`${event.type} must carry non-empty callId, rootCallId, and name`)
      return
    }
    const admission = admissionIdentities.get(session)?.get(key)
    if (admission === undefined) fail(`no tool admission anchor for callId ${key}`)
    if (!sameIdentity(admission, identity)) {
      fail(`${event.type} changed lifecycle identity for callId ${key}`)
    }
    const state = lifecycles.get(session)?.get(key)
    if (state !== undefined && !sameIdentity(state.identity, identity)) {
      fail(`${event.type} changed lifecycle identity for callId ${key}`)
      return
    }
    if (event.type === 'tool/policy-result') {
      if (state?.policy !== undefined) fail(`tool/policy-result repeated for callId ${key}`)
      return
    }
    if (event.type === 'tool/body-start') {
      if (state?.policy !== 'allowed') fail(`tool/body-start requires an allowed tool/policy-result for callId ${key}`)
      if (state?.bodyStarted === true) fail(`tool/body-start repeated for callId ${key}`)
      return
    }
    if (state?.bodyStarted !== true) fail(`tool/body-end requires tool/body-start for callId ${key}`)
    if (state?.bodyEnded === true) fail(`tool/body-end repeated for callId ${key}`)
  }
  const commitLifecycle = (session: Session, event: SessionEvent): void => {
    if (!isLifecycleEvent(event)) return
    const key = String(event.data.callId)
    const states = lifecycles.get(session) as Map<string, ToolLifecycleState>
    const previous = states.get(key)
    const state: ToolLifecycleState = previous ?? {
      identity: {
        callId: event.data.callId,
        rootCallId: event.data.rootCallId,
        name: event.data.name,
      },
      bodyStarted: false,
      bodyEnded: false,
    }
    if (event.type === 'tool/policy-result') state.policy = event.data.outcome
    else if (event.type === 'tool/body-start') state.bodyStarted = true
    else state.bodyEnded = true
    states.set(key, state)
  }
  const seed = (session: Session): number | null => {
    let openTurn: number | null = null
    dispatchRoots.set(session, new Map())
    admissionIdentities.set(session, new Map())
    lifecycles.set(session, new Map())
    for (const event of session.events) {
      if ((event.type === 'tool/code-dispatch-start' || event.type === 'tool/code-dispatch' || isLifecycleEvent(event))
        && openTurn === null) {
        fail(`${event.type} appended outside any open turn`)
      }
      validateDispatch(session, event)
      validateLifecycle(session, event)
      commitDispatch(session, event)
      commitAdmission(session, event)
      commitLifecycle(session, event)
      if (event.type === 'turn/start') openTurn = event.data.turn
      else if (event.type === 'turn/end') openTurn = null
    }
    openTurns.set(session, openTurn)
    return openTurn
  }
  const openTurnFor = (session: Session): number | null => openTurns.get(session) ?? seed(session)

  for (const session of ctx.sessions.list()) seed(session)
  ctx.on('session/created', (session) => { seed(session) }, { global: true })
  ctx.on('session/event', (session, event) => {
    validateDispatch(session, event)
    validateLifecycle(session, event)
    commitDispatch(session, event)
    commitAdmission(session, event)
    commitLifecycle(session, event)
    if (event.type === 'turn/start') openTurns.set(session, event.data.turn)
    else if (event.type === 'turn/end') openTurns.set(session, null)
  }, { global: true })
  ctx.on('internal/dispatch', (_mode, eventName, args) => {
    if (eventName === 'session/event') {
      const [session, event] = args as [Session, SessionEvent]
      if ((event.type === 'tool/code-dispatch-start' || event.type === 'tool/code-dispatch' || isLifecycleEvent(event))
        && openTurnFor(session) === null) {
        fail(`${event.type} appended outside any open turn`)
      }
      validateDispatch(session, event)
      validateLifecycle(session, event)
      return
    }
    if (eventName === 'tools/pre-execute') {
      const exec = args[0] as ToolExecution
      if (stages.has(exec)) fail('tools/pre-execute repeated for one execution')
      stages.set(exec, 'pre')
      return
    }
    if (eventName === 'tools/execute') {
      const exec = args[0] as ToolExecution
      if (stages.get(exec) !== 'pre') fail('tools/execute must follow tools/pre-execute')
      stages.set(exec, 'execute')
      return
    }
    if (eventName === 'tools/post-execute') {
      const exec = args[0] as ToolExecution
      const previous = stages.get(exec)
      if (previous !== 'pre' && previous !== 'execute') {
        fail('tools/post-execute must follow tools/pre-execute or tools/execute')
      }
      stages.set(exec, 'post')
      return
    }
    if (eventName !== 'tools/result') return
    const [exec, result] = args as [Readonly<ToolExecution>, Readonly<ToolExecutionResult>]
    validateResult(exec, result, fail)
    stages.delete(exec)
  }, { global: true })
}, { inject: ['sessions'] })

/**
 * Register the tools invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
