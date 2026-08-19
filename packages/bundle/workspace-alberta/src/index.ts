/**
 * @deepseek-ai/dsh-workspace-alberta — WorkspaceAlberta product-profile glue.
 * The bundle's substance is `cordis.patch.yml` (Cohere default, official MCP
 * client rows, DeepSeek adapter and OTLP telemetry disabled). This plugin only
 * rewrites the Web index `<title>` so DocumentTitle inherits the product name.
 *
 * @module @deepseek-ai/dsh-workspace-alberta
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-host-webserver'

/** Stable Cordis plugin name. */
export const name = 'workspace-alberta'

/** Services required before the index title can be rewritten. */
export const inject = ['webServer']

/** Shipped `apps/web/index.html` title this layer replaces. */
const DEEPSEEK_TITLE = '<title>DeepSeek Harness</title>'

/** Plugin config: the product name written into the index title. */
export interface Config {
  /** Browser document title; DocumentTitle appends session titles to this value. */
  productTitle: string
}

export const Config: z<Config> = z.object({
  productTitle: z.string().default('WorkspaceAlberta'),
})

/**
 * Escape text that will sit inside an HTML title element.
 * @param value - untrusted config text.
 * @returns HTML-safe text.
 */
function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

/**
 * Register the index-title transform for this product profile.
 * @param ctx - plugin context carrying `webServer`.
 * @param config - validated product-title config.
 */
export function apply(ctx: Context, config: Config): void {
  const replacement = `<title>${escapeHtml(config.productTitle)}</title>`
  ctx.effect(() => ctx.webServer.tapIndex(html => html.replace(DEEPSEEK_TITLE, replacement)))
}
