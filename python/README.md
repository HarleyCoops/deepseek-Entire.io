# DeepSeek Harness Python SDK

English | [中文](README.zh.md)

Python packages for driving DeepSeek Harness as a subprocess. The client SDK communicates with the bundled runtime over newline-delimited JSON-RPC on stdio.

## Packages

| Directory | Dist / module | Role |
|---|---|---|
| [sdk](sdk/README.md) | `deepseek-harness-sdk` / `deepseek_harness` | High-level turns API and lower-level JSON-RPC client |
| [sdk-runtime](sdk-runtime/README.md) | `deepseek-harness-runtime-bin` / `deepseek_harness_runtime` | Bundled runtime binaries and default agent configuration |

## Behavior

`RunResult.events` exposes every root-session tool lifecycle record as raw JSON objects in wire order; descendant tool records remain in `RunResult.notifications`, so Python callers can filter the same event names without a second trace stream.

The SDK starts the matching bundled runtime unless the caller selects an explicit channel. The client selects the channel and supplies default configuration; the runtime itself always requires an explicit configuration. The [SDK reference](sdk/README.md) and [runtime carrier reference](sdk-runtime/README.md) own the complete runtime-selection and configuration contracts.

## Contributor workflows

The [Python contributor workflows](development.md) cover building runtime artifacts, validating the packages, source-mode development, and distribution.
