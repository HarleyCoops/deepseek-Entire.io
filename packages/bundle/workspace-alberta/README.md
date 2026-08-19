# `@deepseek-ai/dsh-workspace-alberta`

English | [中文](README.zh.md)

The WorkspaceAlberta product profile bundle for official `dsh`. [`cordis.patch.yml`](cordis.patch.yml) rides over [`dsh-base`](../base/README.md) and [`dsh-web-app`](../web-app/README.md): it selects Cohere Command A+ (`command-a-plus-05-2026`) through [`dsh-llm-pi-ai`](../../llm/llm-pi-ai/README.md), inserts two [`dsh-mcp-client`](../../mcp/mcp-client/README.md) streamable-http rows, disables the DeepSeek adapter and the DeepSeek OTLP telemetry row, replaces the web persona, and mounts this package's title-glue plugin (config `{productTitle}`). It is not an Electron desktop and does not add a second runtime.

First `dsh --profile workspace-alberta` auto-initializes `$DSH_HOME/profiles/workspace-alberta/` from the shipped template (`dsh-base`, `dsh-web-app`, this bundle). Copyable composition files:

| File | Role |
|---|---|
| [`cordis.patch.yml`](cordis.patch.yml) | This layer's patch list (source of truth in the checkout) |
| `$DSH_HOME/profiles/workspace-alberta/package.json` | Profile manifest; `dsh.profile.bundles` lists the three in-box packages |
| `$DSH_HOME/profiles/workspace-alberta/cordis.patch.yml` | Empty user overlay written on first use |

The live Pi already runs official `dsh` from `~/.dsh`. Point that install at this fork (or copy the in-box bundle into that installation) so `@deepseek-ai/dsh-workspace-alberta` resolves; then the same launcher command works. Raspberry Pi hardware, Desktop Electron, gbrain, and the j-space skill are out of scope.

## Run

From this checkout, after `pnpm install` and `pnpm run build`, the same official launcher as `web`:

```sh
pnpm dsh --profile workspace-alberta
pnpm dsh --profile workspace-alberta --dump-default-config
```

`--host` / `--port` / `--trusted-host` belong to [`dsh-web-app`](../web-app/README.md), as with `dsh --profile web`.

| Variable | Role |
|---|---|
| `COHERE_API_KEY` | Credential reference for the Cohere Compatibility API (`https://api.cohere.ai/compatibility/v1`). Put it in the inherited environment, `$DSH_HOME/.credentials.yaml`, or `.env`. Do not commit it. |
| `WORKSPACE_ALBERTA_MCP_URL` | Optional override of the default CanadaBuys MCP URL `https://elbowsupknivesout.warreandvavasour.com/mcp`. Local fallback from [HarleyCoops/WorkspaceAlberta](https://github.com/HarleyCoops/WorkspaceAlberta): run `python mcp-servers/canadabuys/server.py` and point this variable at that process. No invented CanadaBuys credentials. |
| `COMPOSIO_API_KEY` | Enables the Composio MCP row (documented Connect header `x-consumer-api-key` / session header `x-api-key`). |
| `COMPOSIO_MCP_URL` | Optional override of the documented Connect URL `https://connect.composio.dev/mcp` (dashboard or `session.mcp.url`). |

The Composio row stays disabled until `COMPOSIO_API_KEY` or `COMPOSIO_MCP_URL` is set. OAuth for Composio tools is Composio's own Connect / session flow; this bundle only mounts the official MCP client.

`session-telemetry-otel` is disabled in this layer, so this profile does not export to `harness-telemetry.deepseeksvc.com` even when `DSH_TELEMETRY_MODE` is set. This repository has no `dshdesktop.cn` or Electron desktop update URLs.

The glue plugin requires `webServer` (always present because the template includes `dsh-web-app`) and replaces `<title>DeepSeek Harness</title>` with `{productTitle}` (default `WorkspaceAlberta`) so the shared `DocumentTitle` inherits it. MIT and upstream DeepSeek Harness notices in the source tree stay.

## Model Experience

None, as the glue plugin only rewrites the browser index title; persona, MCP tools, and the Cohere adapter belong to the composed system-prompt, mcp-client, and llm-pi-ai rows.

#### KV Cache effect

None; the title transform never enters a model request.

## Known Limitations and Deferred Work

- **Index title only** — the shared PWA manifest and other Web chrome still say DeepSeek Harness; this layer rewrites the index `<title>` so DocumentTitle inherits WorkspaceAlberta.
- **MCP initialize timeout** — a down CanadaBuys or Composio server still waits for the MCP SDK's initialize timeout even with `failOnStartupError: false`, then activates with no tools from that server.
