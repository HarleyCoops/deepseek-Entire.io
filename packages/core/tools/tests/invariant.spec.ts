import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { scopeTarget } from '@deepseek-ai/dsh-scope'
import { CallId, createToolResultMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { ToolExecution, ToolExecutionResult, ToolExecutionToken } from '@deepseek-ai/dsh-tools'
import * as ToolsInvariant from '@deepseek-ai/dsh-tools/invariant'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'

const testToolSignal = new AbortController().signal

async function setup(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(InvariantRegistry)
  await ctx.plugin(ToolsInvariant)
  return ctx
}

const execution = (overrides: Partial<ToolExecution> = {}): ToolExecution => ({
  token: Symbol('tool') as ToolExecutionToken,
  callId: CallId('call-1'),
  name: 'echo',
  arguments: Object.freeze({ text: 'hi' }),
  ...overrides,
  signal: overrides.signal ?? testToolSignal,
  rootCallId: overrides.rootCallId ?? overrides.callId ?? CallId('call-1'),
})

const outcome = (): ToolExecutionResult => Object.freeze({
  content: Object.freeze([{ type: 'text' as const, text: 'ok' }]) as never,
  isError: false,
  value: null,
})

function emitResult(ctx: Context, exec: ToolExecution, result: ToolExecutionResult): void {
  ctx.emit(scopeTarget(ctx as never, undefined), 'tools/result', exec, result)
}

async function stage(ctx: Context, name: 'tools/pre-execute' | 'tools/execute', exec: ToolExecution): Promise<void> {
  if (name === 'tools/pre-execute') {
    await ctx.waterfall(ctx as never, name, exec, () => Promise.resolve({ kind: 'allow' as const }))
  } else {
    await ctx.waterfall(ctx as never, name, exec, () => Promise.resolve(outcome()))
  }
}

describe('tool-pipeline invariants', () => {
  it('accepts dispatch and denial stage orders with frozen results', async () => {
    const ctx = await setup()
    const dispatched = execution()
    await stage(ctx, 'tools/pre-execute', dispatched)
    await stage(ctx, 'tools/execute', dispatched)
    await ctx.waterfall(ctx as never, 'tools/post-execute', dispatched, outcome(), () => Promise.resolve({ kind: 'accept' as const }))
    Object.freeze(dispatched)
    emitResult(ctx, dispatched, outcome())

    const denied = execution({ callId: CallId('call-2') })
    await stage(ctx, 'tools/pre-execute', denied)
    await ctx.waterfall(ctx as never, 'tools/post-execute', denied, outcome(), () => Promise.resolve({ kind: 'accept' as const }))
    Object.freeze(denied)
    emitResult(ctx, denied, outcome())
    ctx.emit('tools/change')
  })

  it('rejects repeated and out-of-order pipeline stages', async () => {
    const ctx = await setup()
    const exec = execution()
    await stage(ctx, 'tools/pre-execute', exec)
    await expect(stage(ctx, 'tools/pre-execute', exec)).rejects.toThrow(/repeated/)

    const noPre = execution({ callId: CallId('call-2') })
    await expect(stage(ctx, 'tools/execute', noPre)).rejects.toThrow(/must follow tools\/pre-execute/)
    expect(() => ctx.waterfall(
      ctx as never, 'tools/post-execute', noPre, outcome(),
      () => Promise.resolve({ kind: 'accept' as const }),
    )).toThrow(/must follow tools\/pre-execute or tools\/execute/)
  })

  it('rejects mutable or anonymous final snapshots', async () => {
    const ctx = await setup()
    expect(() => { emitResult(ctx, execution(), outcome()) }).toThrow(/execution must be frozen/)

    const exec = Object.freeze(execution())
    expect(() => { emitResult(ctx, exec, { content: [], isError: false, value: null }) })
      .toThrow(/outcome and content must be frozen/)

    const anonymous = Object.freeze(execution({ name: '' }))
    expect(() => { emitResult(ctx, anonymous, outcome()) }).toThrow(/non-empty name and callId/)
  })

  it('rejects duplicate policy results and a body start without an allowed policy', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create()
    session.append('turn/start', { turn: 1 })
    session.append('tool/call', {
      turn: 1, step: 1, callId: CallId('call-1'), name: 'echo', arguments: '{}',
    })
    session.append('tool/call', {
      turn: 1, step: 1, callId: CallId('call-2'), name: 'echo', arguments: '{}',
    })
    const allowed = {
      callId: CallId('call-1'), rootCallId: CallId('call-1'), name: 'echo',
      outcome: 'allowed' as const, source: 'pre-execute' as const,
    }
    session.append('tool/policy-result', allowed, { ignorable: true })

    expect(() => session.append('tool/policy-result', allowed, { ignorable: true }))
      .toThrow(/tool\/policy-result repeated for callId call-1/)
    expect(() => session.append('tool/body-start', {
      callId: CallId('call-2'), rootCallId: CallId('call-2'), name: 'echo',
    }, { ignorable: true })).toThrow(/requires an allowed tool\/policy-result/)
  })

  it('rejects lifecycle identity drift and a body end without a start', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create()
    session.append('turn/start', { turn: 1 })
    session.append('tool/call', {
      turn: 1, step: 1, callId: CallId('call-1'), name: 'echo', arguments: '{}',
    })
    session.append('tool/policy-result', {
      callId: CallId('call-1'), rootCallId: CallId('call-1'), name: 'echo',
      outcome: 'allowed', source: 'pre-execute',
    }, { ignorable: true })

    expect(() => session.append('tool/body-start', {
      callId: CallId('call-1'), rootCallId: CallId('call-1'), name: 'changed',
    }, { ignorable: true })).toThrow(/changed lifecycle identity for callId call-1/)
    expect(() => session.append('tool/body-end', {
      callId: CallId('call-1'), rootCallId: CallId('call-1'), name: 'echo',
      outcome: 'returned', aborted: false,
    }, { ignorable: true })).toThrow(/requires tool\/body-start/)
  })

  it('requires lifecycle records to be turn-enclosed', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create()

    expect(() => session.append('tool/policy-result', {
      callId: CallId('call-1'), rootCallId: CallId('call-1'), name: 'echo',
      outcome: 'allowed', source: 'pre-execute',
    }, { ignorable: true })).toThrow(/tool\/policy-result appended outside any open turn/)

    session.append('turn/start', { turn: 1 })
    session.append('tool/call', {
      turn: 1, step: 1, callId: CallId('call-2'), name: 'echo', arguments: '{}',
    })
    expect(() => session.append('tool/policy-result', {
      callId: CallId('call-2'), rootCallId: CallId('call-2'), name: 'echo',
      outcome: 'allowed', source: 'pre-execute',
    })).toThrow(/tool\/policy-result must be marked ignorable/)
  })

  it('rejects a completed tool result while its body remains open', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create()
    session.append('turn/start', { turn: 1 })
    const call = session.append('tool/call', {
      turn: 1, step: 1, callId: CallId('call-1'), name: 'echo', arguments: '{}',
    })
    session.append('tool/policy-result', {
      callId: CallId('call-1'), rootCallId: CallId('call-1'), name: 'echo',
      outcome: 'allowed', source: 'pre-execute',
    }, { ignorable: true })
    session.append('tool/body-start', {
      callId: CallId('call-1'), rootCallId: CallId('call-1'), name: 'echo',
    }, { ignorable: true })

    expect(() => session.append('tool/result', {
      turn: 1,
      step: 1,
      message: createToolResultMessage({
        callId: CallId('call-1'), content: [{ type: 'text', text: 'ok' }], isError: false,
      }),
    }, { surfaceOp: 'append', sourceEventSeqs: [call.seq] })).toThrow(/completed with an open tool body/)
  })

  it('rejects turn completion while a tool body remains open', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create()
    session.append('turn/start', { turn: 1 })
    session.append('tool/call', {
      turn: 1, step: 1, callId: CallId('call-1'), name: 'echo', arguments: '{}',
    })
    session.append('tool/policy-result', {
      callId: CallId('call-1'), rootCallId: CallId('call-1'), name: 'echo',
      outcome: 'allowed', source: 'pre-execute',
    }, { ignorable: true })
    session.append('tool/body-start', {
      callId: CallId('call-1'), rootCallId: CallId('call-1'), name: 'echo',
    }, { ignorable: true })

    expect(() => session.append('turn/end', { turn: 1, reason: { kind: 'completed' } }))
      .toThrow(/turn\/end.*open tool body.*call-1/)
  })

  it('requires root lifecycle identity to match its tool-call anchor', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create()
    session.append('turn/start', { turn: 1 })
    session.append('tool/call', {
      turn: 1, step: 1, callId: CallId('call-1'), name: 'echo', arguments: '{}',
    })

    expect(() => session.append('tool/policy-result', {
      callId: CallId('orphan'), rootCallId: CallId('orphan'), name: 'echo',
      outcome: 'allowed', source: 'pre-execute',
    }, { ignorable: true })).toThrow(/no tool admission anchor for callId orphan/)
    expect(() => session.append('tool/policy-result', {
      callId: CallId('call-1'), rootCallId: CallId('other-root'), name: 'echo',
      outcome: 'allowed', source: 'pre-execute',
    }, { ignorable: true })).toThrow(/changed lifecycle identity for callId call-1/)
    expect(() => session.append('tool/policy-result', {
      callId: CallId('call-1'), rootCallId: CallId('call-1'), name: 'changed',
      outcome: 'allowed', source: 'pre-execute',
    }, { ignorable: true })).toThrow(/changed lifecycle identity for callId call-1/)
  })

  it('requires nested lifecycle identity to match its code-dispatch-start anchor', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create()
    session.append('turn/start', { turn: 1 })
    session.append('tool/code-dispatch-start', {
      rootCallId: CallId('root'), parentCallId: CallId('root'),
      subCallId: CallId('child'), name: 'echo', arguments: {},
    })

    expect(() => session.append('tool/policy-result', {
      callId: CallId('child'), rootCallId: CallId('other-root'), name: 'echo',
      outcome: 'allowed', source: 'pre-execute',
    }, { ignorable: true })).toThrow(/changed lifecycle identity for callId child/)
    expect(() => session.append('tool/policy-result', {
      callId: CallId('child'), rootCallId: CallId('root'), name: 'changed',
      outcome: 'allowed', source: 'pre-execute',
    }, { ignorable: true })).toThrow(/changed lifecycle identity for callId child/)
  })

  it('accepts legacy completed calls and a crash tail with an unmatched body start', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const session = ctx.sessions.create()
    session.append('turn/start', { turn: 1 })
    const legacyCall = session.append('tool/call', {
      turn: 1, step: 1, callId: CallId('legacy'), name: 'echo', arguments: '{}',
    })
    session.append('tool/result', {
      turn: 1,
      step: 1,
      message: createToolResultMessage({
        callId: CallId('legacy'), content: [{ type: 'text', text: 'ok' }], isError: false,
      }),
    }, { surfaceOp: 'append', sourceEventSeqs: [legacyCall.seq] })
    session.append('tool/call', {
      turn: 1, step: 1, callId: CallId('crash-tail'), name: 'echo', arguments: '{}',
    })
    session.append('tool/policy-result', {
      callId: CallId('crash-tail'), rootCallId: CallId('crash-tail'), name: 'echo',
      outcome: 'allowed', source: 'pre-execute',
    }, { ignorable: true })
    session.append('tool/body-start', {
      callId: CallId('crash-tail'), rootCallId: CallId('crash-tail'), name: 'echo',
    }, { ignorable: true })

    await ctx.plugin(InvariantRegistry)
    await expect(ctx.plugin(ToolsInvariant).then(() => undefined)).resolves.toBeUndefined()
  })

  it('requires code-dispatch records to be turn-enclosed', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create()
    const data = {
      rootCallId: CallId('parent'),
      parentCallId: CallId('parent'),
      subCallId: CallId('child'),
      name: 'echo',
      arguments: {},
    }
    expect(() => session.append('tool/code-dispatch-start', data)).toThrow(/outside any open turn/)
    session.append('turn/start', { turn: 1 })
    expect(() => session.append('tool/code-dispatch-start', data)).not.toThrow()
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  })

  it('does not commit a rejected dispatch edge into the root index', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create()
    expect(() => session.append('tool/code-dispatch-start', {
      rootCallId: CallId('rejected-root'),
      parentCallId: CallId('rejected-root'),
      subCallId: CallId('reused-child'),
      name: 'echo',
      arguments: {},
    })).toThrow(/outside any open turn/)

    session.append('turn/start', { turn: 1 })
    expect(() => session.append('tool/code-dispatch-start', {
      rootCallId: CallId('accepted-root'),
      parentCallId: CallId('accepted-root'),
      subCallId: CallId('reused-child'),
      name: 'echo',
      arguments: {},
    })).not.toThrow()
  })

  it('rejects a nested code dispatch that changes its parent chain root before append', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create()
    session.append('turn/start', { turn: 1 })
    session.append('tool/code-dispatch-start', {
      rootCallId: CallId('root'),
      parentCallId: CallId('root'),
      subCallId: CallId('child'),
      name: 'run_code',
      arguments: {},
    })
    session.append('tool/code-dispatch-start', {
      rootCallId: CallId('root'),
      parentCallId: CallId('child'),
      subCallId: CallId('grandchild'),
      name: 'echo',
      arguments: {},
    })

    expect(() => session.append('tool/code-dispatch-start', {
      rootCallId: CallId('another-root'),
      parentCallId: CallId('child'),
      subCallId: CallId('invalid-grandchild'),
      name: 'echo',
      arguments: {},
    })).toThrow(/parentCallId child does not belong to rootCallId another-root/)
    expect(session.events.some(event => event.type === 'tool/code-dispatch-start'
      && String(event.data.subCallId) === 'invalid-grandchild')).toBe(false)
  })

  it('requires non-empty dispatch identities and keeps one subcall on one root', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create()
    session.append('turn/start', { turn: 1 })
    expect(() => session.append('tool/code-dispatch-start', {
      rootCallId: CallId(''),
      parentCallId: CallId('root'),
      subCallId: CallId('child'),
      name: 'echo',
      arguments: {},
    })).toThrow(/must carry non-empty rootCallId/)

    session.append('tool/code-dispatch-start', {
      rootCallId: CallId('root'),
      parentCallId: CallId('root'),
      subCallId: CallId('child'),
      name: 'echo',
      arguments: {},
    })
    expect(() => session.append('tool/code-dispatch-start', {
      rootCallId: CallId('other-root'),
      parentCallId: CallId('other-root'),
      subCallId: CallId('child'),
      name: 'echo',
      arguments: {},
    })).toThrow(/changed rootCallId for subCallId child/)
  })

  it('indexes dispatch records emitted for a bare session', async () => {
    const ctx = await setup()
    const session = Session.create(SessionId('bare-dispatch-session'))
    session.append('turn/start', { turn: 1 })
    expect(() => {
      ctx.emit('session/event', session as never, {
        type: 'tool/code-dispatch-start',
        seq: 1,
        time: 1,
        data: {
          rootCallId: CallId('root'),
          parentCallId: CallId('root'),
          subCallId: CallId('child'),
          name: 'echo',
          arguments: {},
        },
      } as never)
    }).not.toThrow()
  })

  it('replays enclosed code-dispatch records on late registration', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const session = ctx.sessions.create()
    session.append('turn/start', { turn: 1 })
    session.append('tool/code-dispatch', {
      rootCallId: CallId('parent'),
      parentCallId: CallId('parent'),
      subCallId: CallId('child'),
      name: 'echo',
      arguments: {},
      isError: false,
      content: [{ type: 'text', text: 'ok' }],
    })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    await ctx.plugin(InvariantRegistry)
    await expect(ctx.plugin(ToolsInvariant).then(() => undefined)).resolves.toBeUndefined()
  })

  it('rejects an unenclosed code-dispatch record on late registration', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    ctx.sessions.create().append('tool/code-dispatch-start', {
      rootCallId: CallId('parent'),
      parentCallId: CallId('parent'),
      subCallId: CallId('child'),
      name: 'echo',
      arguments: {},
    })
    await ctx.plugin(InvariantRegistry)
    await expect(ctx.plugin(ToolsInvariant).then(() => undefined)).rejects.toThrow(/outside any open turn/)
  })
})
