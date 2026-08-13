/**
 * Dormant clone-local bridge from committed Harness session events to a normalized sidecar and Entire lifecycle hooks.
 * @module @deepseek-ai/dsh-entire-bridge
 */

import { realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-user-approval'
import type {} from '@deepseek-ai/dsh-compaction'
import type { SubagentRunEndInfo, SubagentRunInfo } from '@deepseek-ai/dsh-subagent'
import { readEntireMarker } from './marker.ts'
import { EntireSidecarStorage } from './storage.ts'
import { EntireTranscriptProjector } from './transcript.ts'
import { EntireHookRunner } from './hook-runner.ts'
import type { ActiveEntireMarker, EntireHookName, EntireHookPayload } from './types.ts'

export { readEntireMarker } from './marker.ts'
export { EntireSidecarStorage, sidecarPaths } from './storage.ts'
export { EntireTranscriptProjector, normalizeSessionEvent } from './transcript.ts'
export { redactCredentialValues } from './redaction.ts'
export type {
  ActiveEntireMarker,
  EntireHookName,
  EntireHookPayload,
  EntireMarkerDocument,
} from './types.ts'
export type {
  EntireTranscriptRecord,
  EntireTranscriptSession,
  TranscriptOptions,
} from './transcript.ts'

/** Cordis plugin name. */
export const name = 'entire-bridge'
/** Services required before the bridge can observe sessions and spawn hooks. */
export const inject = ['sessions', 'subprocess']
const HOOK_TIMEOUT_MS = 30_000

/** Clone-local bridge limits and privacy mode. */
export interface Config {
  /** Omit tool inputs/results and assistant reasoning blocks from the sidecar. */
  strict?: boolean
  /** Complete serialized byte cap applied to each tool-result sidecar record. */
  toolResultMaxBytes?: number
  /** Managed-process termination grace for Entire hooks. */
  hookGraceMs?: number
  /** In-memory byte cap for each ignored Entire hook output stream. */
  hookOutputMaxBytes?: number
}

/** Runtime-validated bridge config. */
export const Config: z<Config> = z.object({
  strict: z.boolean().default(false),
  toolResultMaxBytes: z.number().min(256).default(65_536),
  hookGraceMs: z.number().min(1).default(1000),
  hookOutputMaxBytes: z.number().min(1).default(4096),
})

interface ActiveCapture {
  readonly marker: ActiveEntireMarker
  readonly storage: EntireSidecarStorage
  readonly runner: EntireHookRunner
  readonly transcriptPath: string
  readonly sessionRef: string
}

function lifecycleRecord(
  session: Session,
  lifecycle: EntireHookName,
  time: number,
  data: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    schema_version: 1,
    kind: lifecycle,
    session_id: String(session.id),
    ...session.header.parentSession === undefined ? {} : { parent_session_id: String(session.header.parentSession) },
    timestamp: new Date(time).toISOString(),
    ...data,
  }
}

function hookPayload(
  session: Session,
  active: ActiveCapture,
  hook: EntireHookName,
  time: number,
  data: Record<string, unknown> = {},
): EntireHookPayload {
  return {
    schema_version: 1,
    agent: 'dsh',
    hook_type: hook,
    session_id: String(session.id),
    timestamp: new Date(time).toISOString(),
    session_ref: active.sessionRef,
    reference_path: active.storage.paths.referencePath,
    cwd: active.marker.repositoryRoot,
    ...session.header.parentSession === undefined ? {} : { parent_session_id: String(session.header.parentSession) },
    ...data,
  }
}

function hookForEvent(event: SessionEvent): { hook: EntireHookName; data: Record<string, unknown> } | undefined {
  switch (event.type) {
    case 'user/message':
      if (event.data.source.kind !== 'user') return undefined
      return {
        hook: 'turn-start',
        data: { prompt: event.data.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n') },
      }
    case 'turn/end':
      return { hook: 'turn-end', data: { turn: event.data.turn, reason: event.data.reason.kind } }
    case 'compaction/start':
      return { hook: 'compaction', data: { compaction_id: String(event.data.compactionId) } }
    default:
      return undefined
  }
}

class SessionCapture {
  private queue: Promise<void> = Promise.resolve()
  private active: ActiveCapture | undefined
  private ended = false
  private projector: EntireTranscriptProjector | undefined

  constructor(
    private readonly ctx: Context,
    private readonly session: Session,
    config: Required<Config>,
  ) {
    this.enqueue(async () => {
      const cwd = session.header.cwd
      if (cwd === undefined) return
      const marker = await readEntireMarker(cwd)
      if (marker === undefined) return
      this.projector = new EntireTranscriptProjector({
        id: String(session.id),
        ...session.header.parentSession === undefined ? {} : { parentSessionId: String(session.header.parentSession) },
      }, {
        strict: config.strict,
        toolResultMaxBytes: config.toolResultMaxBytes,
        repositoryRoot: marker.repositoryRoot,
      })
      const storage = new EntireSidecarStorage({
        repositoryRoot: marker.repositoryRoot,
        sessionId: String(session.id),
        createdAt: session.header.createdAt,
        ...session.header.parentSession === undefined ? {} : { parentSessionId: String(session.header.parentSession) },
        tempRoot: tmpdir(),
        warn: (message) => { ctx.logger.warn(message) },
      })
      const time = session.header.createdAt
      if (!await storage.append(lifecycleRecord(session, 'session-start', time))) return
      const active: ActiveCapture = {
        marker,
        storage,
        runner: new EntireHookRunner(ctx.subprocess, {
          cwd: marker.repositoryRoot,
          graceMs: config.hookGraceMs,
          timeoutMs: HOOK_TIMEOUT_MS,
          outputMaxBytes: config.hookOutputMaxBytes,
          warn: (message) => { ctx.logger.warn(message) },
        }),
        transcriptPath: await realpath(storage.paths.sidecarPath),
        sessionRef: await realpath(storage.paths.sidecarPath),
      }
      this.active = active
      await active.runner.run('session-start', hookPayload(session, active, 'session-start', time))
    })
  }

  event(event: SessionEvent): void {
    this.enqueue(async () => {
      const active = this.active
      if (active === undefined) return
      const record = this.projector?.project(event)
      if (record === undefined) return
      if (!await active.storage.append(record)) return
      const mapped = hookForEvent(event)
      if (mapped !== undefined) {
        await active.runner.run(mapped.hook, hookPayload(this.session, active, mapped.hook, event.time, mapped.data))
      }
    })
  }

  lifecycle(hook: 'subagent-start' | 'subagent-end', time: number, data: Record<string, unknown>): void {
    this.enqueue(async () => {
      const active = this.active
      if (active === undefined) return
      if (!await active.storage.append(lifecycleRecord(this.session, hook, time, data))) return
      await active.runner.run(hook, hookPayload(this.session, active, hook, time, data))
    })
  }

  /** Link a child only after its sidecar and reference are durable. */
  linkChild(child: SessionCapture, hook: 'subagent-start' | 'subagent-end', time: number, data: Record<string, unknown>): void {
    this.enqueue(async () => {
      const childActive = await child.ready()
      const active = this.active
      if (active === undefined || childActive === undefined) return
      const linked = hook === 'subagent-start'
        ? { ...data, subagent_ref: `${String(child.session.id)}.jsonl` }
        : data
      if (!await active.storage.append(lifecycleRecord(this.session, hook, time, linked))) return
      await active.runner.run(hook, hookPayload(this.session, active, hook, time, linked))
    })
  }

  private async ready(): Promise<ActiveCapture | undefined> {
    await this.queue
    return this.active
  }

  async end(): Promise<void> {
    if (this.ended) return this.queue
    this.ended = true
    this.enqueue(async () => {
      const active = this.active
      if (active === undefined) return
      const time = Date.now()
      if (await active.storage.append(lifecycleRecord(this.session, 'session-end', time))) {
        await active.runner.run('session-end', hookPayload(this.session, active, 'session-end', time))
      }
      await active.storage.drain()
      await active.runner.dispose()
    })
    await this.queue
  }

  private enqueue(task: () => Promise<void>): void {
    this.queue = this.queue.then(task).catch((error: unknown) => {
      this.ctx.logger.warn(`entire-bridge: capture failed: ${String(error)}`)
    })
  }
}

/**
 * Mount the dormant bridge; sessions without an exact clone-local marker remain untouched.
 * @param ctx - Cordis context carrying session and subprocess services.
 * @param config - privacy, storage, and managed-process bounds.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const resolved: Required<Config> = {
    strict: config.strict ?? false,
    toolResultMaxBytes: config.toolResultMaxBytes ?? 65_536,
    hookGraceMs: config.hookGraceMs ?? 1000,
    hookOutputMaxBytes: config.hookOutputMaxBytes ?? 4096,
  }
  const captures = new Map<Session, SessionCapture>()
  const endings = new Map<Session, Promise<void>>()
  const subagentRuns = new Map<string, { parent: SessionCapture; child: SessionCapture }>()
  const adopt = (session: Session): SessionCapture => {
    let capture = captures.get(session)
    if (capture === undefined) {
      capture = new SessionCapture(ctx, session, resolved)
      captures.set(session, capture)
    }
    return capture
  }
  const endCapture = (session: Session): Promise<void> => {
    const existing = endings.get(session)
    if (existing !== undefined) return existing
    const capture = captures.get(session)
    if (capture === undefined) return Promise.resolve()
    const ending = capture.end().finally(() => {
      if (captures.get(session) === capture) captures.delete(session)
      for (const [runId, run] of subagentRuns) {
        if (run.parent === capture || run.child === capture) subagentRuns.delete(runId)
      }
      endings.delete(session)
    })
    endings.set(session, ending)
    return ending
  }
  ctx.on('session/created', adopt)
  ctx.on('session/event', (session, event) => { adopt(session).event(event) })
  ctx.on('session/disposed', (session) => { void endCapture(session) })
  ctx.on('subagent/start', (info: SubagentRunInfo) => {
    const child = ctx.sessions.get(info.id)
    if (child === undefined) return
    const parentId = child.header.parentSession
    const parentSession = parentId === undefined ? undefined : ctx.sessions.get(parentId)
    if (parentSession === undefined) return
    const parent = adopt(parentSession)
    const childCapture = adopt(child)
    subagentRuns.set(String(info.runId), { parent, child: childCapture })
    parent.linkChild(childCapture, 'subagent-start', Date.now(), {
      tool_use_id: String(info.runId), provider: info.provider, subagent_id: String(info.id), local: info.local,
    })
  })
  ctx.on('subagent/end', (info: SubagentRunEndInfo) => {
    const run = subagentRuns.get(String(info.runId))
    subagentRuns.delete(String(info.runId))
    run?.parent.linkChild(run.child, 'subagent-end', Date.now(), {
      tool_use_id: String(info.runId),
      provider: info.provider,
      subagent_id: String(info.id),
      local: info.local,
      stop_reason: info.stopReason,
    })
  })
  for (const session of ctx.sessions.list()) adopt(session)
  ctx.effect(() => async () => {
    await Promise.all([...captures.keys()].map(endCapture))
    await Promise.all([...endings.values()])
  }, 'entire-bridge: drain session captures and hooks')
}
