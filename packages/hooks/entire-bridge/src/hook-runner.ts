/**
 * Safe argument-vector Entire hook execution with contained failures and quiescent disposal.
 * @module @deepseek-ai/dsh-entire-bridge/hook-runner
 */

import type { SubprocessHandle, SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import type { EntireHookName, EntireHookPayload } from './types.ts'

const MAX_TIMER_DELAY_MS = 2_147_483_647

function boundedDelay(milliseconds: number): number {
  return Math.min(MAX_TIMER_DELAY_MS, Math.max(1, milliseconds))
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error('aborted')
}

function untilAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortError(signal))
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => { reject(abortError(signal)) }
    signal.addEventListener('abort', onAbort, { once: true })
    void promise.then(resolve, reject).finally(() => {
      signal.removeEventListener('abort', onAbort)
    })
  })
}

/** Process and diagnostic settings for one repository's Entire hooks. */
export interface EntireHookRunnerOptions {
  readonly cwd: string
  readonly graceMs: number
  readonly timeoutMs: number
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
    void task.then(
      () => { this.runs.delete(task) },
      () => { this.runs.delete(task) },
    )
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
    if (this.controller.signal.aborted) return
    const controller = new AbortController()
    const timeoutError = new Error('hook deadline exceeded')
    const disposeError = new Error('hook runner disposed')
    const onDispose = (): void => { controller.abort(disposeError) }
    this.controller.signal.addEventListener('abort', onDispose, { once: true })
    const timeout = setTimeout(() => {
      controller.abort(timeoutError)
    }, boundedDelay(this.options.timeoutMs))
    let handle: SubprocessHandle | undefined
    try {
      const executable = await untilAbort(
        this.subprocess.resolveExecutable('entire', undefined, controller.signal),
        controller.signal,
      )
      if (controller.signal.aborted) return
      handle = this.subprocess.spawn({
        argv: [executable, 'hooks', 'dsh', hook],
        cwd: this.options.cwd,
        stdio: {
          stdin: { data: `${JSON.stringify(payload)}\n` },
          stdout: { maxBytes: this.options.outputMaxBytes },
          stderr: { maxBytes: this.options.outputMaxBytes },
        },
        graceMs: this.options.graceMs,
        signal: controller.signal,
      })
      const outcome = await untilAbort(handle.done, controller.signal)
      const quiescent = await this.waitForTree(handle)
      if (!quiescent) {
        handle.terminate()
        await this.waitForTree(handle)
      }
      if (outcome.exitCode !== 0) {
        this.options.warn(`entire-bridge: ${hook} hook exited unsuccessfully`)
      }
    } catch (error: unknown) {
      if (handle !== undefined) {
        try {
          handle.terminate()
        } catch {}
        await this.waitForTree(handle)
      }
      if (error === timeoutError) {
        this.options.warn(`entire-bridge: ${hook} hook timed out`)
      } else if (error !== disposeError) {
        this.options.warn(`entire-bridge: ${hook} hook unavailable: ${String(error)}`)
      }
    } finally {
      clearTimeout(timeout)
      this.controller.signal.removeEventListener('abort', onDispose)
    }
  }

  private async waitForTree(handle: SubprocessHandle): Promise<boolean> {
    const controller = new AbortController()
    const timeout = setTimeout(
      () => { controller.abort(new Error('process-tree wait deadline exceeded')) },
      boundedDelay(this.options.graceMs * 2),
    )
    try {
      return await untilAbort(handle.waitForExit(controller.signal), controller.signal)
    } catch {
      return false
    } finally {
      clearTimeout(timeout)
    }
  }
}
