# @deepseek-ai/dsh-entire-bridge

English | [中文](README.zh.md)

A dormant Cordis bridge from committed Harness session events to Entire's `dsh` external-agent hooks. The base bundle always mounts it, but it performs no sidecar I/O and starts no process unless the session workspace contains the exact clone-local marker `.entire/dsh-hooks.json`:

```json
{"schemaVersion":1,"agent":"dsh"}
```

The marker is normally installed by the trusted `entire-agent-dsh` adapter. The bridge writes one normalized JSONL sidecar per session beneath the OS temporary directory, writes a body-free reference at `.entire/tmp/dsh-<session-id>.json`, and invokes `entire hooks dsh <hook>` with a fixed argument vector and one versioned JSON payload on stdin. The sidecar directory key is SHA-256 of the canonical repository path after converting separators to `/` and lowercasing the whole path on Windows. Writes are durable before the matching hook. Hook, process, and sidecar failures are diagnostic-only and do not fail Harness work.

## Config

```ts
import type { Config } from '@deepseek-ai/dsh-entire-bridge'

const config: Config = {
  strict: true,
  toolResultMaxBytes: 65_536,
  hookGraceMs: 1_000,
  hookOutputMaxBytes: 4_096,
}
```

`strict` omits tool inputs/results and reasoning-like assistant content. In every mode, assistant-message copies omit embedded tool-call blocks; the dedicated tool-call record carries parsed, recursively redacted arguments when not strict. The default transcript otherwise retains true user prompts, committed assistant messages, tool and nested Code Mode lifecycle/results, policy and approval facts, body timing, usage, compaction, and subagent lineage. It omits request headers, system prompts, schemas, environment data, opaque adapter state, internal injected messages, and raw assistant chunks. Obvious credential-key values are masked and complete tool-result records are byte-capped. `modified_files` contains conservative hints from known successful Harness mutation tools; Entire's Git diff remains authoritative for checkpoint contents.

## Security and storage

Sidecars and Harness session logs are sensitive local data; masking is best effort, not a secrecy guarantee. Never print transcript bodies from hook diagnostics. Entire's installed checkpoint backend is configuration-dependent (current CLI defaults may use refs), so this package makes no shadow-branch-name promise. For shared or public source repositories, select a separate private checkpoint remote and review checkpoint contents before the first push.

## Model Experience

### Entire export

#### What the model sees

Nothing. `@deepseek-ai/dsh-entire-bridge` observes committed events after model work and adds no prompt content or tools.

#### Token effect

None. Export and hooks consume no model tokens.

#### KV Cache effect

None. It does not alter the model request prefix.

## Known Limitations and Deferred Work

- Activation requires a separately installed trusted `entire-agent-dsh` executable and the exact clone-local marker; this package never installs executables or makes network requests.
- Missing or failing Entire commands are contained warnings, so checkpoint creation is not guaranteed by successful Harness work.
- Credential-key masking cannot identify secrets embedded in arbitrary prose or source content; use `strict` mode when inputs, results, or reasoning must stay out of the sidecar.
- Sidecars live under the OS temporary directory and follow that directory's retention policy; the clone-local reference contains only bounded metadata and a path.
