/** Package-owned invariant companion for the best-effort Entire bridge. @module @deepseek-ai/dsh-entire-bridge/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-entire-bridge'

/** Cordis companion plugin name. */
export const name = 'entire-bridge-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this bridge derives diagnostic external files from the
 * canonical session stream, and its failures must never invalidate agent work.
 */
const install: InvariantInstaller = () => {}

/** Register this package's invariant ownership. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
