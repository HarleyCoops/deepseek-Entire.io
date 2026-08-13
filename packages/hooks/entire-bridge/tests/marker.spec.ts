import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readEntireMarker } from '../src/marker.ts'

const roots: string[] = []

async function repository(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-entire-marker-'))
  roots.push(root)
  await mkdir(join(root, '.entire'), { recursive: true })
  return root
}

afterEach(async () => {
  const { rm } = await import('node:fs/promises')
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('readEntireMarker', () => {
  it('activates only the exact version-1 dsh marker in the session cwd', async () => {
    const root = await repository()
    const markerPath = join(root, '.entire', 'dsh-hooks.json')

    await expect(readEntireMarker(root)).resolves.toBeUndefined()
    for (const document of [
      '{',
      '{"schemaVersion":2,"agent":"dsh"}',
      '{"schemaVersion":1,"agent":"other"}',
      '{"schemaVersion":1,"agent":"dsh","extra":true}',
    ]) {
      await writeFile(markerPath, document)
      await expect(readEntireMarker(root)).resolves.toBeUndefined()
    }

    await writeFile(markerPath, '{"schemaVersion":1,"agent":"dsh"}')
    await expect(readEntireMarker(root)).resolves.toEqual({
      schemaVersion: 1,
      agent: 'dsh',
      repositoryRoot: await import('node:fs/promises').then(fs => fs.realpath(root)),
      markerPath: await import('node:fs/promises').then(fs => fs.realpath(markerPath)),
    })
  })

  it('rejects marker resolution outside the canonical repository root', async () => {
    const root = await repository()
    const outside = await repository()
    const outsideMarker = join(outside, 'dsh-hooks.json')
    await writeFile(outsideMarker, '{"schemaVersion":1,"agent":"dsh"}')
    await import('node:fs/promises').then(fs => fs.rm(join(root, '.entire'), { recursive: true }))

    try {
      await symlink(outside, join(root, '.entire'), 'junction')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EPERM') return
      throw error
    }

    await expect(readEntireMarker(root)).resolves.toBeUndefined()
  })
})
