import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import type {
  ConversationEventInput, ConversationNodeDefinition, ConversationViewDefinition,
} from '@deepseek-ai/dsh-client-runtime/client'
import { ConversationNodeAssembler } from '@deepseek-ai/dsh-client-runtime/client'
import { registerTrajectoryAssistantDefinition } from '../src/client/trajectory-assistant-definition.ts'
import { registerTrajectoryApprovalDefinition } from '../src/client/trajectory-approval-definition.ts'
import { registerTrajectoryCompactionDefinitions } from '../src/client/trajectory-compaction-definition.ts'
import type { TrajectorySnapshot } from '../src/client/trajectory-contract.ts'
import { registerTrajectoryMessageDefinitions } from '../src/client/trajectory-message-definitions.ts'
import { registerTrajectoryRequestHeaderDefinition } from '../src/client/trajectory-request-header-definition.ts'
import { trajectoryViewDefinition } from '../src/client/trajectory-snapshot-builder.ts'
import { registerTrajectoryToolDefinition } from '../src/client/trajectory-tool-definition.ts'

const DEFINITIONS: ConversationNodeDefinition[] = []
const registrationContext = {
  conversationEvents: {
    register: (definition: ConversationNodeDefinition) => {
      DEFINITIONS.push(definition)
      return () => {}
    },
  },
} as unknown as Context

registerTrajectoryMessageDefinitions(registrationContext)
registerTrajectoryRequestHeaderDefinition(registrationContext)
registerTrajectoryAssistantDefinition(registrationContext)
registerTrajectoryToolDefinition(registrationContext)
registerTrajectoryApprovalDefinition(registrationContext)
registerTrajectoryCompactionDefinitions(registrationContext)

class TestEventDefinitions {
  entries(): readonly ConversationNodeDefinition[] {
    return DEFINITIONS
  }

  fallbackEntry(): undefined {
    return undefined
  }
}

class TestViewDefinitions {
  entries(): readonly ConversationViewDefinition[] {
    return [trajectoryViewDefinition]
  }
}

function at(
  seq: number,
  type: string,
  data: unknown,
  extra: Record<string, unknown> = {},
): ConversationEventInput {
  return {
    event: {
      seq,
      time: 1_700_000_000_000 + seq,
      type,
      data,
      ...extra,
    } as unknown as ConversationEventInput['event'],
    view: undefined,
  }
}

function assembler(events: readonly ConversationEventInput[]): ConversationNodeAssembler {
  const value = new ConversationNodeAssembler(
    new TestEventDefinitions(),
    new TestViewDefinitions(),
  )
  value.replaceWindow(events, false)
  value.flush()
  return value
}

function snapshot(value: ConversationNodeAssembler): TrajectorySnapshot {
  const current = value.snapshot('trajectory') as TrajectorySnapshot | undefined
  if (current === undefined) throw new Error('trajectory view was not registered')
  return current
}

function assistantMessage(id: string, text: string) {
  return {
    id,
    role: 'assistant',
    content: [{ type: 'text', text }],
    source: { kind: 'model', provider: 'test', model: 'test' },
  }
}

describe('Trajectory conversation Definitions', () => {
  it('assembles streaming usage, preserves retry facts, and materializes interruption', () => {
    const value = assembler([
      at(1, 'turn/start', { turn: 1 }),
      at(2, 'step/start', { turn: 1, step: 1 }),
      at(3, 'assistant/chunk', {
        turn: 1,
        step: 1,
        chunk: { type: 'text-delta', index: 0, text: 'first attempt' },
      }),
      at(4, 'assistant/chunk', {
        turn: 1,
        step: 1,
        chunk: { type: 'usage', usage: { inputTokens: 10, outputTokens: 3 } },
      }),
    ])

    expect(snapshot(value).partial?.blocks).toEqual([{ kind: 'text', text: 'first attempt' }])
    expect(snapshot(value).requests).toMatchObject([{
      purpose: 'assistant',
      status: 'running',
      usage: { inputTokens: 10, outputTokens: 3 },
    }])

    value.append(at(5, 'llm/retry', {
      retryId: 'retry-1',
      turn: 1,
      step: 1,
      provider: 'test',
      mode: 'normal',
      policyKey: 'test-normal',
      retry: 1,
      maxRetries: 2,
      delayMs: 25,
      failure: { code: 'TRANSPORT', message: 'temporary failure' },
    }))
    value.append(at(6, 'assistant/chunk', {
      turn: 1,
      step: 1,
      chunk: { type: 'text-delta', index: 0, text: 'second attempt' },
    }))
    value.append(at(7, 'step/end', { turn: 1, step: 1 }))
    value.flush()

    const settled = snapshot(value)
    expect(settled.partial).toBeNull()
    expect(settled.eventNodes).toMatchObject([{
      kind: 'assistant',
      seq: 6.1,
      interrupted: true,
      blocks: [{ kind: 'text', text: 'second attempt' }],
    }])
    expect(settled.requests).toMatchObject([{
      purpose: 'assistant',
      status: 'error',
      retry: 1,
      maxRetries: 2,
      retryDelayMs: 25,
      usage: { inputTokens: 10, outputTokens: 3 },
    }])
  })

  it('keeps parallel interrupted roots and nests Code Dispatch results', () => {
    const current = snapshot(assembler([
      at(1, 'turn/start', { turn: 1 }),
      at(2, 'step/start', { turn: 1, step: 1 }),
      at(3, 'tool/call', {
        turn: 1, step: 1, callId: 'root-a', name: 'code', arguments: '{}',
      }),
      at(4, 'tool/call', {
        turn: 1, step: 1, callId: 'root-b', name: 'parallel', arguments: '{}',
      }),
      at(5, 'tool/code-dispatch-start', {
        rootCallId: 'root-a',
        parentCallId: 'root-a',
        subCallId: 'child',
        name: 'read',
        arguments: { path: 'README.md' },
      }),
      at(6, 'tool/code-dispatch', {
        rootCallId: 'root-a',
        parentCallId: 'root-a',
        subCallId: 'child',
        name: 'read',
        arguments: { path: 'README.md' },
        content: [{ type: 'text', text: 'contents' }],
      }),
      at(7, 'step/end', { turn: 1, step: 1 }),
    ]))

    const tools = current.eventNodes.filter(node => node.kind === 'tool-result')
    expect(tools.map(node => node.callId).sort()).toEqual(['root-a', 'root-b'])
    expect(tools.find(node => node.callId === 'root-a')?.subCalls).toMatchObject([{
      kind: 'tool-result',
      callId: 'child',
      call: { name: 'read' },
    }])
  })

  it('folds interleaved root and nested lifecycle timing from event envelopes', () => {
    const base = 1_700_000_000_000
    const current = snapshot(assembler([
      at(1, 'turn/start', { turn: 1 }),
      at(2, 'step/start', { turn: 1, step: 1 }),
      at(3, 'tool/call', {
        turn: 1, step: 1, callId: 'root-a', name: 'code', arguments: '{}',
      }),
      at(4, 'tool/call', {
        turn: 1, step: 1, callId: 'root-b', name: 'parallel', arguments: '{}',
      }),
      at(5, 'tool/policy-result', {
        callId: 'root-b', rootCallId: 'root-b', name: 'parallel', outcome: 'allowed', source: 'pre-execute',
      }),
      at(6, 'tool/policy-result', {
        callId: 'root-a', rootCallId: 'root-a', name: 'code', outcome: 'allowed', source: 'approval',
      }),
      at(7, 'tool/code-dispatch-start', {
        rootCallId: 'root-a', parentCallId: 'root-a', subCallId: 'child', name: 'read', arguments: {},
      }),
      at(8, 'tool/policy-result', {
        callId: 'child', rootCallId: 'root-a', name: 'read', outcome: 'allowed', source: 'pre-execute',
      }),
      at(9, 'tool/body-start', {
        callId: 'root-a', rootCallId: 'root-a', name: 'code',
      }),
      at(10, 'tool/body-start', {
        callId: 'child', rootCallId: 'root-a', name: 'read',
      }),
      at(11, 'tool/body-end', {
        callId: 'child', rootCallId: 'root-a', name: 'read', outcome: 'returned', aborted: false,
        durationMs: 999_999,
      }),
      at(12, 'tool/code-dispatch', {
        rootCallId: 'root-a', parentCallId: 'root-a', subCallId: 'child', name: 'read', arguments: {},
        content: [{ type: 'text', text: 'contents' }],
      }),
      at(13, 'tool/body-end', {
        callId: 'root-a', rootCallId: 'root-a', name: 'code', outcome: 'threw', aborted: true,
        durationMs: 999_999,
      }),
      at(14, 'tool/result', {
        turn: 1,
        step: 1,
        message: {
          id: 'result-a',
          role: 'tool',
          content: [{ type: 'tool-result', content: [{ type: 'text', text: 'failed' }], isError: true }],
          source: { kind: 'tool', callId: 'root-a' },
        },
      }),
      at(15, 'tool/body-start', {
        callId: 'root-b', rootCallId: 'root-b', name: 'parallel',
      }),
      at(16, 'tool/body-end', {
        callId: 'root-b', rootCallId: 'root-b', name: 'parallel', outcome: 'returned', aborted: false,
      }, { time: base + 15 }),
      at(17, 'step/end', { turn: 1, step: 1 }),
    ]))

    expect(current.toolTimings.get('root-a')).toMatchObject({
      total: { startedAt: base + 3, completedAt: base + 14, durationMs: 11 },
      policy: {
        startedAt: base + 3,
        completedAt: base + 6,
        durationMs: 3,
        outcome: 'allowed',
        source: 'approval',
      },
      body: {
        startedAt: base + 9,
        completedAt: base + 13,
        durationMs: 4,
        outcome: 'threw',
        aborted: true,
      },
    })
    expect(current.toolTimings.get('child')).toMatchObject({
      total: { startedAt: base + 7, completedAt: base + 12, durationMs: 5 },
      policy: { startedAt: base + 7, completedAt: base + 8, durationMs: 1 },
      body: { startedAt: base + 10, completedAt: base + 11, durationMs: 1 },
    })
    expect(current.toolTimings.get('root-b')).toMatchObject({
      total: { startedAt: base + 4, completedAt: null, durationMs: null },
      body: { startedAt: base + 15, completedAt: base + 15, durationMs: 0 },
    })
  })

  it('pairs interleaved approval decisions by approval id and then exact call id', () => {
    const base = 1_700_000_000_000
    const current = snapshot(assembler([
      at(1, 'turn/start', { turn: 1 }),
      at(2, 'step/start', { turn: 1, step: 1 }),
      at(3, 'tool/call', {
        turn: 1, step: 1, callId: 'root', name: 'code', arguments: '{}',
      }),
      at(4, 'approval/asked', {
        id: 'approval-root', toolName: 'code', callId: 'root',
      }),
      at(5, 'tool/code-dispatch-start', {
        rootCallId: 'root', parentCallId: 'root', subCallId: 'child', name: 'write', arguments: {},
      }),
      at(6, 'approval/asked', {
        id: 'approval-child', toolName: 'write', callId: 'child',
      }),
      at(7, 'approval/decided', {
        id: 'approval-child', outcome: 'rejected',
      }),
      at(8, 'approval/decided', {
        id: 'approval-root', outcome: 'allowed-once',
      }),
    ]))

    expect(current.toolTimings.get('root')?.approval).toEqual({
      startedAt: base + 4,
      completedAt: base + 8,
      durationMs: 4,
      outcome: 'allowed-once',
    })
    expect(current.toolTimings.get('child')?.approval).toEqual({
      startedAt: base + 6,
      completedAt: base + 7,
      durationMs: 1,
      outcome: 'rejected',
    })
  })

  it('keeps incomplete approvals unknown and ignores decided-only truncated records', () => {
    const pending = snapshot(assembler([
      at(1, 'turn/start', { turn: 1 }),
      at(2, 'step/start', { turn: 1, step: 1 }),
      at(3, 'tool/call', {
        turn: 1, step: 1, callId: 'root', name: 'write', arguments: '{}',
      }),
      at(4, 'approval/asked', {
        id: 'approval-pending', toolName: 'write', callId: 'root',
      }),
    ]))
    expect(pending.toolTimings.get('root')?.approval).toEqual({
      startedAt: 1_700_000_000_004,
      completedAt: null,
      durationMs: null,
      outcome: null,
    })

    expect(() => assembler([
      at(1, 'approval/decided', { id: 'approval-truncated', outcome: 'cancelled' }),
    ])).not.toThrow()
    expect(snapshot(assembler([
      at(1, 'approval/decided', { id: 'approval-truncated', outcome: 'cancelled' }),
    ])).toolTimings.size).toBe(0)
  })

  it('assembles compaction lifecycle, checkpoint replacement, and orphan interruption', () => {
    const current = snapshot(assembler([
      at(1, 'compaction/start', { compactionId: 'complete', turn: null }),
      at(2, 'compaction/summary', {
        compactionId: 'complete',
        turn: null,
        summary: 'summary',
        provider: 'test',
        model: 'test',
        maxTokens: 100,
        usage: { inputTokens: 20, outputTokens: 5 },
      }),
      at(3, 'user/message', {
        id: 'checkpoint',
        role: 'user',
        content: [{ type: 'text', text: 'summary checkpoint' }],
        source: { kind: 'plugin', plugin: 'compact', compactionId: 'complete' },
      }),
      at(4, 'compaction/end', { compactionId: 'complete', turn: null }),
      at(5, 'compaction/start', { compactionId: 'orphan', turn: null }),
      at(6, 'session/end-seed', {}),
    ]))

    expect(current.requests).toMatchObject([
      {
        purpose: 'compaction',
        startSeq: 1,
        status: 'complete',
        resultSeq: 2,
        replacementSeq: 3,
        summary: 'summary',
      },
      {
        purpose: 'compaction',
        startSeq: 5,
        status: 'error',
        completedAt: 1_700_000_000_006,
      },
    ])
  })

  it('classifies claimed inbox input as steering and consumes one inherited prompt change', () => {
    const value = assembler([
      at(1, 'turn/start', { turn: 1 }),
      at(2, 'request/header', {
        reason: 'initial',
        header: {
          config: { provider: 'test', model: 'test' },
          system: 'system prompt',
          tools: [],
        },
      }),
      at(3, 'step/start', { turn: 1, step: 1 }),
      at(4, 'assistant/message', {
        turn: 1,
        step: 1,
        message: assistantMessage('assistant-1', 'first'),
      }),
      at(5, 'step/end', { turn: 1, step: 1 }),
      at(6, 'agent/inbox/spliced', {
        target: 'next-step', start: 0, removedCount: 0, inserted: [{ id: 'm1' }],
      }),
      at(7, 'agent/inbox/spliced', {
        target: 'next-step', start: 0, removedCount: 1, inserted: [],
      }),
      at(8, 'step/start', { turn: 1, step: 2 }),
    ])
    value.append(at(9, 'user/message', {
      id: 'm1',
      role: 'user',
      content: [{ type: 'text', text: 'steer here' }],
      source: { kind: 'user' },
    }))
    value.flush()

    const steering = snapshot(value)
    expect(steering.eventNodes.find(node => node.seq === 9)?.kind).toBe('steering')
    expect(steering.eventLocations.get(9)).toMatchObject({
      kind: 'step',
      turn: { turn: 1 },
      step: { step: 2 },
    })

    value.append(at(10, 'assistant/message', {
      turn: 1,
      step: 2,
      message: assistantMessage('assistant-2', 'second'),
    }))
    value.flush()
    const current = snapshot(value)

    expect(current.requests.map(request => request.purpose === 'assistant'
      ? request.prompt?.system
      : undefined)).toEqual(['system prompt', 'system prompt'])
    expect(current.requests.map(request => request.purpose === 'assistant'
      ? request.promptChange?.kind
      : undefined)).toEqual(['initial', undefined])
  })
})
