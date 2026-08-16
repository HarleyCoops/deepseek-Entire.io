# Agent Note: Beautiful UI 作为对话展示的视觉与交互参考

Status: implemented

[English](2026-08-16-beautiful-ui-visual-reference.md) | 中文

## 问题

更改 Web 对话展示、或已挂载的 TUI 对话前端的 agent（智能体）与贡献者，没有一份已记录的视觉与交互目录，可用于思考行、工具卡片、审批与 ask-user 提示、流式文本和提示词输入栏。WorkspaceAlberta（`HarleyCoops/workspaceAlbertaSetup`）是姊妹 harness，需要同一份目录，使两个界面保持对齐。

## 决策

[Beautiful UI](https://www.beautifului.dev/) 是更改这些元素时的视觉与交互参考。它是一份 AI 原生基元目录——思考轨迹、流式文本、审批卡片、工具芯片、任务行、提示词栏、对话和上下文卡片——而不是一个可安装的库。

不要把 Beautiful UI 以源码形式收录进 vendor，不要添加 `beautifului` NPM 依赖，也不要把该目录当作可复制进 `packages/` 的代码。实现仍留在既有客户端栈中：[docs/web-styling.md](../../../../docs/web-styling.md) 拥有 token 与 CSS Modules；[Web 样式系统](2026-07-19-web-styling-system.md) 仍然禁止组件库。

WorkspaceAlberta 使用同一份参考。Web 是已交付的交互界面；已挂载的 TUI profile 使用同一份目录。

根 `AGENTS.md` 承载一至三行的常驻规则。`packages/client/AGENTS.md` 为 Web 客户端栈链接本 Agent Note。

## 考虑过的替代方案

**把该目录列在根 `AGENTS.md` 中。** 不予采纳：常驻规则是链接其归属文档的一至三行。资源清单不属于根文件。

**把 Beautiful UI 以源码形式收录，或把它加为 NPM 依赖。** 不予采纳：该目录是视觉与交互参考。安装它会让展示变成第三方实现，并违反客户端栈禁止组件库的规则。

**在同一次更改中把 Web 重绘成与该目录一致。** 不予采纳：记录参考是文档决策。重绘是单独的产品更改，并不因把该目录采纳为参考而被隐含。

**让每个 harness 各自拥有视觉目录。** 不予采纳：DeepSeek Harness 与 WorkspaceAlberta 对齐，正是共享一份目录的原因。

**把归属文档放在 [docs/web-styling.md](../../../../docs/web-styling.md)。** 不予采纳：该页拥有 token 与 CSS Module 规则，而不是跨界面的基元目录。

## 后果

对 Web 或 TUI 对话展示的更改查阅 Beautiful UI 以获取基元意图，并把实现留在既有客户端栈中。本决策不增加产品代码、NPM 依赖或重绘。[Web 样式系统](2026-07-19-web-styling-system.md) 仍是 token 与 CSS Module 的权威。

## 验证

`pnpm run doc-sync` 检查 Agent Note 格式、Markdown 链接、译文配对和根 `AGENTS.md` 字数上限。`packages/` 行为没有变化，因此不适用产品测试。
