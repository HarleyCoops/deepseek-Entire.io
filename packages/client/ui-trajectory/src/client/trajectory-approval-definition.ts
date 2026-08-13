import type { Context } from '@deepseek-ai/cordis'
import type {
  ConversationMatch, ConversationNodeContext, ConversationNodeDefinition,
} from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-user-approval'
import type { ApprovalOutcome } from '@deepseek-ai/dsh-user-approval/types'
import type { TrajectoryApprovalTiming } from './trajectory-contract.ts'
import { trajectoryNode } from './trajectory-definition-common.ts'

interface ApprovalState {
  readonly callId: string
  readonly startedAt: number
  readonly completedAt?: number
  readonly outcome?: ApprovalOutcome
}

function startState(match: ConversationMatch): ApprovalState {
  if (match.event.type !== 'approval/asked' || match.event.data.callId === undefined) {
    throw new Error('trajectory approval start requires approval/asked with callId')
  }
  return {
    callId: String(match.event.data.callId),
    startedAt: match.event.time,
  }
}

function updateState(state: ApprovalState, match: ConversationMatch): ApprovalState {
  if (match.event.type !== 'approval/decided') return state
  return {
    ...state,
    completedAt: match.event.time,
    outcome: match.event.data.outcome,
  }
}

function fallbackState(context: ConversationNodeContext<ApprovalState>): ApprovalState | undefined {
  const asked = context.matches.find(match => match.event.type === 'approval/asked'
    && match.event.data.callId !== undefined)
  if (asked === undefined) return undefined
  let state = startState(asked)
  for (const match of context.matches) state = updateState(state, match)
  return state
}

function project(state: ApprovalState): TrajectoryApprovalTiming {
  return {
    startedAt: state.startedAt,
    completedAt: state.completedAt ?? null,
    durationMs: state.completedAt === undefined
      ? null
      : Math.max(0, state.completedAt - state.startedAt),
    outcome: state.outcome ?? null,
  }
}

const trajectoryApprovalDefinition: ConversationNodeDefinition<ApprovalState> = {
  kind: 'trajectory-approval',
  target: 'trajectory',
  match: (event) => {
    if (event.type === 'approval/asked') {
      return event.data.callId === undefined
        ? null
        : { id: String(event.data.id), role: 'start' }
    }
    if (event.type === 'approval/decided') {
      return { id: String(event.data.id), role: 'update' }
    }
    return null
  },
  start: (_context, match) => startState(match),
  update: (context, match) => updateState(context.state, match),
  buildViewNode: (context) => {
    const state = context.state ?? fallbackState(context)
    if (state === undefined) return null
    const anchorSeq = context.start?.event.seq ?? context.matches[0]?.event.seq ?? 0
    return trajectoryNode(context, anchorSeq, {
      kind: 'approval',
      callId: state.callId,
      approval: project(state),
    })
  },
}

/** Register the Trajectory approval lifecycle projection. */
export function registerTrajectoryApprovalDefinition(ctx: Context): void {
  ctx.conversationEvents.register(trajectoryApprovalDefinition)
}
