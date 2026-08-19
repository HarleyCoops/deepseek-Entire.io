# `@deepseek-ai/dsh-workspace-alberta`

[English](README.md) | 中文

官方 `dsh` 的 WorkspaceAlberta 产品 profile 组合包。[`cordis.patch.yml`](cordis.patch.yml) 叠加在 [`dsh-base`](../base/README.md) 与 [`dsh-web-app`](../web-app/README.md) 之上：通过 [`dsh-llm-pi-ai`](../../llm/llm-pi-ai/README.md) 选择 Cohere Command A+（`command-a-plus-05-2026`），插入两条 [`dsh-mcp-client`](../../mcp/mcp-client/README.md) streamable-http 配置行，禁用 DeepSeek 适配器与 DeepSeek OTLP 遥测行，替换 web persona，并挂载本包的标题粘合插件（配置为 `{productTitle}`）。它不是 Electron 桌面应用，也不引入第二套运行时。

首次运行 `dsh --profile workspace-alberta` 时，会从随附模板自动初始化 `$DSH_HOME/profiles/workspace-alberta/`（`dsh-base`、`dsh-web-app`、本组合包）。可复制进 dsh 配置的组合文件：

| 文件 | 职责 |
|---|---|
| [`cordis.patch.yml`](cordis.patch.yml) | 本层的 patch 列表（checkout 中的权威来源） |
| `$DSH_HOME/profiles/workspace-alberta/package.json` | Profile manifest（元数据清单）；`dsh.profile.bundles` 列出这三个内置包 |
| `$DSH_HOME/profiles/workspace-alberta/cordis.patch.yml` | 首次使用时写入的空用户覆盖层 |

现场 Pi 已经从 `~/.dsh` 运行官方 `dsh`。把该安装指向本 fork（或把内置组合包复制进该安装），使 `@deepseek-ai/dsh-workspace-alberta` 能够解析；之后使用同一条启动器命令即可。Raspberry Pi 硬件、Desktop Electron、gbrain 与 j-space skill（技能）均不在本包范围内。

## 运行

在本 checkout 中，完成 `pnpm install` 与 `pnpm run build` 后，启动方式与 `web` 相同，仍是官方启动器：

```sh
pnpm dsh --profile workspace-alberta
pnpm dsh --profile workspace-alberta --dump-default-config
```

`--host` / `--port` / `--trusted-host` 属于 [`dsh-web-app`](../web-app/README.md)，与 `dsh --profile web` 相同。

| 变量 | 职责 |
|---|---|
| `COHERE_API_KEY` | Cohere Compatibility API（`https://api.cohere.ai/compatibility/v1`）的凭据引用。放入继承环境、`$DSH_HOME/.credentials.yaml` 或 `.env`。不要提交该值。 |
| `WORKSPACE_ALBERTA_MCP_URL` | 可选，覆盖默认 CanadaBuys MCP URL `https://elbowsupknivesout.warreandvavasour.com/mcp`。本地回退来自 [HarleyCoops/WorkspaceAlberta](https://github.com/HarleyCoops/WorkspaceAlberta)：运行 `python mcp-servers/canadabuys/server.py`，并将本变量指向该进程。不捏造 CanadaBuys 凭据。 |
| `COMPOSIO_API_KEY` | 启用 Composio MCP 行（文档中的 Connect 头 `x-consumer-api-key` / session 头 `x-api-key`）。 |
| `COMPOSIO_MCP_URL` | 可选，覆盖文档中的 Connect URL `https://connect.composio.dev/mcp`（控制台或 `session.mcp.url`）。 |

在设置 `COMPOSIO_API_KEY` 或 `COMPOSIO_MCP_URL` 之前，Composio 行保持禁用。Composio 工具的 OAuth 由 Composio 自己的 Connect / session 流程完成；本组合包只挂载官方 MCP 客户端。

本层禁用 `session-telemetry-otel`，因此即使设置了 `DSH_TELEMETRY_MODE`，本 profile 也不会向 `harness-telemetry.deepseeksvc.com` 导出。本仓库没有 `dshdesktop.cn` 或 Electron 桌面更新 URL。

粘合插件需要 `webServer`（模板包含 `dsh-web-app`，因此始终存在），并把 `<title>DeepSeek Harness</title>` 替换为 `{productTitle}`（默认 `WorkspaceAlberta`），使共享的 `DocumentTitle` 继承该标题。源码树中的 MIT 与上游 DeepSeek Harness 声明保持不变。

## 模型体验

无影响，因为粘合插件只改写浏览器 index 的标题；persona、MCP 工具与 Cohere 适配器分别由组合后的 system-prompt、mcp-client 与 llm-pi-ai 配置行提供。

#### KV Cache 影响

无；标题转换不会进入模型请求。

## 已知限制与暂缓事项

- **只改 index 标题**：共享的 PWA manifest（元数据清单）与其他 Web chrome 仍写 DeepSeek Harness；本层改写 index 的 `<title>`，使 DocumentTitle 继承 WorkspaceAlberta。
- **MCP initialize 超时**：即使 `failOnStartupError: false`，不可达的 CanadaBuys 或 Composio 服务器仍会等待 MCP SDK 的 initialize 超时，然后以该服务器无工具的状态激活。
