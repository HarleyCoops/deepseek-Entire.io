import { Buffer } from 'node:buffer'
import { describe, expect, it } from 'vitest'
import { redactCredentialValues } from '../src/redaction.ts'
import { EntireTranscriptProjector, normalizeSessionEvent } from '../src/transcript.ts'

const session = { id: 'session-1', parentSessionId: 'parent-1' }
const event = (type: string, seq: number, data: unknown) => ({ type, seq, time: 1000 + seq, data }) as never

describe('transcript normalization', () => {
  it('retains selected committed facts and omits raw or private request facts', () => {
    const records = [
      event('turn/start', 0, { turn: 1 }),
      event('user/message', 1, { id: 'u1', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'fix it' }] }),
      event('user/message', 2, { id: 'i1', role: 'user', source: { kind: 'plugin', plugin: 'secret-injector' }, content: [{ type: 'text', text: 'internal' }] }),
      event('assistant/chunk', 3, { turn: 1, step: 0, chunk: { type: 'text-delta', text: 'raw' } }),
      event('request/header', 4, { header: { system: 'secret system', tools: [{ name: 'read' }], config: { apiKey: 'secret' } }, reason: 'initial' }),
      event('assistant/message', 5, { turn: 1, step: 0, message: { id: 'a1', role: 'assistant', source: { kind: 'model', provider: 'deepseek', model: 'v4' }, content: [{ type: 'reasoning', text: 'think' }, { type: 'text', text: 'done' }] }, usage: { inputTokens: 11, cacheWriteTokens: 4, cacheReadTokens: 2, outputTokens: 3 } }),
      event('tool/call', 6, { turn: 1, step: 0, callId: 'call-1', name: 'fetch', arguments: '{"url":"x","apiKey":"abc"}' }),
      event('tool/policy-result', 7, { callId: 'call-1', rootCallId: 'call-1', name: 'fetch', outcome: 'allowed', source: 'approval' }),
      event('approval/asked', 8, { id: 'approve-1', toolName: 'fetch', callId: 'call-1', reason: 'contains private explanation' }),
      event('approval/decided', 9, { id: 'approve-1', outcome: 'allowed-once' }),
      event('tool/body-start', 10, { callId: 'call-1', rootCallId: 'call-1', name: 'fetch' }),
      event('tool/body-end', 11, { callId: 'call-1', rootCallId: 'call-1', name: 'fetch', outcome: 'returned', aborted: false }),
      event('tool/result', 12, { turn: 1, step: 0, message: { source: { kind: 'tool', callId: 'call-1' }, content: [{ type: 'tool-result', callId: 'call-1', toolName: 'fetch', isError: false, content: [{ type: 'text', text: 'ok' }] }] } }),
      event('tool/code-dispatch-start', 13, { rootCallId: 'call-1', parentCallId: 'call-1', subCallId: 'sub-1', name: 'stat', arguments: { path: 'a' } }),
      event('tool/code-dispatch', 14, { rootCallId: 'call-1', parentCallId: 'call-1', subCallId: 'sub-1', name: 'stat', arguments: { path: 'a' }, isError: false, content: [{ type: 'text', text: 'nested' }] }),
      event('compaction/summary', 15, { compactionId: 'compact-1', turn: 1, summary: [{ type: 'text', text: 'summary body' }], rawOutput: [{ type: 'reasoning', text: 'raw thought' }], shadowedRange: { start: 1, end: 4 }, shadowedSeqs: [1, 2, 3, 4], shadowedTokenCount: 100, provider: 'deepseek', model: 'v4', usage: { inputTokens: 20, outputTokens: 5 } }),
      event('turn/end', 16, { turn: 1, reason: { kind: 'completed' } }),
    ].map(item => normalizeSessionEvent(session, item, { strict: false, toolResultMaxBytes: 4096 })).filter(Boolean)

    expect(records.map(record => record!.kind)).toEqual([
      'turn-start', 'prompt', 'assistant', 'tool-call', 'tool-policy-result',
      'approval-asked', 'approval-decided', 'tool-body-start', 'tool-body-end', 'tool-result',
      'tool-code-dispatch-start', 'tool-code-dispatch', 'compaction', 'turn-end',
    ])
    expect(records[1]).toMatchObject({
      schema_version: 1,
      kind: 'prompt',
      session_id: 'session-1',
      parent_session_id: 'parent-1',
      timestamp: '1970-01-01T00:00:01.001Z',
      prompt: 'fix it',
    })
    expect(records[2]).toMatchObject({
      kind: 'assistant',
      text: 'think\ndone',
      usage: { input_tokens: 11, cache_creation_tokens: 4, cache_read_tokens: 2, output_tokens: 3, api_call_count: 1 },
    })
    expect(JSON.stringify(records)).not.toContain('secret system')
    expect(JSON.stringify(records)).not.toContain('secret-injector')
    expect(JSON.stringify(records)).not.toContain('contains private explanation')
    expect(records[12]).toMatchObject({ kind: 'compaction', summary: 'summary body' })
    expect(JSON.stringify(records)).not.toContain('raw thought')
    expect(JSON.stringify(records)).toContain('[REDACTED]')
  })

  it('strict mode omits tool inputs, tool results, and reasoning-like assistant content', () => {
    const assistant = normalizeSessionEvent(session, event('assistant/message', 1, {
      turn: 1,
      step: 0,
      message: { source: { kind: 'model', provider: 'p', model: 'm' }, content: [{ type: 'reasoning', text: 'private thought' }, { type: 'text', text: 'answer' }] },
    }), { strict: true, toolResultMaxBytes: 512 })
    const call = normalizeSessionEvent(session, event('tool/call', 2, { turn: 1, step: 0, callId: 'c', name: 'read', arguments: '{"path":"secret"}' }), { strict: true, toolResultMaxBytes: 512 })
    const result = normalizeSessionEvent(session, event('tool/result', 3, { turn: 1, step: 0, message: { source: { callId: 'c' }, content: [{ type: 'tool-result', callId: 'c', toolName: 'read', isError: false, content: [{ type: 'text', text: 'result secret' }] }] } }), { strict: true, toolResultMaxBytes: 512 })

    expect(assistant).toMatchObject({ kind: 'assistant', text: 'answer' })
    expect(call!.data).not.toHaveProperty('arguments')
    expect(result!.data).not.toHaveProperty('content')
    expect(JSON.stringify([assistant, call, result])).not.toContain('private thought')
    expect(JSON.stringify([assistant, call, result])).not.toContain('secret')
  })

  it('caps the complete serialized tool-result record by UTF-8 bytes', () => {
    const record = normalizeSessionEvent(session, event('tool/result', 1, {
      turn: 1,
      step: 0,
      message: { source: { callId: 'c' }, content: [{ type: 'tool-result', callId: 'c', toolName: 'read', isError: false, content: [{ type: 'text', text: '密'.repeat(500) }] }] },
    }), { strict: false, toolResultMaxBytes: 320 })

    expect(Buffer.byteLength(JSON.stringify(record), 'utf8')).toBeLessThanOrEqual(320)
    expect(record!.data).toMatchObject({ contentOmitted: true })
  })

  it('emits conservative filename hints only after known mutation calls succeed', () => {
    const projector = new EntireTranscriptProjector(session, { strict: true, toolResultMaxBytes: 512, repositoryRoot: 'C:\\Repo' })
    projector.project(event('tool/call', 1, { turn: 1, step: 0, callId: 'ok', name: 'write', arguments: '{"file_path":"src/app.ts","content":"secret"}' }))
    const success = projector.project(event('tool/result', 2, { turn: 1, step: 0, message: { source: { callId: 'ok' }, content: [{ type: 'tool-result', toolCallId: 'ok', isError: false, content: [] }] } }))
    projector.project(event('tool/call', 3, { turn: 1, step: 1, callId: 'bad', name: 'edit', arguments: '{"file_path":"src/nope.ts"}' }))
    const failure = projector.project(event('tool/result', 4, { turn: 1, step: 1, message: { source: { callId: 'bad' }, content: [{ type: 'tool-result', toolCallId: 'bad', isError: true, content: [] }] } }))

    expect(success).toMatchObject({ modified_files: ['src/app.ts'] })
    expect(failure).not.toHaveProperty('modified_files')
    expect(JSON.stringify(success)).not.toContain('secret')

    const nested = projector.project(event('tool/code-dispatch', 5, {
      rootCallId: 'root', parentCallId: 'root', subCallId: 'nested', name: 'str_replace_editor',
      arguments: { command: 'insert', path: 'C:\\Repo\\src\\nested.ts', new_str: 'private body' }, isError: false, content: [],
    }))
    expect(nested).toMatchObject({ modified_files: ['src/nested.ts'] })
    expect(JSON.stringify(nested)).not.toContain('private body')

    const escaped = projector.project(event('tool/code-dispatch', 6, {
      rootCallId: 'root', parentCallId: 'root', subCallId: 'escape', name: 'str_replace_editor',
      arguments: { command: 'create', path: 'C:\\outside.ts', file_text: 'private body' }, isError: false, content: [],
    }))
    expect(escaped).not.toHaveProperty('modified_files')
  })

})

describe('credential redaction', () => {
  it('masks credential-key values recursively without masking usage counts', () => {
    expect(redactCredentialValues({
      apiKey: 'one',
      nested: { Authorization: 'Bearer two', inputTokens: 12 },
      list: [{ client_secret: 'three' }],
    })).toEqual({
      apiKey: '[REDACTED]',
      nested: { Authorization: '[REDACTED]', inputTokens: 12 },
      list: [{ client_secret: '[REDACTED]' }],
    })
  })
})
