/** Projection from committed SessionEvent records to the bounded Entire sidecar. @module @deepseek-ai/dsh-entire-bridge/transcript */

import { Buffer } from 'node:buffer'
import { isAbsolute, relative, sep } from 'node:path'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-user-approval'
import type {} from '@deepseek-ai/dsh-compaction'
import { redactCredentialValues } from './redaction.ts'

/** Session identity copied into every independent sidecar record. */
export interface EntireTranscriptSession {
  readonly id: string
  readonly parentSessionId?: string
}

/** Privacy and complete-record limits for transcript projection. */
export interface TranscriptOptions {
  readonly strict: boolean
  readonly toolResultMaxBytes: number
  /** Canonical workspace root used to turn absolute mutation paths into safe hints. */
  readonly repositoryRoot?: string
}

/** One normalized committed event in the bridge-owned JSONL sidecar. */
export interface EntireTranscriptRecord {
  readonly schema_version: 1
  readonly kind: string
  readonly session_id: string
  readonly parent_session_id?: string
  /** RFC 3339 time of the committed Harness event. */
  readonly timestamp: string
  readonly seq: number
  readonly prompt?: string
  readonly text?: string
  readonly summary?: string
  readonly modified_files?: readonly string[]
  readonly subagent_ref?: string
  readonly usage?: EntireNormalizedUsage
  readonly data?: Readonly<Record<string, unknown>>
}

/** Token keys consumed by the Entire DSH adapter. */
export interface EntireNormalizedUsage {
  readonly input_tokens: number
  readonly cache_creation_tokens: number
  readonly cache_read_tokens: number
  readonly output_tokens: number
  readonly api_call_count: number
}

function selectedAssistantContent(content: readonly unknown[], strict: boolean): readonly unknown[] {
  const selected = content.filter((block) => {
    if (typeof block !== 'object' || block === null) return true
    const type = (block as { type?: unknown }).type
    return type !== 'tool-call' && (!strict || type !== 'reasoning')
  })
  return structuredClone(selected)
}

function textFromContent(content: readonly unknown[], strict: boolean): string {
  return selectedAssistantContent(content, strict).flatMap((block) => {
    if (typeof block !== 'object' || block === null) return []
    const value = (block as { text?: unknown }).text
    return typeof value === 'string' ? [value] : []
  }).join('\n')
}

function numericField(value: unknown, ...keys: string[]): number {
  if (typeof value !== 'object' || value === null) return 0
  const fields = value as Record<string, unknown>
  for (const key of keys) {
    if (typeof fields[key] === 'number') return fields[key]
  }
  return 0
}

function normalizedUsage(value: unknown): EntireNormalizedUsage {
  return {
    input_tokens: numericField(value, 'inputTokens', 'input_tokens'),
    cache_creation_tokens: numericField(value, 'cacheWriteTokens', 'cacheCreationTokens', 'cacheCreationInputTokens', 'cache_creation_tokens'),
    cache_read_tokens: numericField(value, 'cacheReadTokens', 'cacheReadInputTokens', 'cache_read_tokens'),
    output_tokens: numericField(value, 'outputTokens', 'output_tokens'),
    api_call_count: 1,
  }
}

function parsedArguments(value: unknown): unknown {
  if (typeof value !== 'string') return structuredClone(value)
  try {
    return JSON.parse(value) as unknown
  } catch {
    return value
  }
}

function mutationFile(name: string, value: unknown, repositoryRoot?: string): string | undefined {
  const args = parsedArguments(value)
  if (typeof args !== 'object' || args === null || Array.isArray(args)) return undefined
  const fields = args as Record<string, unknown>
  const path = name === 'write' || name === 'edit' ? fields.file_path : fields.path
  if (typeof path !== 'string' || path.length === 0 || path.length > 240) return undefined
  let hint = path
  if (isAbsolute(path)) {
    if (repositoryRoot === undefined) return undefined
    hint = relative(repositoryRoot, path)
  }
  if (hint === '' || hint === '..' || hint.startsWith(`..${sep}`) || isAbsolute(hint)) return undefined
  hint = hint.replaceAll('\\', '/')
  if (name === 'write' || name === 'edit') return hint
  if (name === 'str_replace_editor' && ['str_replace', 'insert', 'create'].includes(String(fields.command))) return hint
  return undefined
}

function base(
  session: EntireTranscriptSession,
  event: SessionEvent,
  kind: string,
  data: Record<string, unknown> = {},
  adapter: Partial<Pick<EntireTranscriptRecord, 'prompt' | 'text' | 'summary' | 'modified_files' | 'subagent_ref' | 'usage'>> = {},
): EntireTranscriptRecord {
  return {
    schema_version: 1,
    kind,
    session_id: session.id,
    ...session.parentSessionId === undefined ? {} : { parent_session_id: session.parentSessionId },
    timestamp: new Date(event.time).toISOString(),
    seq: event.seq,
    ...adapter,
    ...Object.keys(data).length === 0 ? {} : { data: redactCredentialValues(data) as Record<string, unknown> },
  }
}

function toolResultData(event: Extract<SessionEvent, { type: 'tool/result' }>, strict: boolean): Record<string, unknown> {
  const block = event.data.message.content[0]
  return {
    turn: event.data.turn,
    step: event.data.step,
    callId: String(event.data.message.source.callId),
    isError: block.isError,
    ...event.data.error === undefined ? {} : { error: { name: event.data.error.name, code: event.data.error.code } },
    ...strict ? {} : { content: structuredClone(block.content) },
  }
}

function boundToolResult(record: EntireTranscriptRecord, maxBytes: number): EntireTranscriptRecord {
  const serialized = JSON.stringify(record)
  const originalBytes = Buffer.byteLength(serialized, 'utf8')
  if (originalBytes <= maxBytes) return record
  const { turn, step, callId, toolName, isError, error } = record.data ?? {}
  return {
    ...record,
    data: {
      turn,
      step,
      callId,
      toolName,
      isError,
      ...error === undefined ? {} : { error },
      contentOmitted: true,
      originalBytes,
    },
  }
}

/**
 * Normalize one committed session event, dropping fields outside the adapter transcript policy.
 * @param session - session and lineage identity.
 * @param event - committed event from the canonical `session/event` feed.
 * @param options - strict privacy selection and tool-result byte cap.
 * @returns one sidecar record, or `undefined` for an intentionally omitted event.
 */
export function normalizeSessionEvent(
  session: EntireTranscriptSession,
  event: SessionEvent,
  options: TranscriptOptions,
): EntireTranscriptRecord | undefined {
  let data: Record<string, unknown> | undefined
  let kind: string
  let adapter: Partial<Pick<EntireTranscriptRecord, 'prompt' | 'text' | 'summary' | 'modified_files' | 'usage'>> = {}
  switch (event.type) {
    case 'turn/start':
      kind = 'turn-start'
      data = { turn: event.data.turn }
      break
    case 'turn/end':
      kind = 'turn-end'
      data = { turn: event.data.turn, reason: { kind: event.data.reason.kind } }
      break
    case 'user/message':
      if (event.data.source.kind !== 'user') return undefined
      kind = 'prompt'
      data = { content: structuredClone(event.data.content) }
      adapter = { prompt: textFromContent(event.data.content, true) }
      break
    case 'assistant/message':
      kind = 'assistant'
      data = {
        turn: event.data.turn,
        step: event.data.step,
        provider: event.data.message.source.provider,
        model: event.data.message.source.model,
        content: selectedAssistantContent(event.data.message.content, options.strict),
        ...event.data.usage === undefined ? {} : { usage: structuredClone(event.data.usage) },
      }
      adapter = {
        text: textFromContent(event.data.message.content, options.strict),
        ...event.data.usage === undefined ? {} : { usage: normalizedUsage(event.data.usage) },
      }
      break
    case 'tool/call':
      kind = 'tool-call'
      data = {
        turn: event.data.turn,
        step: event.data.step,
        callId: String(event.data.callId),
        name: event.data.name,
        ...options.strict ? {} : { arguments: parsedArguments(event.data.arguments) },
      }
      break
    case 'tool/result': {
      const record = base(session, event, 'tool-result', toolResultData(event, options.strict))
      return boundToolResult(record, options.toolResultMaxBytes)
    }
    case 'tool/policy-result':
      kind = 'tool-policy-result'
      data = structuredClone(event.data) as unknown as Record<string, unknown>
      break
    case 'tool/body-start':
      kind = 'tool-body-start'
      data = structuredClone(event.data) as unknown as Record<string, unknown>
      break
    case 'tool/body-end':
      kind = 'tool-body-end'
      data = structuredClone(event.data) as unknown as Record<string, unknown>
      break
    case 'approval/asked':
      kind = 'approval-asked'
      data = {
        id: String(event.data.id),
        toolName: event.data.toolName,
        ...event.data.callId === undefined ? {} : { callId: String(event.data.callId) },
      }
      break
    case 'approval/decided':
      kind = 'approval-decided'
      data = { id: String(event.data.id), outcome: event.data.outcome }
      break
    case 'tool/code-dispatch-start':
      kind = 'tool-code-dispatch-start'
      data = {
        rootCallId: String(event.data.rootCallId),
        parentCallId: String(event.data.parentCallId),
        subCallId: String(event.data.subCallId),
        name: event.data.name,
        ...options.strict ? {} : { arguments: structuredClone(event.data.arguments) },
      }
      break
    case 'tool/code-dispatch':
      kind = 'tool-code-dispatch'
      data = {
        rootCallId: String(event.data.rootCallId),
        parentCallId: String(event.data.parentCallId),
        subCallId: String(event.data.subCallId),
        name: event.data.name,
        isError: event.data.isError,
        ...options.strict ? {} : {
          arguments: structuredClone(event.data.arguments),
          content: structuredClone(event.data.content),
        },
      }
      if (!event.data.isError) {
        const file = mutationFile(event.data.name, event.data.arguments, options.repositoryRoot)
        if (file !== undefined) adapter = { modified_files: [file] }
      }
      break
    case 'compaction/start':
      kind = 'compaction-start'
      data = { compactionId: String(event.data.compactionId), turn: event.data.turn }
      break
    case 'compaction/summary':
      kind = 'compaction'
      data = {
        compactionId: String(event.data.compactionId),
        shadowedRange: structuredClone(event.data.shadowedRange),
        shadowedTokenCount: event.data.shadowedTokenCount,
        provider: event.data.provider,
        model: event.data.model,
        ...event.data.usage === undefined ? {} : { usage: structuredClone(event.data.usage) },
      }
      adapter = {
        summary: textFromContent(event.data.summary, true),
        ...event.data.usage === undefined ? {} : { usage: normalizedUsage(event.data.usage) },
      }
      break
    case 'compaction/end':
      kind = 'compaction-end'
      data = { compactionId: String(event.data.compactionId), turn: event.data.turn, failed: event.data.error !== undefined }
      break
    default:
      return undefined
  }
  return base(session, event, kind, data, adapter)
}

/** Stateful per-session projection that correlates successful root tool results with mutation hints. */
export class EntireTranscriptProjector {
  private readonly pendingFiles = new Map<string, string>()

  constructor(
    private readonly session: EntireTranscriptSession,
    private readonly options: TranscriptOptions,
  ) {}

  /** Project one committed event while retaining only bounded call/file correlation state. */
  project(event: SessionEvent): EntireTranscriptRecord | undefined {
    if (event.type === 'tool/call') {
      const file = mutationFile(event.data.name, event.data.arguments, this.options.repositoryRoot)
      if (file !== undefined) this.pendingFiles.set(String(event.data.callId), file)
    }
    const record = normalizeSessionEvent(this.session, event, this.options)
    if (event.type !== 'tool/result') return record
    const callId = String(event.data.message.source.callId)
    const file = this.pendingFiles.get(callId)
    this.pendingFiles.delete(callId)
    const block = event.data.message.content[0]
    if (record === undefined || file === undefined || block.isError === true) return record
    return boundToolResult({ ...record, modified_files: [file] }, this.options.toolResultMaxBytes)
  }
}
