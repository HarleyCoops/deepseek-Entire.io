# Agent Note: WorkspaceAlberta product profile on official DSH

Status: implemented

English | [中文](2026-08-19-workspace-alberta-product-profile.zh.md)

## Problem

The Warre & Vavasour WorkspaceAlberta box needs official DeepSeek Harness on the Pi: the shipped plugin system, Web UI, and [`dsh-mcp-client`](../../../../packages/mcp/mcp-client/README.md), with CanadaBuys MCP, Composio, and Cohere Command A+ as product defaults. The live machine already runs official `dsh` from `~/.dsh`. A second runtime, a toy MCP client, or vendoring `anywhere-labs/deepseek-harness-desktop` would not match that install and would not run on the Pi.

## Decision

This clone ships an in-box profile template `workspace-alberta` whose bundle tuple is `@deepseek-ai/dsh-base`, `@deepseek-ai/dsh-web-app`, `@deepseek-ai/dsh-workspace-alberta`. First `dsh --profile workspace-alberta` writes `$DSH_HOME/profiles/workspace-alberta/` the same way `web` and `headless` auto-initialize. The new bundle's [`cordis.patch.yml`](../../../../packages/bundle/workspace-alberta/cordis.patch.yml) is the composition source of truth.

That patch selects Cohere Command A+ (`command-a-plus-05-2026`) on the documented Compatibility API through `dsh-llm-pi-ai` with credential reference `COHERE_API_KEY`, disables `llm-deepseek` and `session-telemetry-otel`, and inserts two official `dsh-mcp-client` streamable-http rows: `workspacealberta` defaulting to `https://elbowsupknivesout.warreandvavasour.com/mcp` (`WORKSPACE_ALBERTA_MCP_URL` override; local fallback is HarleyCoops/WorkspaceAlberta `python mcp-servers/canadabuys/server.py`), and `composio` disabled until `COMPOSIO_API_KEY` or `COMPOSIO_MCP_URL` is set, defaulting to documented Composio Connect `https://connect.composio.dev/mcp`. No API keys are committed. The glue plugin rewrites the Web index `<title>` to `WorkspaceAlberta`. MIT and upstream DeepSeek Harness notices stay. j-space, Raspberry Pi hardware, Desktop Electron, and gbrain are unchanged.

## Alternatives considered

**Vendor `anywhere-labs/deepseek-harness-desktop`.** Rejected: that Electron app will not run on the Pi, and the product instruction is original DSH only.

**Replace the harness with a thinner MCP/chat client.** Rejected: the Pi already runs official `dsh`; a toy client would drop the plugin system, Web UI, and official MCP client.

**Change the shipped `web` / `headless` defaults.** Rejected: those templates remain upstream DSH; WorkspaceAlberta is a third auto-init profile.

**Inline CanadaBuys or Composio credentials.** Rejected: keys exist only in env / `$DSH_HOME/.credentials.yaml` / `.env`.

**Redesign the j-space skill or put gbrain on the Pi.** Rejected: both are out of this profile's scope.

## Consequences

`pnpm dsh --profile workspace-alberta` is the run path. A `~/.dsh` install must be this fork so the in-box bundle resolves. Shared Web snapshots stay on `web`; this profile does not add Electron update pings (none exist in this harness) and turns DeepSeek OTLP off even when `DSH_TELEMETRY_MODE` is set.

## Testing

Package tests parse the shipped patch (hosted MCP URL, Cohere default, telemetry/llm-deepseek disabled, Composio env gate) and cover title-glue HMR disposal plus the invariant companion. `apps/cli/tests/built-bin.e2e.ts` dumps the built `dsh --profile workspace-alberta --dump-default-config` tree. There is no new Web browser snapshot for the rewritten title or persona; dump-config pins composition, and shared UI snapshots remain on `web`.
