/** Safe argument-vector Entire hook execution with contained failures and quiescent disposal. @module @deepseek-ai/dsh-entire-bridge/hook-runner */

import type { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import type { EntireHookName, EntireHookPayload } from './types.ts'

/** Process and diagnostic settings for one repository's Entire hooks. */
export interface EntireHookRunnerOptions {
  readonly cwd: string
  readonly graceMs: number
  readonly outputMaxBytes: number
  readonly warn: (message: string) => void
}

/** Runs detached Entire hooks through the managed subprocess capability. */
export class EntireHookRunner {
  private readonly controller = new AbortController()
  private readonly runs = new Set<Promise<void>>()
  private tail: Promise<void> = Promise.resolve()

  constructor(
    private readonly subprocess: SubprocessRuntime,
    private readonly options: EntireHookRunnerOptions,
  ) {}

  /**
   * Invoke one Entire lifecycle hook and contain lookup, spawn, and exit failures.
   * @param hook - fixed external-agent hook name.
   * @param payload - versioned JSON payload written as the whole stdin stream.
   * @returns after the managed child exits or its failure is contained.
   */
  run(hook: EntireHookName, payload: EntireHookPayload): Promise<void> {
    if (this.controller.signal.aborted) return Promise.resolve()
    const task = this.tail.then(() => this.execute(hook, payload))
    this.tail = task
    this.runs.add(task)
    void task.finally(() => { this.runs.delete(task) })
    return task
  }

  /**
   * Cancel every running hook and wait for all tracked continuations.
   * @returns after no hook invocation owned by this runner remains active.
   */
  async dispose(): Promise<void> {
    this.controller.abort()
    await Promise.allSettled([...this.runs])
  }

  private async execute(hook: EntireHookName, payload: EntireHookPayload): Promise<void> {
    try {
      const executable = await this.subprocess.resolveExecutable('entire', undefined, this.controller.signal)
      if (this.controller.signal.aborted) return
      const handle = this.subprocess.spawn({
        argv: [executable, 'hooks', 'dsh', hook],
        cwd: this.options.cwd,
        stdio: {
          stdin: { data: `${JSON.stringify(payload)}\n` },
          stdout: { maxBytes: this.options.outputMaxBytes },
          stderr: { maxBytes: this.options.outputMaxBytes },
        },
        graceMs: this.options.graceMs,
        signal: this.controller.signal,
      })
      const outcome = await handle.done
      if (outcome.exitCode !== 0 && !this.controller.signal.aborted) {
        this.options.warn(`entire-bridge: ${hook} hook exited unsuccessfully`)
      }
    } catch (error: unknown) {
      if (!this.controller.signal.aborted) {
        this.options.warn(`entire-bridge: ${hook} hook unavailable: ${String(error)}`)
      }
    }
  }
}
