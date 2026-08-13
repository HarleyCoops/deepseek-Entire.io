import type {
  AssistantMessageNode, ConversationLocation, ConversationNode,
  ConversationPromptSnapshot, ConversationViewNode, PartialAssistant,
  RequestPromptChange, RequestView, RunningToolCall, ToolCallBlock,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { ToolPolicyResult } from '@deepseek-ai/dsh-tools/types'

/** One timestamp-delimited portion of a tool call. Missing endpoints stay unknown. */
export interface TrajectoryTimingSpan {
  readonly startedAt: number | null
  readonly completedAt: number | null
  readonly durationMs: number | null
}

/** Policy settlement for one exact root or nested Tool call. */
export interface TrajectoryPolicyTiming extends TrajectoryTimingSpan {
  readonly outcome: ToolPolicyResult['outcome'] | null
  readonly source: ToolPolicyResult['source'] | null
}

/** Approval wait joined to one exact Tool call through its approval id. */
export interface TrajectoryApprovalTiming extends TrajectoryTimingSpan {
  readonly outcome: 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable' | null
}

/** Awaited Tool body settlement, excluding policy and result finalization. */
export interface TrajectoryBodyTiming extends TrajectoryTimingSpan {
  readonly outcome: 'returned' | 'threw' | null
  readonly aborted: boolean | null
}

/** Complete timing chain for one exact root or nested Tool call. */
export interface TrajectoryToolTiming {
  readonly total: TrajectoryTimingSpan
  readonly policy: TrajectoryPolicyTiming
  readonly approval?: TrajectoryApprovalTiming
  readonly body?: TrajectoryBodyTiming
}

/** Request-header facts retained by the Trajectory target. */
export interface TrajectoryRequestHeaderState {
  readonly seq: number
  readonly time: number
  readonly prompt: ConversationPromptSnapshot
  readonly change?: RequestPromptChange
  readonly location: ConversationLocation
}

/** One independently assembled contribution to the legacy Trajectory ledger. */
export type TrajectoryContribution =
  | {
    readonly kind: 'node'
    readonly node: ConversationNode
  }
  | {
    readonly kind: 'assistant'
    readonly node?: AssistantMessageNode
    readonly partial: PartialAssistant | null
    readonly request?: Extract<RequestView, { purpose: 'assistant' }>
  }
  | {
    readonly kind: 'tool'
    readonly root: ToolCallBlock
    readonly timings?: ReadonlyMap<string, TrajectoryToolTiming>
  }
  | {
    readonly kind: 'approval'
    readonly callId: string
    readonly approval: TrajectoryApprovalTiming
  }
  | {
    readonly kind: 'request-header'
    readonly header: TrajectoryRequestHeaderState
  }
  | {
    readonly kind: 'compaction'
    readonly request: Extract<RequestView, { purpose: 'compaction' }>
  }
  | {
    readonly kind: 'session-end'
    readonly seq: number
    readonly time: number
  }
  | {
    readonly kind: 'turn-end'
    readonly turn: number
    readonly time: number
    readonly error?: string
  }

/** Target envelope consumed by the Trajectory snapshot builder. */
export interface TrajectoryConversationViewNode extends ConversationViewNode {
  readonly target: 'trajectory'
  readonly anchorSeq: number
  readonly location: ConversationLocation
  readonly data: TrajectoryContribution
}

/** Stage-oriented Trajectory data assembled from registered business Contexts. */
export interface TrajectorySnapshot {
  readonly eventNodes: readonly ConversationNode[]
  readonly eventLocations: ReadonlyMap<number, ConversationLocation>
  readonly requests: readonly RequestView[]
  readonly callSchemas: ReadonlyMap<string, ConversationPromptSnapshot['tools'][number]>
  readonly toolTimings: ReadonlyMap<string, TrajectoryToolTiming>
  readonly partial: PartialAssistant | null
  readonly runningCalls: readonly RunningToolCall[]
}

declare module '@deepseek-ai/dsh-client-runtime/client' {
  interface ConversationViewSnapshotMap {
    /** Independently assembled data consumed by the Trajectory view. */
    trajectory: TrajectorySnapshot
  }
}
