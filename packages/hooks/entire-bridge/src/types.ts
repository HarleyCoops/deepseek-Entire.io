/** Types shared by the Entire bridge's marker, sidecar, and hook pipeline. @module @deepseek-ai/dsh-entire-bridge/types */

/** The only clone-local marker document accepted by this bridge version. */
export interface EntireMarkerDocument {
  readonly schemaVersion: 1
  readonly agent: 'dsh'
}

/** Canonical repository and marker paths for one active clone. */
export interface ActiveEntireMarker extends EntireMarkerDocument {
  readonly repositoryRoot: string
  readonly markerPath: string
}

/** Entire external-agent lifecycle hooks emitted by the Harness bridge. */
export type EntireHookName =
  | 'session-start'
  | 'turn-start'
  | 'turn-end'
  | 'compaction'
  | 'session-end'
  | 'subagent-start'
  | 'subagent-end'

/** Versioned JSON object written once to an Entire hook's stdin. */
export type EntireHookPayload = Readonly<{
  schema_version: 1
  agent: 'dsh'
  hook_type: EntireHookName
  session_id: string
  /** RFC 3339 lifecycle time. */
  timestamp: string
  /** Canonical path to the normalized JSONL transcript consumed by Entire. */
  session_ref: string
} & Record<string, unknown>>
