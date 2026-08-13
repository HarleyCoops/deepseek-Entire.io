# DeepSeek Harness

[English](README.md) | 中文

DeepSeek Harness（`dsh`）会把 agent 会话中每一个可观测事实——每一条提示词、每一条消息，以及**模型发起的每一次工具调用和每个工具返回的结果**——提交到唯一一条规范的、仅追加的事件日志中。本文档说明 Harness 如何把这些工具调用面暴露为类型化事件，以及可选的 [Entire](https://github.com/entireio/cli) bridge 如何把这些已提交事件导出为与 Git 关联的检查点。

## 规范会话日志

每个会话一条日志，仅追加，每条记录都带有序号与时间戳。它是 Harness 派生一切内容的唯一事实来源：

- 模型历史——模型实际看到的那些消息；
- 实时 UI 渲染（Chat 与 Trajectory）；
- TypeScript 与 Python SDK 通知；
- 持久化与重放；
- 遥测与压缩；
- Entire 导出。

规则是**模型可见即已记录**：任何进入模型请求的内容都必须能从日志重建，并由运行时不变式断言。因此，新增模型可见输入就意味着新增一种会话事件类型。

## 工具调用暴露

每一次工具交互都会提交为一串类型化事件，它们通过调用标识相互关联，因此读者可以从发起到最终结果完整重建一次调用的生命周期——包括嵌套子调用及其计时——而无需第二条追踪流。

### `tool/call`——根调用

当模型调用工具时，Harness 会提交一条 `tool/call` 事件，携带：

- 工具 `name`；
- 解析后的 `arguments`；
- 稳定的 `callId`；
- 该调用所在的 `turn` 与 `step`。

### 嵌套的 Code Mode 派发

一次根调用可以通过 Code Mode 进一步调用其他工具。每个嵌套调用都会单独提交，从而保留完整树形结构：

- `tool/code-dispatch-start` 记录子调用开始，携带 `rootCallId`、`parentCallId` 与 `subCallId`；
- `tool/code-dispatch` 记录子调用的 `name`、`arguments`、`content` 以及是否出错（`isError`）。

### 策略与审批

- `tool/policy-result` 记录工具调用策略评估的结果与来源——例如，一次调用在派发前是被放行还是被拒绝；
- 当调用需要人工审批时，`approval/asked` 与 `approval/decided` 构成审计对：问了什么、如何答复。

### 工具执行体计时

`tool/body-start` 与 `tool/body-end` 框定工具执行体的实际执行。`tool/body-end` 只记录执行体是返回还是抛出，以及是否被中止。

由于每条事件都带时间戳，调用的策略等待、执行体时长与总时长都能从日志重建。

### `tool/result`——权威结果

`tool/result` 是调用面向模型的结果：经过校验与任何执行后策略之后的最终值。即使存在用于计时与诊断的执行体级事件，它仍是权威结果。

### 日志的消费方

Web UI 直接从 `session/event` 渲染 Chat 与 Trajectory。TypeScript 与 Python SDK 通过易用的工具追踪筛选暴露同一批通知。Entire bridge 则把这些事件的有限子集投影到伴随文件中以生成检查点。

## 将追踪日志写入 Entire

### 什么是 Entire 检查点

[Entire](https://github.com/entireio/cli) 是一个独立工具，用于创建与 Git 关联的 agent 工作检查点：一个检查点把会话产生的 Git 变更与该 agent 所做之事的文本记录配对，从而便于审查、检索与续做。

Harness 并不强制要求 Entire。该集成是可选的导出——没有 Entire 的精确克隆本地标记时，Harness 不做任何伴随文件 I/O，也不启动 Entire 进程。

### bridge

该导出由基础组合包插件 `@deepseek-ai/dsh-entire-bridge`（`packages/hooks/entire-bridge`）实现。它是会话日志的一个休眠观察者。

### 激活

只有受信任的 `entire-agent-dsh` 适配器安装了精确的克隆本地标记后，bridge 才会激活：

```json
{"schemaVersion":1,"agent":"dsh"}
```

标记在设计上就是克隆本地的：克隆仓库绝不会安装或执行该适配器，bridge 也绝不会自行创建该标记。

### 激活后发生什么

当会话在带有标记的克隆中启动时，bridge 会：

1. 把已提交事实投影到规范化的 JSONL 伴随文件中——每条事件一行——位于操作系统临时目录下：

   `<temp>/entire-dsh/<仓库根目录的 sha256>/sessions/<session-id>.jsonl`

2. 在 `.entire/tmp/dsh-<session-id>.json` 写入无正文的引用，其中仅包含伴随文件路径与有限的会话元数据。

3. 发出固定参数的生命周期钩子，供适配器消费，每次通过 stdin 写入一个带版本的 JSON 载荷：

   `entire hooks dsh <hook>`，包括 `session-start`、`turn-start`、`turn-end`、`compaction`、`session-end`、`subagent-start` 与 `subagent-end`。

适配器读取伴随文件，重组工具追踪，并生成 Entire 检查点（git refs，可选私有远端）。

### 捕获内容

默认投影包括：

- 真实用户提示词；
- 已提交的 assistant 消息与规范化用量；
- 根级 `tool/call` 与 `tool/result` 记录；
- 嵌套 Code Mode 派发及其结果；
- 带有限结果与来源的 `tool/policy-result`；
- 需要审批时的 `approval/asked` / `approval/decided` 审计对；
- 用于计时的 `tool/body-start` / `tool/body-end`（返回/抛出/中止）；
- 压缩摘要；
- 会话与子 agent 谱系。

该投影省略原始 assistant 分片、请求头、系统提示词、完整工具 schema、环境数据、凭据、不透明适配器状态以及内部注入消息。明显的凭据键值会被掩码，每条完整的工具结果记录会按字节截断。

`strict` 模式更进一步：它会省略工具输入/结果与类推理的 assistant 内容，同时保留生命周期、提示词、最终 assistant 文本、用量与文件名。

### 保证

bridge 在模型工作之后观察已提交事件。它不增加提示词内容或工具，不消耗模型 token，也不能改变模型请求、审批、工具执行或工具结果。伴随文件与钩子失败仅是警告——它们绝不会导致 Harness 工作失败，也不是检查点已创建的证明。Entire 的 Git diff 仍是文件变更的权威记录。

### 启用

该集成需要 Entire CLI（0.10）以及 `PATH` 上受信任的 `entire-agent-dsh` 适配器：

```sh
entire-agent-dsh info
entire enable --local --agent dsh --checkpoint-remote github:OWNER/PRIVATE_REPO
```

### 存储与安全

伴随文件与原生 Harness 会话日志是敏感的本地数据。请使用独立的私有检查点远端，并在首次推送前在本地审查检查点。掩码是尽力而为，并非保密保证。
