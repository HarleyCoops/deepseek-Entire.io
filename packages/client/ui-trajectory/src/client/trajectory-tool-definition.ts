import type { Context } from '@deepseek-ai/cordis'
import type {
  ConversationMatch, ConversationNodeContext, ConversationNodeDefinition,
  RunningToolCall, ToolCallBlock, ToolResultNode,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { ToolPolicyResult } from '@deepseek-ai/dsh-tools/types'
import type { TrajectoryTimingSpan, TrajectoryToolTiming } from './trajectory-contract.ts'
import { trajectoryNode } from './trajectory-definition-common.ts'

/* jscpd:ignore-start -- Target-owned Definitions intentionally keep their event
 * state machines independent; see ../../../../../.agents/notes/implemented/
 * architecture/2026-08-09-client-conversation-node-assembly.md. */
const MAX_DEPTH = 256

interface ToolState {
  readonly rootId: string
  readonly calls: ReadonlyMap<string, ToolCallBlock>
  readonly children: ReadonlyMap<string, readonly string[]>
  readonly parents: ReadonlyMap<string, string>
  readonly lifecycle: ReadonlyMap<string, ToolLifecycleState>
}

interface ToolLifecycleState {
  readonly totalStartedAt?: number
  readonly totalCompletedAt?: number
  readonly policy?: { readonly completedAt: number; readonly result: ToolPolicyResult }
  readonly bodyStartedAt?: number
  readonly body?: {
    readonly completedAt: number
    readonly outcome: 'returned' | 'threw'
    readonly aborted: boolean
  }
}

interface DispatchData {
  readonly parentCallId: string
  readonly subCallId: string
  readonly name: string
  readonly arguments: unknown
  readonly isError?: boolean
  readonly content?: ToolResultNode['content']
}

function rootCall(match: ConversationMatch): RunningToolCall {
  if (match.event.type !== 'tool/call') {
    throw new Error('trajectory-tool-call start requires tool/call')
  }
  return {
    callId: String(match.event.data.callId),
    name: match.event.data.name,
    argsRaw: match.event.data.arguments,
    turn: match.event.data.turn,
    step: match.event.data.step,
    time: match.event.time,
    callView: match.view?.for === 'call' ? match.view.view : null,
    subCalls: [],
  }
}

function rootResult(
  match: ConversationMatch,
  previous?: RunningToolCall,
): ToolResultNode | undefined {
  if (match.event.type !== 'tool/result') return undefined
  const result = match.event.data.message.content[0]
  return {
    kind: 'tool-result',
    seq: match.event.seq,
    time: match.event.time,
    callId: String(match.event.data.message.source.callId),
    call: previous === undefined ? null : { name: previous.name, argsRaw: previous.argsRaw },
    callTime: previous?.time ?? null,
    content: result.content,
    isError: result.isError === true,
    ...(match.event.data.error === undefined ? {} : { error: match.event.data.error }),
    meta: match.event.data.meta,
    callView: previous?.callView ?? null,
    resultView: match.view?.for === 'result' ? match.view.view : null,
    subCalls: [],
  }
}

function locationTurn(match: ConversationMatch): number {
  return match.location.kind === 'step' || match.location.kind === 'turn'
    ? match.location.turn.turn
    : 0
}

function locationStep(match: ConversationMatch): number {
  return match.location.kind === 'step' ? match.location.step.step : 0
}

function childCall(match: ConversationMatch, data: DispatchData): RunningToolCall {
  return {
    callId: data.subCallId,
    name: data.name,
    argsRaw: JSON.stringify(data.arguments),
    turn: locationTurn(match),
    step: locationStep(match),
    time: match.event.time,
    callView: null,
    subCalls: [],
  }
}

function childResult(
  match: ConversationMatch,
  data: DispatchData,
  previous?: ToolCallBlock,
): ToolResultNode {
  return {
    kind: 'tool-result',
    seq: match.event.seq,
    time: match.event.time,
    callId: data.subCallId,
    call: { name: data.name, argsRaw: JSON.stringify(data.arguments) },
    callTime: previous === undefined || 'kind' in previous ? null : previous.time,
    content: data.content ?? [],
    isError: data.isError === true,
    callView: null,
    resultView: null,
    subCalls: [],
  }
}

function acceptsEdge(state: ToolState, parent: string, child: string): boolean {
  if (parent === child || state.parents.has(child)) return false
  let cursor: string | undefined = parent
  let parentDepth = 0
  const ancestors = new Set<string>()
  while (cursor !== undefined) {
    if (cursor === child || ancestors.has(cursor)) return false
    ancestors.add(cursor)
    parentDepth++
    cursor = state.parents.get(cursor)
  }
  const pending = [{ callId: child, depth: 1 }]
  const descendants = new Set<string>()
  let subtreeDepth = 0
  for (const candidate of pending) {
    if (descendants.has(candidate.callId)) return false
    descendants.add(candidate.callId)
    subtreeDepth = Math.max(subtreeDepth, candidate.depth)
    for (const nested of state.children.get(candidate.callId) ?? []) {
      pending.push({ callId: nested, depth: candidate.depth + 1 })
    }
  }
  return parentDepth + subtreeDepth <= MAX_DEPTH
}

function updateDispatch(state: ToolState, match: ConversationMatch): ToolState {
  const event = match.event
  if (event.type !== 'tool/code-dispatch-start' && event.type !== 'tool/code-dispatch') return state
  const data = event.data
  const parentId = String(data.parentCallId)
  const childId = String(data.subCallId)
  const siblings = state.children.get(parentId) ?? []
  const index = siblings.indexOf(childId)
  if (index < 0 && !acceptsEdge(state, parentId, childId)) return state
  if (event.type === 'tool/code-dispatch-start' && index >= 0) return state

  const calls = new Map(state.calls)
  calls.set(childId, event.type === 'tool/code-dispatch-start'
    ? childCall(match, data)
    : childResult(match, data, calls.get(childId)))
  const lifecycle = new Map(state.lifecycle)
  const previousLifecycle = lifecycle.get(childId) ?? {}
  lifecycle.set(childId, event.type === 'tool/code-dispatch-start'
    ? { ...previousLifecycle, totalStartedAt: match.event.time }
    : { ...previousLifecycle, totalCompletedAt: match.event.time })
  if (index >= 0) return { ...state, calls, lifecycle }
  const children = new Map(state.children)
  children.set(parentId, [...siblings, childId])
  const parents = new Map(state.parents)
  parents.set(childId, parentId)
  return { ...state, calls, children, parents, lifecycle }
}

function updateLifecycle(state: ToolState, match: ConversationMatch): ToolState {
  const event = match.event
  if (event.type !== 'tool/policy-result'
    && event.type !== 'tool/body-start'
    && event.type !== 'tool/body-end') return state
  const callId = String(event.data.callId)
  const lifecycle = new Map(state.lifecycle)
  const previous = lifecycle.get(callId) ?? {}
  if (event.type === 'tool/policy-result') {
    const result: ToolPolicyResult = event.data
    lifecycle.set(callId, {
      ...previous,
      policy: {
        completedAt: event.time,
        result,
      },
    })
  }
  else if (event.type === 'tool/body-start') {
    lifecycle.set(callId, { ...previous, bodyStartedAt: event.time })
  }
  else {
    lifecycle.set(callId, {
      ...previous,
      body: {
        completedAt: event.time,
        outcome: event.data.outcome,
        aborted: event.data.aborted,
      },
    })
  }
  return { ...state, lifecycle }
}

function span(startedAt?: number, completedAt?: number): TrajectoryTimingSpan {
  return {
    startedAt: startedAt ?? null,
    completedAt: completedAt ?? null,
    durationMs: startedAt === undefined || completedAt === undefined
      ? null
      : Math.max(0, completedAt - startedAt),
  }
}

function projectTimings(state: ToolState): ReadonlyMap<string, TrajectoryToolTiming> {
  const timings = new Map<string, TrajectoryToolTiming>()
  for (const [callId, lifecycle] of state.lifecycle) {
    const policy = lifecycle.policy
    const body = lifecycle.body
    timings.set(callId, {
      total: span(lifecycle.totalStartedAt, lifecycle.totalCompletedAt),
      policy: {
        ...span(lifecycle.totalStartedAt, policy?.completedAt),
        outcome: policy?.result.outcome ?? null,
        source: policy?.result.source ?? null,
      },
      ...(lifecycle.bodyStartedAt === undefined && body === undefined
        ? {}
        : {
          body: {
            ...span(lifecycle.bodyStartedAt, body?.completedAt),
            outcome: body?.outcome ?? null,
            aborted: body?.aborted ?? null,
          },
        }),
    })
  }
  return timings
}

function interruption(
  context: ConversationNodeContext<ToolState>,
): { seq: number; time: number } | undefined {
  const location = context.start?.location
  if (location?.kind === 'step' && location.step.status === 'closed') return location.step.end
  if ((location?.kind === 'step' || location?.kind === 'turn')
    && location.turn.status === 'closed') return location.turn.end
  return undefined
}

function projectCall(
  state: ToolState,
  callId: string,
  interruptedAt: { seq: number; time: number } | undefined,
  visited = new Set<string>(),
  depth = 1,
): ToolCallBlock | undefined {
  const block = state.calls.get(callId)
  if (block === undefined) return undefined
  if (visited.has(callId) || depth > MAX_DEPTH) return { ...block, subCalls: [] }
  const nextVisited = new Set(visited)
  nextVisited.add(callId)
  const subCalls = (state.children.get(callId) ?? [])
    .flatMap((childId) => {
      const child = projectCall(state, childId, interruptedAt, nextVisited, depth + 1)
      return child === undefined ? [] : [child]
    })
  if ('kind' in block || interruptedAt === undefined) return { ...block, subCalls }
  return {
    kind: 'tool-result',
    seq: interruptedAt.seq - 0.8,
    time: interruptedAt.time,
    callId: block.callId,
    call: { name: block.name, argsRaw: block.argsRaw },
    callTime: block.time,
    content: [],
    isError: true,
    error: { name: 'Interrupted', code: 'interrupted' },
    callView: block.callView,
    resultView: null,
    subCalls,
  }
}

function fallbackState(context: ConversationNodeContext<ToolState>): ToolState | undefined {
  const resultMatch = context.matches.find(match => match.event.type === 'tool/result')
  const root = resultMatch === undefined ? undefined : rootResult(resultMatch)
  if (root === undefined) return undefined
  let state: ToolState = {
    rootId: root.callId,
    calls: new Map([[root.callId, root]]),
    children: new Map(),
    parents: new Map(),
    lifecycle: new Map([[
      root.callId,
      {
        ...(root.callTime === null ? {} : { totalStartedAt: root.callTime }),
        totalCompletedAt: root.time,
      },
    ]]),
  }
  for (const match of context.matches) {
    state = updateLifecycle(updateDispatch(state, match), match)
  }
  return state
}

/** Trajectory-owned root Tool lifecycle with nested Code Dispatch calls. */
const trajectoryToolDefinition: ConversationNodeDefinition<ToolState> = {
  kind: 'trajectory-tool-call',
  target: 'trajectory',
  match: (event) => {
    if (event.type === 'tool/call') return { id: String(event.data.callId), role: 'start' }
    if (event.type === 'tool/result') {
      return { id: String(event.data.message.source.callId), role: 'update' }
    }
    if (event.type === 'tool/code-dispatch-start' || event.type === 'tool/code-dispatch') {
      const rootCallId: unknown = event.data.rootCallId
      return typeof rootCallId === 'string' && rootCallId !== ''
        ? { id: rootCallId, role: 'update' }
        : null
    }
    if (event.type === 'tool/policy-result'
      || event.type === 'tool/body-start'
      || event.type === 'tool/body-end') {
      const rootCallId: unknown = event.data.rootCallId
      return typeof rootCallId === 'string' && rootCallId !== ''
        ? { id: rootCallId, role: 'update' }
        : null
    }
    return null
  },
  start: (_context, match) => {
    const root = rootCall(match)
    return {
      rootId: root.callId,
      calls: new Map([[root.callId, root]]),
      children: new Map(),
      parents: new Map(),
      lifecycle: new Map([[root.callId, { totalStartedAt: match.event.time }]]),
    }
  },
  update: (context, match) => {
    if (match.event.type !== 'tool/result') {
      return updateLifecycle(updateDispatch(context.state, match), match)
    }
    const previous = context.state.calls.get(context.state.rootId)
    const running = previous !== undefined && !('kind' in previous) ? previous : undefined
    const result = rootResult(match, running)
    if (result === undefined) return context.state
    const calls = new Map(context.state.calls)
    calls.set(context.state.rootId, result)
    const lifecycle = new Map(context.state.lifecycle)
    const previousLifecycle = lifecycle.get(context.state.rootId) ?? {}
    lifecycle.set(context.state.rootId, {
      ...previousLifecycle,
      totalCompletedAt: match.event.time,
    })
    return { ...context.state, calls, lifecycle }
  },
  buildViewNode: (context) => {
    const state = context.state ?? fallbackState(context)
    if (state === undefined) return null
    const root = projectCall(state, state.rootId, interruption(context))
    if (root === undefined) return null
    const anchorSeq = context.start?.event.seq
      ?? ('kind' in root ? root.seq : context.matches[0]?.event.seq ?? 0)
    return trajectoryNode(context, anchorSeq, {
      kind: 'tool',
      root,
      timings: projectTimings(state),
    })
  },
}
/* jscpd:ignore-end */

/**
 * Register the Trajectory Tool lifecycle.
 *
 * @param ctx - Plugin context receiving the Definition.
 */
export function registerTrajectoryToolDefinition(ctx: Context): void {
  ctx.conversationEvents.register(trajectoryToolDefinition)
}
