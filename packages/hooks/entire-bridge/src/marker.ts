/** Clone-local Entire marker discovery and canonical path containment. @module @deepseek-ai/dsh-entire-bridge/marker */

import { open, realpath } from 'node:fs/promises'
import { isAbsolute, join, relative } from 'node:path'
import type { ActiveEntireMarker, EntireMarkerDocument } from './types.ts'

const MARKER_MAX_BYTES = 4096
const MARKER_SEGMENTS = ['.entire', 'dsh-hooks.json'] as const

function isContained(root: string, candidate: string): boolean {
  const path = relative(root, candidate)
  return path === MARKER_SEGMENTS.join(process.platform === 'win32' ? '\\' : '/')
    && !isAbsolute(path)
    && path !== '..'
    && !path.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)
}

function isMarkerDocument(value: unknown): value is EntireMarkerDocument {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return Object.keys(record).length === 2
    && record.schemaVersion === 1
    && record.agent === 'dsh'
}

/**
 * Read the exact clone-local Entire marker without searching parent or user directories.
 * @param cwd - absolute session working directory treated as the repository root.
 * @returns canonical activation facts, or `undefined` when the marker is absent or invalid.
 */
export async function readEntireMarker(cwd: string): Promise<ActiveEntireMarker | undefined> {
  try {
    if (!isAbsolute(cwd)) return undefined
    const repositoryRoot = await realpath(cwd)
    const markerCandidate = join(repositoryRoot, ...MARKER_SEGMENTS)
    const markerPath = await realpath(markerCandidate)
    if (!isContained(repositoryRoot, markerPath)) return undefined
    const file = await open(markerPath, 'r')
    try {
      const stat = await file.stat()
      if (!stat.isFile() || stat.size > MARKER_MAX_BYTES) return undefined
      const parsed: unknown = JSON.parse(await file.readFile('utf8'))
      if (!isMarkerDocument(parsed)) return undefined
      return { ...parsed, repositoryRoot, markerPath }
    } finally {
      await file.close()
    }
  } catch {
    return undefined
  }
}
