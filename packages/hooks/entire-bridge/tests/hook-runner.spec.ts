import type { SubprocessHandle, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { describe, expect, it } from 'vitest'
import { EntireHookRunner } from '../src/hook-runner.ts'

function handle(
  done: Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>,
  stdout = '',
): SubprocessHandle {
  return {
    pid: 1,
    stdin: undefined,
    stdout: undefined,
    stderr: undefined,
    collected: {
      stdout: { readFrom: () => ({ text: stdout, nextOffset: Buffer.byteLength(stdout), lossy: false }) },
      stderr: { readFrom: () => ({ text: '', nextOffset: 0, lossy: false }) },
    },
    done,
    terminate: () => undefined,
    waitForExit: async () => true,
  }
}

describe('EntireHookRunner', () => {
  it('invokes Entire with a fixed argument vector and exactly one JSON stdin payload', async () => {
    const spawns: SubprocessSpawnSpec[] = []
    const warnings: string[] = []
    const subprocess = {
      resolveExecutable: async () => 'C:\\tools\\entire.exe',
      spawn: (spec: SubprocessSpawnSpec) => {
        spawns.push(spec)
        return handle(Promise.resolve({ exitCode: 0, signal: null }), 'must not be logged: transcript secret')
      },
    }
    const runner = new EntireHookRunner(subprocess as never, {
      cwd: 'C:\\repo',
      graceMs: 1000,
      outputMaxBytes: 4096,
      warn: warning => warnings.push(warning),
    })
    const payload = {
      schema_version: 1 as const,
      agent: 'dsh' as const,
      hook_type: 'turn-start' as const,
      session_id: 's1',
      timestamp: '2026-08-13T16:00:00.000Z',
      session_ref: 'C:\\temp\\entire-dsh\\hash\\sessions\\s1.jsonl',
      secret: 'payload secret',
    }

    await runner.run('turn-start', payload)

    expect(spawns).toHaveLength(1)
    expect(spawns[0]).toMatchObject({
      argv: ['C:\\tools\\entire.exe', 'hooks', 'dsh', 'turn-start'],
      cwd: 'C:\\repo',
      stdio: {
        stdin: { data: `${JSON.stringify(payload)}\n` },
        stdout: { maxBytes: 4096 },
        stderr: { maxBytes: 4096 },
      },
      graceMs: 1000,
    })
    expect(warnings.join('\n')).not.toContain('transcript secret')
    expect(warnings.join('\n')).not.toContain('payload secret')
  })

  it('contains unavailable and failed Entire invocations', async () => {
    const warnings: string[] = []
    const unavailable = new EntireHookRunner({
      resolveExecutable: async () => { throw new Error('missing') },
    } as never, { cwd: 'C:\\repo', graceMs: 1000, outputMaxBytes: 64, warn: warning => warnings.push(warning) })
    await expect(unavailable.run('session-start', { schema_version: 1, agent: 'dsh', hook_type: 'session-start', session_id: 's1', timestamp: '2026-08-13T16:00:00.000Z', session_ref: 'C:\\repo\\ref' })).resolves.toBeUndefined()

    const failed = new EntireHookRunner({
      resolveExecutable: async () => 'entire',
      spawn: () => handle(Promise.resolve({ exitCode: 2, signal: null })),
    } as never, { cwd: 'C:\\repo', graceMs: 1000, outputMaxBytes: 64, warn: warning => warnings.push(warning) })
    await expect(failed.run('session-end', { schema_version: 1, agent: 'dsh', hook_type: 'session-end', session_id: 's1', timestamp: '2026-08-13T16:00:00.000Z', session_ref: 'C:\\repo\\ref' })).resolves.toBeUndefined()
    expect(warnings).toHaveLength(2)
  })

  it('serializes lifecycle hooks in call order', async () => {
    const started: string[] = []
    let releaseFirst!: () => void
    const firstDone = new Promise<void>(resolve => { releaseFirst = resolve })
    const runner = new EntireHookRunner({
      resolveExecutable: async () => 'entire',
      spawn: (spec: SubprocessSpawnSpec) => {
        const hook = spec.argv[3]!
        started.push(hook)
        const done = hook === 'session-start' ? firstDone : Promise.resolve()
        return handle(done.then(() => ({ exitCode: 0, signal: null })))
      },
    } as never, { cwd: 'C:\\repo', graceMs: 1000, outputMaxBytes: 64, warn: () => undefined })
    const payload = (hook_type: 'session-start' | 'turn-start') => ({
      schema_version: 1 as const, agent: 'dsh' as const, hook_type, session_id: 's1',
      timestamp: '2026-08-13T16:00:00.000Z', session_ref: 'C:\\temp\\s1.jsonl',
    })

    const first = runner.run('session-start', payload('session-start'))
    const second = runner.run('turn-start', payload('turn-start'))
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(started).toEqual(['session-start'])
    releaseFirst()
    await Promise.all([first, second])
    expect(started).toEqual(['session-start', 'turn-start'])
  })

  it('cancels and drains an in-flight hook on disposal', async () => {
    let observedAbort = false
    let settle!: (outcome: { exitCode: number | null; signal: NodeJS.Signals | null }) => void
    const done = new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>(resolve => { settle = resolve })
    const runner = new EntireHookRunner({
      resolveExecutable: async () => 'entire',
      spawn: (spec: SubprocessSpawnSpec) => {
        spec.signal!.addEventListener('abort', () => {
          observedAbort = true
          settle({ exitCode: null, signal: 'SIGTERM' })
        }, { once: true })
        return handle(done)
      },
    } as never, { cwd: 'C:\\repo', graceMs: 1000, outputMaxBytes: 64, warn: () => undefined })

    const running = runner.run('turn-end', { schema_version: 1, agent: 'dsh', hook_type: 'turn-end', session_id: 's1', timestamp: '2026-08-13T16:00:00.000Z', session_ref: 'C:\\repo\\ref' })
    await new Promise(resolve => setTimeout(resolve, 0))
    await runner.dispose()

    expect(observedAbort).toBe(true)
    await expect(running).resolves.toBeUndefined()
  })
})
