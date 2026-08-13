# 将 Harness 追踪导出到 Entire

[English](entire.md) | 中文

[Entire](https://github.com/entireio/cli) 检查点可以在 Harness 工作产生的 Git 变更旁保留一份可审查记录。该集成是可选的：没有 Entire 的精确克隆本地标记时，Harness 不进行伴随文件 I/O，也不启动 Entire 进程。

> 当前可用性：`entire-agent-dsh` 源码目前位于 `entireio/external-agents` 的 `codex/dsh-adapter` 分支，尚未发布为适配器。其协议和合规测试已经通过，但在 Harness bridge 合并且端到端检查点捕获通过之前，真实 Harness-to-Entire 生命周期仍未验证。完成验证后，只需更新这一段状态说明。

## 启用前准备

- 安装 Entire CLI 0.10，并确认 `entire version` 可以运行。
- 为每个 Harness 工作区克隆分别准备一个私有 GitHub 检查点仓库。不要将检查点指向源码仓库，也不要让多个克隆共用一个检查点仓库。
- 从你信任的源码或二进制获得 `entire-agent-dsh`。如果构建当前预览版本，请先审查 `entireio/external-agents` 的 `codex/dsh-adapter` 分支，再构建 `agents/entire-agent-dsh/cmd/entire-agent-dsh`，将生成的可执行文件放入 `PATH`，并在启用前运行 `entire-agent-dsh info`。
- 确保 Harness 进程的 `PATH` 中包含 `dsh`、`entire` 和 `entire-agent-dsh`。

该适配器是 Entire 会调用的可执行文件。应像安装其他本地开发工具一样对待它：审查其来源和权限，不要接受未经审查的克隆或二进制。

## 为一个克隆启用

先直接验证可信的适配器。全新克隆在设置启用该功能之前，`entire agent list` 不会发现外部 agent。

```sh
entire-agent-dsh info
```

然后选择检查点仓库应如何被发现。

若要通过 GitHub 将该克隆连接到 Entire.io，请写入项目设置：

```sh
entire enable --project --agent dsh --checkpoint-remote github:OWNER/PRIVATE_REPO
git add .entire/settings.json
git commit -m "chore: configure private Entire checkpoints"
git push
```

Entire.io 通过读取项目仓库已提交的 `HEAD:.entire/settings.json` 中的 `checkpoint_remote` 来发现独立检查点仓库。每位用户都应在自己的项目或 fork 中运行此命令，填写自己的私有检查点仓库，审查设置文件后再提交。本仓库不会预置任何检查点目标。

如果你只需要本地 CLI 检查和私有检查点推送，不需要 Entire.io 发现独立仓库，则可将设置保留在克隆本地：

```sh
entire enable --local --agent dsh --checkpoint-remote github:OWNER/PRIVATE_REPO
```

本地形式会写入 `.entire/settings.local.json`。检查点 refs 仍可推送，但 Entire.io 无法将其与项目配对，因为本地或未提交的设置不会通过 GitHub 可见。

选择外部 `dsh` agent 会启用 Entire 的 `external_agents` 发现。设置完成后，`entire agent list` 应包含 `dsh`。全新的 Entire 0.10 设置会选择按检查点存储的 `git-refs` 后端；不要假定某个检查点分支名称，也不要围绕它编写自动化。现有仓库会保留已配置的后端，除非你主动更改。

设置成功后会在 `.entire/dsh-hooks.json` 安装精确的自有标记：

```json
{"schemaVersion":1,"agent":"dsh"}
```

不要手动创建或编辑该标记。适配器会拒绝未知内容、符号链接和非普通标记文件，也不会接管其他工具的内容。

Entire 遥测与 Harness 遥测相互独立。若要在启用时退出，请添加 `--telemetry=false`；若要之后更改，请运行 `entire configure --telemetry=false`。

## 首次推送前检查

在该克隆中运行一个小型 Harness 任务并创建预期的本地 Git 提交，然后在推送任何内容前检查它：

```sh
entire status
entire checkpoint list
entire checkpoint explain <checkpoint-id>
git show --stat HEAD
```

确认检查点属于预期克隆、只包含预期 Git 变更与文本记录事实，并指向 `github:OWNER/PRIVATE_REPO`。若要与 Entire.io 配对，还要确认预期的 `.entire/settings.json` 已提交到即将推送的 `HEAD`。确认无误后，才运行常规 `git push`；Entire 会处理已配置的检查点 refs，无需检查点分支名称。

Entire 的 Git diff 才是变更文件的权威依据。Harness 只为展示提供保守的文件提示，不能替代对 diff 的审查。

## 捕获内容

Harness 只维护一份规范的、仅追加的 `SessionEvent` 日志。Entire bridge 将其中已提交的事实投影到规范化 JSONL 伴随文件：

- 真实用户提示词、已提交的 assistant 消息、规范化提供方用量、压缩以及会话/subagent 谱系；
- 根级 `tool/call` 和 `tool/result` 记录，以及嵌套 Code Mode 分派与结果；
- `tool/policy-result`（包括其有界结果/来源），以及请求审批时既有的 `approval/asked` / `approval/decided` 审计对；
- `tool/body-start` 和 `tool/body-end`（包括返回/抛出和中止状态），因此时间戳可以重建策略等待、主体时长与总时长。

默认投影会排除原始 assistant 分片、请求头、系统提示词、完整工具 schema、环境数据、凭据、不透明适配器状态和内部注入消息。明显的凭据键值会被掩码，每条完整工具结果记录也有字节上限，但掩码只是尽力而为：嵌在自然语言、源码、提示词或意外字段中的秘密仍可能保留。

伴随文件与 Harness 原生会话日志都是敏感本地数据。它们位于各自的本地存储根目录，遵循相应位置的保留策略，不能被当作秘密存储。请使用独立的私有检查点远端，并在首次推送前于本地检查。

### 严格捕获

如果提示词和普通已提交 assistant 文本可以保留，但工具输入/结果和类似推理的 assistant 内容必须排除，请在基础组合包的 `entire-bridge` Cordis 配置项上设置 `strict: true`。严格模式不会脱敏 Git diff、普通提示词或普通已提交 assistant 文本；仍需分别审查它们。

bridge 在模型工作之后观察已提交事件。它不添加提示词片段或工具，不消耗模型 token，也不能改变模型请求、审批、工具执行或结果。伴随文件和钩子失败只会产生警告，并不能证明检查点已经创建。

## 禁用或卸载

在同一个克隆中运行：

```sh
entire disable
```

这会禁用 Entire，但保留其本地设置。若要从克隆中移除所有 Entire 集成（包括自有 DSH 标记），请运行：

```sh
entire disable --uninstall
```

若只想移除 DSH 适配器集成并保留其他 Entire agent，请使用 `entire agent remove dsh`。卸载会拒绝不属于它的标记；遇到意外内容时，应检查 `.entire/dsh-hooks.json`，而不是自动删除。

## 排错

- **`entire agent list` 中没有 `dsh`**：在全新克隆中，先运行 `entire-agent-dsh info`，再运行启用命令；初始列表会在设置 `external_agents` 前有意跳过外部发现。若设置后仍缺失，请确认 `entire-agent-dsh` 与 Entire 使用相同的 `PATH`。
- **检查点 refs 已到达私有仓库，但 Entire.io 找不到它们**：请提交并推送包含预期 `checkpoint_remote` 的 `.entire/settings.json`；`.entire/settings.local.json` 和未提交的项目设置会有意对 Entire.io 不可见。
- **未出现标记**：请从预期 Git 克隆根目录运行启用命令。不要从其他克隆复制标记。
- **Harness 成功，但未出现检查点**：bridge 和钩子失败被有意限制为仅诊断。请检查 Harness 警告、`entire status`、可执行文件发现以及本地伴随文件/引用权限。
- **标记被拒绝**：适配器只接受精确匹配的自有普通文件。符号链接、目录、未知 JSON 字段、不同 agent 或不支持的 schema 版本都会快速失败。
- **检查点包含过多文本记录数据**：不要推送。启用严格捕获，开始新会话，检查新的本地检查点，并轮换任何已经暴露的秘密。
