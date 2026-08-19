/**
 * WorkspaceAlberta bundle: parseable product patch plus index-title glue.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader, { evaluate } from '@deepseek-ai/cordis-plugin-loader'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import type { WebServer } from '@deepseek-ai/dsh-host-webserver'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as yaml from 'js-yaml'
import * as WorkspaceAlberta from '../src/index.ts'
import { apply, Config } from '../src/index.ts'
import * as WorkspaceAlbertaInvariant from '../src/invariant.ts'

const root = fileURLToPath(new URL('..', import.meta.url))

/** Parse the shipped patch list through the include schema. */
function loadPatch(): Record<string, unknown>[] {
  const parsed = yaml.load(
    readFileSync(resolve(root, 'cordis.patch.yml'), 'utf8'),
    { schema: entryListSchema },
  )
  if (!Array.isArray(parsed)) throw new TypeError('workspace-alberta patch must parse to a patch list')
  return parsed as Record<string, unknown>[]
}

/** Locate one insert row by id. */
function insertRow(patches: Record<string, unknown>[], id: string): Record<string, unknown> {
  for (const patch of patches) {
    const rows = patch.insert
    if (!Array.isArray(rows)) continue
    const row = rows.find((candidate): candidate is Record<string, unknown> =>
      typeof candidate === 'object' && candidate !== null && candidate.id === id)
    if (row !== undefined) return row
  }
  throw new Error(`workspace-alberta patch must insert ${id}`)
}

/** Fake webServer capturing index taps for HMR-safety assertions. */
function fakeWebServer(): { server: WebServer; taps: Array<(html: string) => string> } {
  const taps: Array<(html: string) => string> = []
  const server = {
    tapIndex: (transform: (html: string) => string) => {
      taps.push(transform)
      return () => {
        const at = taps.indexOf(transform)
        if (at !== -1) taps.splice(at, 1)
      }
    },
  } as unknown as WebServer
  return { server, taps }
}

describe('dsh-workspace-alberta bundle patch', () => {
  it('declares a parseable patch list through the dsh.bundle.patch manifest field', () => {
    const manifest = JSON.parse(
      readFileSync(resolve(root, 'package.json'), 'utf8'),
    ) as {
      dependencies?: Record<string, string>
      dsh?: { bundle?: { patch?: string } }
    }
    expect(manifest.dsh?.bundle?.patch).toBe('./cordis.patch.yml')
    expect(manifest.dependencies).toHaveProperty('@deepseek-ai/dsh-mcp-client', 'workspace:^')
    const patches = loadPatch()
    expect(patches.some(patch => patch.id === 'agent-default-model')).toBe(true)
  })

  it('defaults Cohere Command A+ and disables DeepSeek plus OTLP telemetry', () => {
    const patches = loadPatch()
    const defaultModel = patches.find(patch => patch.id === 'agent-default-model')
    expect(defaultModel?.config).toEqual({
      provider: 'cohere',
      model: 'command-a-plus-05-2026',
    })
    const piAi = patches.find(patch => patch.id === 'llm-pi-ai') as {
      config?: { providers?: { cohere?: Record<string, unknown> } }
    }
    expect(piAi.config?.providers?.cohere).toMatchObject({
      displayName: 'Cohere',
      apiKeyEnv: 'COHERE_API_KEY',
      api: 'openai-completions',
      baseURL: 'https://api.cohere.ai/compatibility/v1',
    })
    expect(patches.find(patch => patch.id === 'llm-deepseek')?.disabled).toBe(true)
    expect(patches.find(patch => patch.id === 'session-telemetry-otel')?.disabled).toBe(true)
    const prompt = patches.find(patch => patch.id === 'system-prompt') as {
      config?: { includeHarnessIdentity?: boolean; persona?: string }
    }
    expect(prompt.config?.includeHarnessIdentity).toBe(false)
    expect(prompt.config?.persona).toContain('WorkspaceAlberta')
    expect(prompt.config?.persona).toContain('official DeepSeek Harness')
  })

  it('pins the hosted WorkspaceAlberta MCP URL and gates Composio on env', () => {
    const patches = loadPatch()
    const canada = insertRow(patches, 'mcp-workspace-alberta')
    expect(canada).toMatchObject({
      name: '@deepseek-ai/dsh-mcp-client',
      config: {
        serverName: 'workspacealberta',
        transport: 'streamable-http',
        failOnStartupError: false,
      },
    })
    expect((canada.config as { url?: { __jsExpr?: string } }).url?.__jsExpr)
      .toBe("process.env.WORKSPACE_ALBERTA_MCP_URL ?? 'https://elbowsupknivesout.warreandvavasour.com/mcp'")

    const composio = insertRow(patches, 'mcp-composio')
    const disabled = (composio.disabled as { __jsExpr?: string } | undefined)?.__jsExpr
    if (disabled === undefined) throw new Error('mcp-composio must gate on a !!js disabled expression')
    expect(Boolean(evaluate({ process: { env: {} } }, disabled))).toBe(true)
    expect(Boolean(evaluate({ process: { env: { COMPOSIO_API_KEY: 'from-env' } } }, disabled))).toBe(false)
    expect(Boolean(evaluate({ process: { env: { COMPOSIO_MCP_URL: 'https://example.test/mcp' } } }, disabled))).toBe(false)
    expect((composio.config as { url?: { __jsExpr?: string } }).url?.__jsExpr)
      .toBe("process.env.COMPOSIO_MCP_URL || 'https://connect.composio.dev/mcp'")
  })
})

describe('workspace-alberta title glue', () => {
  it('has no default export and keeps name/inject/Config through unwrapExports', () => {
    expect('default' in WorkspaceAlberta).toBe(false)
    const loader = Object.create(Loader.prototype) as Loader
    const unwrapped = loader.unwrapExports(WorkspaceAlberta) as Record<string, unknown>
    expect(unwrapped).toBe(WorkspaceAlberta)
    expect(unwrapped.name).toBe('workspace-alberta')
    expect(unwrapped.inject).toEqual(['webServer'])
    expect(typeof unwrapped.apply).toBe('function')
    expect(unwrapped.Config).toBeDefined()
  })

  it('defaults productTitle to WorkspaceAlberta', () => {
    expect(new Config({})).toEqual({ productTitle: 'WorkspaceAlberta' })
  })

  it('rewrites the DeepSeek index title and removes the tap on dispose', async () => {
    const ctx = new Context()
    const { server, taps } = fakeWebServer()
    ctx.provide('webServer', server)
    apply(ctx, new Config({ productTitle: 'WorkspaceAlberta' }))
    expect(taps).toHaveLength(1)
    expect(taps[0]?.('<html><title>DeepSeek Harness</title></html>'))
      .toBe('<html><title>WorkspaceAlberta</title></html>')
    await ctx.fiber.dispose()
    expect(taps).toHaveLength(0)
  })

  it('HTML-escapes a hostile productTitle and leaves a non-matching title alone', async () => {
    const ctx = new Context()
    const { server, taps } = fakeWebServer()
    ctx.provide('webServer', server)
    apply(ctx, new Config({ productTitle: 'A & B <x> "y"' }))
    expect(taps[0]?.('<title>DeepSeek Harness</title>')).toBe('<title>A &amp; B &lt;x&gt; &quot;y&quot;</title>')
    expect(taps[0]?.('<title>Other</title>')).toBe('<title>Other</title>')
    await ctx.fiber.dispose()
  })
})

describe('workspace-alberta invariant companion', () => {
  it('has no default export and registers the empty installer', async () => {
    expect('default' in WorkspaceAlbertaInvariant).toBe(false)
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    const fiber = ctx.plugin(WorkspaceAlbertaInvariant)
    await expect(fiber.await()).resolves.toBeDefined()
    await fiber.dispose()
    await expect(ctx.plugin(WorkspaceAlbertaInvariant).await()).resolves.toBeDefined()
    await ctx.fiber.dispose()
  })
})
