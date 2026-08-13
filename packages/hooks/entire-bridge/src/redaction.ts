/** Credential-key redaction for transcript copies. @module @deepseek-ai/dsh-entire-bridge/redaction */

const REDACTED = '[REDACTED]'
const CREDENTIAL_KEY = /^(?:api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|password|passwd|secret|client[_-]?secret|credential|private[_-]?key|cookie)$/i

/**
 * Clone JSON-like data while masking values held under obvious credential keys.
 * @param value - normalized transcript data before local persistence.
 * @returns a detached recursively redacted value.
 */
export function redactCredentialValues(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactCredentialValues)
  if (typeof value !== 'object' || value === null) return value
  const output: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) {
    output[key] = CREDENTIAL_KEY.test(key) ? REDACTED : redactCredentialValues(item)
  }
  return output
}
