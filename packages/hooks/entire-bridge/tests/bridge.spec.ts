import { existsSync, readFileSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { createAssistantMessage, createToolResultMessage, createUserMessage, CallId } from '@deepseek-ai/dsh-llm'
import { CompactionId } from '@deepseek-ai/dsh-compaction'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SubprocessRuntime from '@deepseek-ai/dsh-subprocess'
import type { SubprocessHandle, SubprocessSpawnSpec, SubprocessTerminalHandle, SubprocessTerminalSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as EntireBridge from '../src/index.ts'

const roots: string[] = []

class CaptureSubprocess extends SubprocessRuntime {
  readonly calls: Array<{ spec: SubprocessSpawnSpec; transcript: string }> = []

  resolveExecutable(): Promise<string> {
    return Promise.resolve('entire')
  }

  spawn(spec: SubprocessSpawnSpec): SubprocessHandle {
    const payload = JSON.parse((spec.stdio.stdin as { data: string }).data) as { session_ref: string }
    let transcript = '<sidecar unavailable>'
    try {
      transcript = readFileSync(payload.session_ref, 'utf8')
    } catch {}
    this.calls.push({
      spec,
      transcript,
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

class DeferredSessionStartSubprocess extends CaptureSubprocess {
  readonly startSpawned: Promise<void>
  private reportStartSpawned!: () => void
  private releaseStartDone!: () => void
  private readonly startDone: Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>

  constructor(ctx: Context) {
    super(ctx)
    this.startSpawned = new Promise((resolve) => { this.reportStartSpawned = resolve })
    this.startDone = new Promise((resolve) => {
      this.releaseStartDone = () => { resolve({ exitCode: 0, signal: null }) }
    })
  }

  releaseSessionStart(): void {
    this.releaseStartDone()
  }

  override spawn(spec: SubprocessSpawnSpec): SubprocessHandle {
    const completed = super.spawn(spec)
    if (spec.argv[3] !== 'session-start') return completed
    this.reportStartSpawned()
    return { ...completed, done: this.startDone }
  }
}

async function fixture(
  marker: boolean,
  subprocessFactory: (ctx: Context) => CaptureSubprocess = ctx => new CaptureSubprocess(ctx),
): Promise<{ ctx: Context; bridge: Awaited<ReturnType<Context['plugin']>>; subprocess: CaptureSubprocess; repositoryRoot: string; tempRoot: string }> {
  const repositoryRoot = await mkdtemp(join(tmpdir(), 'dsh-entire-bridge-repo-'))
  const tempRoot = await mkdtemp(join(tmpdir(), 'dsh-entire-bridge-rejected-temp-'))
  const productionSidecarRoot = dirname(dirname(EntireBridge.sidecarPaths(repositoryRoot, 'cleanup', tmpdir()).sidecarPath))
  roots.push(repositoryRoot, tempRoot, productionSidecarRoot)
  await mkdir(join(repositoryRoot, '.entire'), { recursive: true })
  if (marker) await writeFile(join(repositoryRoot, '.entire', 'dsh-hooks.json'), '{"schemaVersion":1,"agent":"dsh"}')
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  const subprocess = subprocessFactory(ctx)
  const bridge = await ctx.plugin(EntireBridge, {
    strict: false,
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
    const { ctx, bridge, subprocess, repositoryRoot } = await fixture(false)
    const session = ctx.sessions.create(SessionId('inactive'), { meta: { cwd: repositoryRoot } })
    session.append('turn/start', { turn: 1 })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })

    await bridge.dispose()

    expect(subprocess.calls).toEqual([])
    expect(existsSync(join(repositoryRoot, '.entire', 'tmp'))).toBe(false)
    expect(existsSync(EntireBridge.sidecarPaths(repositoryRoot, 'inactive', tmpdir()).sidecarPath)).toBe(false)
  })

  it('always writes production sidecars beneath the operating-system temporary directory', async () => {
    const { ctx, bridge, subprocess, repositoryRoot, tempRoot } = await fixture(true)
    ctx.sessions.create(SessionId('os-temp-only'), { meta: { cwd: repositoryRoot } })

    await bridge.dispose()

    const payload = JSON.parse((subprocess.calls[0]!.spec.stdio.stdin as { data: string }).data) as { session_ref: string }
    expect(payload.session_ref).toContain(join(tmpdir(), 'entire-dsh'))
    expect(payload.session_ref).not.toContain(tempRoot)
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
      expect(subprocess.calls[index]!.transcript).toContain('"kind":"session-start"')
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

  it('serializes hook snapshots in sidecar append order without blocking event listeners', async () => {
    const result = await fixture(true, ctx => new DeferredSessionStartSubprocess(ctx))
    const { ctx, bridge, repositoryRoot } = result
    const subprocess = result.subprocess as DeferredSessionStartSubprocess
    const session = ctx.sessions.create(SessionId('ordered'), { meta: { cwd: repositoryRoot } })
    session.append('turn/start', { turn: 1 })
    session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'first prompt' }], source: { kind: 'user' } }), { surfaceOp: 'append' })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })

    await subprocess.startSpawned
    expect(subprocess.calls.map(call => call.spec.argv[3])).toEqual(['session-start'])
    await new Promise(resolve => setTimeout(resolve, 25))
    const startPayload = JSON.parse((subprocess.calls[0]!.spec.stdio.stdin as { data: string }).data) as { session_ref: string }
    const blockedKinds = (await readFile(startPayload.session_ref, 'utf8')).trim().split('\n')
      .map(line => (JSON.parse(line) as { kind: string }).kind)
    expect(blockedKinds).toEqual(['session-start'])
    subprocess.releaseSessionStart()
    await bridge.dispose()

    const turnStart = subprocess.calls.find(call => call.spec.argv[3] === 'turn-start')
    const turnEnd = subprocess.calls.find(call => call.spec.argv[3] === 'turn-end')
    expect(turnStart?.transcript).not.toContain('"kind":"turn-end"')
    expect(turnStart?.transcript).not.toContain('"kind":"session-end"')
    expect(turnEnd?.transcript).toContain('"kind":"turn-end"')
    expect(turnEnd?.transcript).not.toContain('"kind":"session-end"')
  })

  it('maps compaction start once and never turns injected context into a user-turn hook', async () => {
    const { ctx, bridge, subprocess, repositoryRoot } = await fixture(true)
    const session = ctx.sessions.create(SessionId('mapping'), { meta: { cwd: repositoryRoot } })
    session.append('turn/start', { turn: 1 })
    session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'internal' }], source: { kind: 'plugin', plugin: 'fixture' } }), { surfaceOp: 'append' })
    session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'human prompt' }], source: { kind: 'user' } }), { surfaceOp: 'append' })
    session.append('compaction/start', { compactionId: CompactionId('compact-1'), turn: 1 })
    session.append('compaction/end', { compactionId: CompactionId('compact-1'), turn: 1 })

    await bridge.dispose()

    const payloads = subprocess.calls.map(call => JSON.parse((call.spec.stdio.stdin as { data: string }).data) as Record<string, unknown>)
    expect(payloads.filter(payload => payload.hook_type === 'turn-start')).toEqual([
      expect.objectContaining({ prompt: 'human prompt' }),
    ])
    expect(payloads.filter(payload => payload.hook_type === 'compaction')).toHaveLength(1)
  })

  it('does not invoke a hook after its sidecar append fails', async () => {
    const { ctx, bridge, subprocess, repositoryRoot } = await fixture(true)
    const session = ctx.sessions.create(SessionId('append-failure'), { meta: { cwd: repositoryRoot } })
    await vi.waitFor(() => { expect(subprocess.calls).toHaveLength(1) })
    const startPayload = JSON.parse((subprocess.calls[0]!.spec.stdio.stdin as { data: string }).data) as { session_ref: string }
    const sessionsDirectory = dirname(startPayload.session_ref)
    await rm(sessionsDirectory, { recursive: true, force: true })
    await writeFile(sessionsDirectory, 'blocks later appends')

    session.append('turn/start', { turn: 1 })
    session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'must not checkpoint stale data' }], source: { kind: 'user' } }), { surfaceOp: 'append' })
    await bridge.dispose()

    expect(subprocess.calls.map(call => call.spec.argv[3])).toEqual(['session-start'])
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

    const lifecycle = subprocess.calls.filter((call) => {
      const payload = JSON.parse((call.spec.stdio.stdin as { data: string }).data) as Record<string, unknown>
      return payload.hook_type === 'subagent-start' || payload.hook_type === 'subagent-end'
    })
    expect(lifecycle).toHaveLength(2)
    const [start, end] = lifecycle
    expect(start).toBeDefined()
    const payload = JSON.parse((start!.spec.stdio.stdin as { data: string }).data) as Record<string, unknown>
    const endPayload = JSON.parse((end!.spec.stdio.stdin as { data: string }).data) as Record<string, unknown>
    expect(payload).toMatchObject({
      session_id: 'root-session',
      subagent_id: 'child-session',
      subagent_ref: 'child-session.jsonl',
      tool_use_id: 'run-1',
    })
    expect(endPayload).toMatchObject({
      session_id: 'root-session',
      subagent_id: 'child-session',
      tool_use_id: 'run-1',
    })
    expect(payload).not.toHaveProperty('run_id')
    expect(endPayload).not.toHaveProperty('run_id')
    const rootTranscript = start!.transcript
    expect(rootTranscript).toContain('"subagent_ref":"child-session.jsonl"')
    const startRecord = rootTranscript.trim().split('\n').map(line => JSON.parse(line) as Record<string, unknown>)
      .find(record => record.kind === 'subagent-start')
    const endRecord = end!.transcript.trim().split('\n').map(line => JSON.parse(line) as Record<string, unknown>)
      .find(record => record.kind === 'subagent-end')
    expect(startRecord).toMatchObject({ tool_use_id: 'run-1' })
    expect(endRecord).toMatchObject({ tool_use_id: 'run-1' })
    const childTranscript = String(payload.session_ref).replace(/root-session\.jsonl$/, 'child-session.jsonl')
    expect(await readFile(childTranscript, 'utf8')).toContain('"session_id":"child-session"')
  })

  it('forgets disposed captures and purges subagent runs that reference them', async () => {
    const { ctx, bridge, subprocess, repositoryRoot } = await fixture(true)
    const parent = ctx.sessions.create(SessionId('bounded-parent'), { meta: { cwd: repositoryRoot } })
    const child = ctx.sessions.prepare(SessionId('reused-child'), {
      meta: { cwd: repositoryRoot, parentSession: parent.id, origin: 'subagent' },
    })
    const detachChild = ctx.sessions.enter(child)
    ctx.sessions.announce(child)
    ctx.events.emit('subagent/start', { runId: 'stale-run', provider: 'mock', id: child.id, local: true })
    detachChild()
    await vi.waitFor(() => {
      const childEnds = subprocess.calls.filter((call) => {
        const payload = JSON.parse((call.spec.stdio.stdin as { data: string }).data) as Record<string, unknown>
        return payload.session_id === 'reused-child' && payload.hook_type === 'session-end'
      })
      expect(childEnds).toHaveLength(1)
    })

    ctx.events.emit('subagent/end', {
      runId: 'stale-run', provider: 'mock', id: child.id, local: true, stopReason: 'completed',
    })
    const detachReusedChild = ctx.sessions.enter(child)
    ctx.sessions.announce(child)
    detachReusedChild()
    await bridge.dispose()

    const payloads = subprocess.calls.map(call => JSON.parse((call.spec.stdio.stdin as { data: string }).data) as Record<string, unknown>)
    expect(payloads.filter(payload => payload.session_id === 'reused-child' && payload.hook_type === 'session-start')).toHaveLength(2)
    expect(payloads.filter(payload => payload.session_id === 'reused-child' && payload.hook_type === 'session-end')).toHaveLength(2)
    expect(payloads.filter(payload => payload.session_id === 'bounded-parent' && payload.hook_type === 'subagent-end')).toEqual([])
  })

  it('normalizes mutation hints against the marker canonical root when cwd is a symlink alias', async () => {
    const { ctx, bridge, subprocess, repositoryRoot } = await fixture(true)
    const aliasParent = await mkdtemp(join(tmpdir(), 'dsh-entire-alias-parent-'))
    roots.push(aliasParent)
    const alias = join(aliasParent, 'alias')
    try {
      await symlink(repositoryRoot, alias, 'junction')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EPERM') return
      throw error
    }
    const session = ctx.sessions.create(SessionId('alias-session'), { meta: { cwd: alias } })
    session.append('tool/call', {
      turn: 1, step: 0, callId: CallId('write-1'), name: 'write',
      arguments: JSON.stringify({ file_path: join(repositoryRoot, 'src', 'app.ts'), content: 'private' }),
    })
    session.append('tool/result', {
      turn: 1, step: 0,
      message: createToolResultMessage({ callId: CallId('write-1'), content: [], isError: false }),
    }, { surfaceOp: 'append' })

    await bridge.dispose()

    const transcript = subprocess.calls.at(-1)!.transcript
    expect(transcript).toContain('"modified_files":["src/app.ts"]')
  })
})
