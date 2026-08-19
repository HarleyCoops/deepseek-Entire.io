# Agent Note: 在官方 DSH 上的 WorkspaceAlberta 产品 profile

Status: implemented

[English](2026-08-19-workspace-alberta-product-profile.md) | 中文

## 问题

Warre & Vavasour 的 WorkspaceAlberta 盒子需要在 Pi 上使用官方 DeepSeek Harness：随附的插件系统、Web UI 与 [`dsh-mcp-client`](../../../../packages/mcp/mcp-client/README.md)，并以 CanadaBuys MCP、Composio 与 Cohere Command A+ 作为产品默认。现场机器已经从 `~/.dsh` 运行官方 `dsh`。第二套运行时、玩具 MCP 客户端，或纳入 `anywhere-labs/deepseek-harness-desktop`，都与该安装不符，也无法在 Pi 上运行。

## 决策

本 clone 随附内置 profile 模板 `workspace-alberta`，其组合包元组为 `@deepseek-ai/dsh-base`、`@deepseek-ai/dsh-web-app`、`@deepseek-ai/dsh-workspace-alberta`。首次运行 `dsh --profile workspace-alberta` 时，会像 `web` 与 `headless` 一样自动写入 `$DSH_HOME/profiles/workspace-alberta/`。新组合包的 [`cordis.patch.yml`](../../../../packages/bundle/workspace-alberta/cordis.patch.yml) 是组合的权威来源。

该 patch 通过 `dsh-llm-pi-ai` 选择 Cohere Command A+（`command-a-plus-05-2026`）及文档中的 Compatibility API，凭据引用为 `COHERE_API_KEY`；禁用 `llm-deepseek` 与 `session-telemetry-otel`；并插入两条官方 `dsh-mcp-client` streamable-http 配置行：`workspacealberta` 默认指向 `https://elbowsupknivesout.warreandvavasour.com/mcp`（可用 `WORKSPACE_ALBERTA_MCP_URL` 覆盖；本地回退是 HarleyCoops/WorkspaceAlberta 的 `python mcp-servers/canadabuys/server.py`），以及在设置 `COMPOSIO_API_KEY` 或 `COMPOSIO_MCP_URL` 之前保持禁用的 `composio`（默认文档中的 Composio Connect `https://connect.composio.dev/mcp`）。不提交任何 API key。粘合插件把 Web index 的 `<title>` 改写为 `WorkspaceAlberta`。MIT 与上游 DeepSeek Harness 声明保持不变。j-space、Raspberry Pi 硬件、Desktop Electron 与 gbrain 均未改动。

## 考虑过的替代

**纳入 `anywhere-labs/deepseek-harness-desktop`。** 否决：该 Electron 应用无法在 Pi 上运行，且产品要求只用原版 DSH。

**用更薄的 MCP／聊天客户端替换 harness。** 否决：Pi 已经运行官方 `dsh`；玩具客户端会丢掉插件系统、Web UI 与官方 MCP 客户端。

**改随附的 `web` / `headless` 默认值。** 否决：那些模板仍是上游 DSH；WorkspaceAlberta 是第三个自动初始化 profile。

**内联 CanadaBuys 或 Composio 凭据。** 否决：密钥只存在于环境变量 / `$DSH_HOME/.credentials.yaml` / `.env`。

**重新设计 j-space skill（技能），或把 gbrain 放到 Pi 上。** 否决：二者都不在本 profile 范围内。

## 后果

运行路径是 `pnpm dsh --profile workspace-alberta`。`~/.dsh` 安装必须是本 fork，内置组合包才能解析。共享 Web snapshot 仍属于 `web`；本 profile 不增加 Electron 更新探测（本 harness 中本来就没有），即使设置了 `DSH_TELEMETRY_MODE` 也会关闭 DeepSeek OTLP。

## 测试

包测试解析随附 patch（托管 MCP URL、Cohere 默认、遥测／llm-deepseek 禁用、Composio 环境门控），并覆盖标题粘合的 HMR dispose 与不变式 companion。`apps/cli/tests/built-bin.e2e.ts` dump 构建后的 `dsh --profile workspace-alberta --dump-default-config` 配置树。没有为改写后的标题或 persona 新增 Web 浏览器 snapshot；dump-config 钉住组合，共享 UI snapshot 仍属于 `web`。
