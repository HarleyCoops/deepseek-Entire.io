# @deepseek-ai/dsh-entire-bridge

[English](README.md) | 中文

这是一个休眠的 Cordis 桥接器，把 Harness 已提交的会话事件交给 Entire 的 `dsh` 外部代理钩子。基础 bundle 总会挂载它，但只有会话工作区包含完全匹配的克隆本地标记 `.entire/dsh-hooks.json` 时，它才会写 sidecar 或启动进程：

```json
{"schemaVersion":1,"agent":"dsh"}
```

该标记通常由可信的 `entire-agent-dsh` 适配器安装。桥接器在操作系统临时目录下为每个会话写一份规范化 JSONL sidecar，在 `.entire/tmp/dsh-<session-id>.json` 写入不含正文的引用，并用固定参数向量和 stdin 上的一份版本化 JSON 调用 `entire hooks dsh <hook>`。Sidecar 目录键是规范仓库路径的 SHA-256：先把分隔符转换为 `/`，并在 Windows 上将整条路径转成小写。匹配钩子只会在写入持久化后调用。钩子、进程或 sidecar 失败只产生诊断，不会让 Harness 工作失败。

## 配置

```ts
import type { Config } from '@deepseek-ai/dsh-entire-bridge'

const config: Config = {
  strict: true,
  toolResultMaxBytes: 65_536,
  hookGraceMs: 1_000,
  hookOutputMaxBytes: 4_096,
}
```

`strict` 会省略工具输入/结果和类似推理的助手内容。在所有模式下，助手消息副本都会省略嵌入的工具调用块；非严格模式下，独立的工具调用记录会携带经过解析和递归遮蔽的参数。除此之外，默认转录会保留真实用户提示、已提交的助手消息、工具与嵌套 Code Mode 生命周期/结果、策略与审批事实、正文计时、用量、压缩和子代理谱系；省略请求头、系统提示、schema、环境数据、不透明适配器状态、内部注入消息和原始助手 chunk。明显的凭证键值会被遮蔽，完整工具结果记录也受字节上限约束。`modified_files` 只是由已知且成功的 Harness 修改工具生成的保守提示；checkpoint 内容仍以 Entire 的 Git diff 为准。

## 安全与存储

Sidecar 和 Harness 会话日志都是敏感本地数据；遮蔽是尽力而为，并非保密保证。钩子诊断绝不能打印转录正文。Entire 实际使用的 checkpoint 后端取决于配置（当前 CLI 默认值可能使用 refs），因此本包不承诺任何 shadow branch 名称。对于共享或公开的源码仓库，应选择单独的私有 checkpoint 远端，并在首次推送前审查 checkpoint 内容。

## 模型体验

### Entire 导出

#### 模型看到的内容

无。`@deepseek-ai/dsh-entire-bridge` 只在模型工作之后观察已提交事件，不会添加提示内容或工具。

#### Token 影响

无。导出和钩子不会消耗模型 token。

#### KV Cache 影响

无。它不会修改模型请求前缀。

## 已知限制与延期工作

- 激活需要另行安装可信的 `entire-agent-dsh` 可执行文件和完全匹配的克隆本地标记；本包不会安装可执行文件，也不会发起网络请求。
- Entire 命令缺失或失败只会记录受控警告，因此 Harness 工作成功并不保证 checkpoint 已创建。
- 凭证键遮蔽无法识别任意正文或源码内嵌的秘密；如果输入、结果或推理不能进入 sidecar，请启用 `strict`。
- Sidecar 位于操作系统临时目录并遵循其保留策略；克隆本地引用只包含有界元数据和路径。
