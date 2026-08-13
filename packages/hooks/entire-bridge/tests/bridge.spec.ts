import { existsSync, readFileSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { createAssistantMessage, createToolResultMessage, createUserMessage, CallId } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SubprocessRuntime from '@deepseek-ai/dsh-subprocess'
import type { SubprocessHandle, SubprocessSpawnSpec, SubprocessTerminalHandle, SubprocessTerminalSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { afterEach, describe, expect, it } from 'vitest'
import * as EntireBridge from '../src/index.ts'

const roots: string[] = []

class CaptureSubprocess extends SubprocessRuntime {
  readonly calls: Array<{ spec: SubprocessSpawnSpec; transcript: string }> = []

  resolveExecutable(): Promise<string> {
    return Promise.resolve('entire')
  }

  spawn(spec: SubprocessSpawnSpec): SubprocessHandle {
    const payload = JSON.parse((spec.stdio.stdin as { data: string }).data) as { session_ref: string }
    this.calls.push({
      spec,
      transcript: readFileSync(payload.session_ref, 'utf8'),
    })
    return {
      pid: 1,
      stdin: undefined,
      stdout: undefined,
      stderr: undefined,
      collected: {},
      done: Promise.resolve({ exitCode: 0, signal: null }),
      terminate: () => undefined,
      waitForExit: async () => true,
    }
  }

  spawnTerminal(_spec: SubprocessTerminalSpawnSpec): Promise<SubprocessTerminalHandle> {
    return Promise.reject(new Error('not used'))
  }
}

async function fixture(marker: boolean): Promise<{ ctx: Context; bridge: Awaited<ReturnType<Context['plugin']>>; subprocess: CaptureSubprocess; repositoryRoot: string; tempRoot: string }> {
  const repositoryRoot = await mkdtemp(join(tmpdir(), 'dsh-entire-bridge-repo-'))
  const tempRoot = await mkdtemp(join(tmpdir(), 'dsh-entire-bridge-temp-'))
  roots.push(repositoryRoot, tempRoot)
  await mkdir(join(repositoryRoot, '.entire'), { recursive: true })
  if (marker) await writeFile(join(repositoryRoot, '.entire', 'dsh-hooks.json'), '{"schemaVersion":1,"agent":"dsh"}')
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  const subprocess = new CaptureSubprocess(ctx)
  const bridge = await ctx.plugin(EntireBridge, {
    strict: false,
    tempRoot,
    toolResultMaxBytes: 4096,
    hookGraceMs: 1000,
    hookOutputMaxBytes: 4096,
  })
  return { ctx, bridge, subprocess, repositoryRoot, tempRoot }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('Entire bridge lifecycle', () => {
  it('does no I/O or process work without the clone-local marker', async () => {
    const { ctx, bridge, subprocess, repositoryRoot, tempRoot } = await fixture(false)
    const session = ctx.sessions.create(SessionId('inactive'), { meta: { cwd: repositoryRoot } })
    session.append('turn/start', { turn: 1 })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })

    await bridge.dispose()

    expect(subprocess.calls).toEqual([])
    expect(existsSync(join(repositoryRoot, '.entire', 'tmp'))).toBe(false)
    expect(existsSync(join(tempRoot, 'entire-dsh'))).toBe(false)
  })

  it('writes each record and reference before the matching keyless lifecycle hook', async () => {
    const { ctx, bridge, subprocess, repositoryRoot } = await fixture(true)
    const session = ctx.sessions.create(SessionId('session-1'), { meta: { cwd: repositoryRoot } })
    session.append('turn/start', { turn: 1 })
    session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'run the tool' }], source: { kind: 'user' } }), { surfaceOp: 'append' })
    session.append('tool/call', { turn: 1, step: 0, callId: CallId('call-1'), name: 'read', arguments: '{"path":"README.md"}' })
    session.append('tool/policy-result', { callId: CallId('call-1'), rootCallId: CallId('call-1'), name: 'read', outcome: 'allowed', source: 'pre-execute' }, { ignorable: true })
    session.append('tool/body-start', { callId: CallId('call-1'), rootCallId: CallId('call-1'), name: 'read' }, { ignorable: true })
    session.append('tool/body-end', { callId: CallId('call-1'), rootCallId: CallId('call-1'), name: 'read', outcome: 'returned', aborted: false }, { ignorable: true })
    session.append('tool/result', { turn: 1, step: 0, message: createToolResultMessage({ callId: CallId('call-1'), content: [{ type: 'text', text: 'contents' }], isError: false }) }, { surfaceOp: 'append' })
    session.append('assistant/message', { turn: 1, step: 0, message: createAssistantMessage({ content: [{ type: 'text', text: 'done' }], source: { provider: 'mock', model: 'mock' } }) }, { surfaceOp: 'append' })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })

    await bridge.dispose()

    const payloads = subprocess.calls.map(call => JSON.parse((call.spec.stdio.stdin as { data: string }).data) as Record<string, unknown>)
    expect(payloads.map(payload => payload.hook_type)).toEqual(['session-start', 'turn-start', 'turn-end', 'session-end'])
    expect(payloads[1]).toMatchObject({ prompt: 'run the tool' })
    for (const [index, payload] of payloads.entries()) {
      expect(payload).toMatchObject({
        schema_version: 1,
        agent: 'dsh',
        session_id: 'session-1',
      })
      expect(String(payload.session_ref)).toMatch(/[\\/]sessions[\\/]session-1\.jsonl$/)
      expect(Number.isNaN(Date.parse(String(payload.timestamp)))).toBe(false)
      expect(subprocess.calls[index]!.transcript).toContain(`"kind":"session-start"`)
    }
    const transcriptPath = String(payloads[0]!.session_ref)
    const reference = JSON.parse(await readFile(String(payloads[0]!.reference_path), 'utf8')) as Record<string, unknown>
    expect(reference).toEqual({
      schema_version: 1,
      session_id: 'session-1',
      agent_name: 'dsh',
      repo_path: repositoryRoot,
      sidecar_ref: transcriptPath,
      start_time: new Date(session.header.createdAt).toISOString(),
      modified_files: [],
      new_files: [],
      deleted_files: [],
    })
    const eventTypes = (await readFile(transcriptPath, 'utf8')).trim().split('\n').map(line => JSON.parse(line) as { kind?: string }).map(record => record.kind).filter(Boolean)
    expect(eventTypes).toEqual([
      'session-start', 'turn-start', 'prompt', 'tool-call', 'tool-policy-result', 'tool-body-start',
      'tool-body-end', 'tool-result', 'assistant', 'turn-end', 'session-end',
    ])
  })

  it('maps compaction start once and never turns injected context into a user-turn hook', async () => {
    const { ctx, bridge, subprocess, repositoryRoot } = await fixture(true)
    const session = ctx.sessions.create(SessionId('mapping'), { meta: { cwd: repositoryRoot } })
    session.append('turn/start', { turn: 1 })
    session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'internal' }], source: { kind: 'plugin', plugin: 'fixture' } }), { surfaceOp: 'append' })
    session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'human prompt' }], source: { kind: 'user' } }), { surfaceOp: 'append' })
    session.append('compaction/start', { compactionId: 'compact-1', turn: 1 })
    session.append('compaction/end', { compactionId: 'compact-1', turn: 1 })

    await bridge.dispose()

    const payloads = subprocess.calls.map(call => JSON.parse((call.spec.stdio.stdin as { data: string }).data) as Record<string, unknown>)
    expect(payloads.filter(payload => payload.hook_type === 'turn-start')).toEqual([
      expect.objectContaining({ prompt: 'human prompt' }),
    ])
    expect(payloads.filter(payload => payload.hook_type === 'compaction')).toHaveLength(1)
  })

  it('durably writes a sibling child sidecar before linking it from the parent transcript', async () => {
    const { ctx, bridge, subprocess, repositoryRoot } = await fixture(true)
    const parent = ctx.sessions.create(SessionId('root-session'), { meta: { cwd: repositoryRoot } })
    const child = ctx.sessions.create(SessionId('child-session'), {
      meta: { cwd: repositoryRoot, parentSession: parent.id, origin: 'subagent' },
    })
    child.append('turn/start', { turn: 1 })
    child.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'child work' }], source: { kind: 'user' } }), { surfaceOp: 'append' })
    ctx.events.emit('subagent/start', { runId: 'run-1', provider: 'mock', id: child.id, local: true })
    ctx.events.emit('subagent/end', { runId: 'run-1', provider: 'mock', id: child.id, local: true, stopReason: 'completed' })

    await bridge.dispose()

    const start = subprocess.calls.find((call) => {
      const payload = JSON.parse((call.spec.stdio.stdin as { data: string }).data) as Record<string, unknown>
      return payload.hook_type === 'subagent-start'
    })
    expect(start).toBeDefined()
    const payload = JSON.parse((start!.spec.stdio.stdin as { data: string }).data) as Record<string, unknown>
    expect(payload).toMatchObject({ session_id: 'root-session', subagent_id: 'child-session', subagent_ref: 'child-session.jsonl' })
    const rootTranscript = start!.transcript
    expect(rootTranscript).toContain('"subagent_ref":"child-session.jsonl"')
    const childTranscript = String(payload.session_ref).replace(/root-session\.jsonl$/, 'child-session.jsonl')
    expect(await readFile(childTranscript, 'utf8')).toContain('"session_id":"child-session"')
  })
})
