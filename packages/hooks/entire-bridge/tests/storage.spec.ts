import { mkdtemp, mkdir, readFile, stat, symlink, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { EntireSidecarStorage, sidecarPaths } from '../src/storage.ts'

const roots: string[] = []

async function rootsForTest(): Promise<{ repositoryRoot: string; tempRoot: string }> {
  const repositoryRoot = await mkdtemp(join(tmpdir(), 'dsh-entire-storage-repo-'))
  const tempRoot = await mkdtemp(join(tmpdir(), 'dsh-entire-storage-temp-'))
  roots.push(repositoryRoot, tempRoot)
  await mkdir(join(repositoryRoot, '.entire'), { recursive: true })
  return { repositoryRoot, tempRoot }
}

afterEach(async () => {
  const { rm } = await import('node:fs/promises')
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('EntireSidecarStorage', () => {
  it('derives stable isolated paths and rejects separator or traversal session ids', async () => {
    const { repositoryRoot, tempRoot } = await rootsForTest()
    const first = sidecarPaths(repositoryRoot, 'session-1', tempRoot)
    const second = sidecarPaths(repositoryRoot, 'session-2', tempRoot)

    expect(sidecarPaths(repositoryRoot, 'session-1', tempRoot)).toEqual(first)
    expect(first.sidecarPath).not.toBe(second.sidecarPath)
    expect(first.sidecarPath).toMatch(/[\\/]entire-dsh[\\/][a-f0-9]{64}[\\/]sessions[\\/]session-1\.jsonl$/)
    for (const id of ['../escape', '..\\escape', 'a/b', 'a\\b', '', '.']) {
      expect(() => sidecarPaths(repositoryRoot, id, tempRoot)).toThrow(/session id/)
    }
  })

  it('matches the adapter repository hash normalization for a Windows path vector', () => {
    const canonical = 'C:\\Repo\\Harness'
    const expected = createHash('sha256').update('c:/repo/harness').digest('hex')
    expect(sidecarPaths(canonical, 'session-1', 'C:\\Temp', 'win32').sidecarPath).toContain(expected)
    const uncExpected = createHash('sha256').update('//server/share/repo').digest('hex')
    expect(sidecarPaths('\\\\Server\\Share\\Repo', 'session-1', 'C:\\Temp', 'win32').sidecarPath).toContain(uncExpected)
  })

  it('serializes appends, isolates sessions, and writes a body-free atomic reference', async () => {
    const { repositoryRoot, tempRoot } = await rootsForTest()
    const warnings: string[] = []
    const first = new EntireSidecarStorage({
      repositoryRoot,
      sessionId: 'session-1',
      createdAt: 10,
      tempRoot,
      warn: warning => warnings.push(warning),
    })
    const second = new EntireSidecarStorage({
      repositoryRoot,
      sessionId: 'session-2',
      createdAt: 20,
      parentSessionId: 'session-1',
      tempRoot,
      warn: warning => warnings.push(warning),
    })

    await Promise.all([
      first.append({ type: 'first', body: 'secret transcript body' }),
      first.append({ type: 'second', index: 2 }),
      second.append({ type: 'child', index: 1 }),
    ])

    expect((await readFile(first.paths.sidecarPath, 'utf8')).trim().split('\n').map(line => JSON.parse(line))).toEqual([
      { type: 'first', body: 'secret transcript body' },
      { type: 'second', index: 2 },
    ])
    expect((await readFile(second.paths.sidecarPath, 'utf8')).trim().split('\n').map(line => JSON.parse(line))).toEqual([
      { type: 'child', index: 1 },
    ])
    const referenceText = await readFile(first.paths.referencePath, 'utf8')
    expect(JSON.parse(referenceText)).toEqual({
      schema_version: 1,
      session_id: 'session-1',
      agent_name: 'dsh',
      repo_path: repositoryRoot,
      sidecar_ref: first.paths.sidecarPath,
      start_time: '1970-01-01T00:00:00.010Z',
      modified_files: [],
      new_files: [],
      deleted_files: [],
    })
    expect(referenceText).not.toContain('secret transcript body')
    expect((await stat(first.paths.sidecarPath)).isFile()).toBe(true)
    expect(warnings).toEqual([])
  })

  it('contains sidecar and reference directory symlink escapes', async () => {
    const { repositoryRoot, tempRoot } = await rootsForTest()
    const outside = await mkdtemp(join(tmpdir(), 'dsh-entire-storage-outside-'))
    roots.push(outside)
    const paths = sidecarPaths(repositoryRoot, 'escaped', tempRoot)
    await mkdir(join(paths.sidecarPath, '..', '..'), { recursive: true })
    try {
      await symlink(outside, join(paths.sidecarPath, '..'), 'junction')
      await symlink(outside, join(repositoryRoot, '.entire', 'tmp'), 'junction')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EPERM') return
      throw error
    }
    const warnings: string[] = []
    const storage = new EntireSidecarStorage({ repositoryRoot, sessionId: 'escaped', createdAt: 1, tempRoot, warn: value => warnings.push(value) })

    await storage.append({ kind: 'must-not-escape' })

    expect(warnings).toHaveLength(1)
    expect(await import('node:fs').then(fs => fs.existsSync(join(outside, 'escaped.jsonl')))).toBe(false)
    expect(await import('node:fs').then(fs => fs.existsSync(join(outside, 'dsh-escaped.json')))).toBe(false)
  })

  it('refuses an existing sidecar file symlink', async () => {
    const { repositoryRoot, tempRoot } = await rootsForTest()
    const outside = join(await mkdtemp(join(tmpdir(), 'dsh-entire-file-outside-')), 'outside.jsonl')
    roots.push(dirname(outside))
    await writeFile(outside, 'unchanged\n')
    const paths = sidecarPaths(repositoryRoot, 'linked', tempRoot)
    await mkdir(dirname(paths.sidecarPath), { recursive: true })
    try {
      await symlink(outside, paths.sidecarPath, 'file')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EPERM') return
      throw error
    }
    const warnings: string[] = []
    const storage = new EntireSidecarStorage({ repositoryRoot, sessionId: 'linked', createdAt: 1, tempRoot, warn: value => warnings.push(value) })

    const first = await storage.append({ kind: 'must-not-follow' })
    const second = await storage.append({ kind: 'must-not-retry' })

    expect([first, second]).toEqual([false, false])
    expect(warnings).toHaveLength(1)
    expect(await readFile(outside, 'utf8')).toBe('unchanged\n')
  })
})
