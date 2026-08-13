/** Serialized local sidecar storage and clone-local transcript references. @module @deepseek-ai/dsh-entire-bridge/storage */

import { createHash, randomUUID } from 'node:crypto'
import { appendFile, lstat, mkdir, realpath, rename, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative } from 'node:path'

const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/

function contained(root: string, candidate: string): boolean {
  const path = relative(root, candidate)
  return path !== '' && path !== '..' && !path.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) && !isAbsolute(path)
}

async function refuseSymlink(path: string): Promise<void> {
  try {
    if ((await lstat(path)).isSymbolicLink()) throw new Error('entire-bridge: sidecar path is a symbolic link')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}

/** Files owned by one repository/session sidecar writer. */
export interface EntireSidecarPaths {
  readonly sidecarPath: string
  readonly referencePath: string
}

/** Construction facts for one serial sidecar writer. */
export interface EntireSidecarStorageOptions {
  readonly repositoryRoot: string
  readonly sessionId: string
  readonly createdAt: number
  readonly parentSessionId?: string
  readonly tempRoot: string
  readonly warn: (message: string) => void
}

/**
 * Derive stable repository-hashed paths without allowing a session id to add path segments.
 * @param repositoryRoot - canonical repository root.
 * @param sessionId - bounded opaque session id used as one filename component.
 * @param tempRoot - operating-system temporary root.
 * @returns the sidecar and clone-local reference paths.
 */
export function sidecarPaths(
  repositoryRoot: string,
  sessionId: string,
  tempRoot: string,
  platform: NodeJS.Platform = process.platform,
): EntireSidecarPaths {
  if (!SESSION_ID.test(sessionId) || sessionId === '.' || sessionId === '..') {
    throw new Error('entire-bridge: session id is not a safe filename component')
  }
  const slashRoot = repositoryRoot.replaceAll('\\', '/')
  const hashInput = platform === 'win32' ? slashRoot.toLowerCase() : slashRoot
  const repositoryHash = createHash('sha256').update(hashInput).digest('hex')
  return {
    sidecarPath: join(tempRoot, 'entire-dsh', repositoryHash, 'sessions', `${sessionId}.jsonl`),
    referencePath: join(repositoryRoot, '.entire', 'tmp', `dsh-${sessionId}.json`),
  }
}

/** Per-session append queue that contains I/O failures and drains on disposal. */
export class EntireSidecarStorage {
  /** Stable output paths for hook payloads and tests. */
  readonly paths: EntireSidecarPaths
  private queue: Promise<void> = Promise.resolve()
  private initialized = false

  constructor(private readonly options: EntireSidecarStorageOptions) {
    this.paths = sidecarPaths(options.repositoryRoot, options.sessionId, options.tempRoot)
  }

  /**
   * Queue one normalized JSON record in call order.
   * @param record - bounded record produced by the transcript normalizer.
   */
  append(record: object): Promise<void> {
    this.queue = this.queue.then(async () => {
      await this.initialize()
      await refuseSymlink(this.paths.sidecarPath)
      await appendFile(this.paths.sidecarPath, `${JSON.stringify(record)}\n`, { encoding: 'utf8', mode: 0o600 })
    }).catch((error: unknown) => {
      this.options.warn(`entire-bridge: sidecar append failed: ${String(error)}`)
    })
    return this.queue
  }

  /**
   * Wait for all records queued before this call to settle.
   * @returns a promise that resolves after the append queue is quiescent.
   */
  drain(): Promise<void> {
    return this.queue
  }

  private async initialize(): Promise<void> {
    if (this.initialized) return
    const sidecarDirectory = dirname(this.paths.sidecarPath)
    const referenceDirectory = dirname(this.paths.referencePath)
    await mkdir(sidecarDirectory, { recursive: true, mode: 0o700 })
    await mkdir(referenceDirectory, { recursive: true, mode: 0o700 })
    const [canonicalTempRoot, canonicalSidecarDirectory, canonicalRepositoryRoot, canonicalReferenceDirectory] = await Promise.all([
      realpath(this.options.tempRoot),
      realpath(sidecarDirectory),
      realpath(this.options.repositoryRoot),
      realpath(referenceDirectory),
    ])
    if (!contained(canonicalTempRoot, canonicalSidecarDirectory) || !contained(canonicalRepositoryRoot, canonicalReferenceDirectory)) {
      throw new Error('entire-bridge: storage directory escapes its expected root')
    }
    const reference = {
      schema_version: 1,
      session_id: this.options.sessionId,
      agent_name: 'dsh',
      repo_path: this.options.repositoryRoot,
      sidecar_ref: this.paths.sidecarPath,
      start_time: new Date(this.options.createdAt).toISOString(),
      modified_files: [],
      new_files: [],
      deleted_files: [],
    }
    const temporary = `${this.paths.referencePath}.${randomUUID()}.tmp`
    await writeFile(temporary, `${JSON.stringify(reference)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    await rename(temporary, this.paths.referencePath)
    this.initialized = true
  }
}
