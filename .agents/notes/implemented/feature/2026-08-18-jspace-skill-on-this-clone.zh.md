# Agent Note: 本克隆上的 J-Space skill

Status: implemented

[English](2026-08-18-jspace-skill-on-this-clone.md) | 中文

## 问题

这个 Entire.io 克隆需要 DeepSeek Harness 已经作为 profile 插件使用过的 J-Space 认知套件，但不能改写 harness、Entire 桥接，也不能改随附的 web 与 headless 组合包。

## 决策

本克隆从 [`wxxb789/dsh-j-space`](https://github.com/wxxb789/dsh-j-space) 的提交 [`43f15f370f7d1505aed142aecd393f35110763bb`](https://github.com/wxxb789/dsh-j-space/commit/43f15f370f7d1505aed142aecd393f35110763bb) 把 skill（技能）树放到 [`.agents/skills/j-space`](../../../skills/j-space/SKILL.md)。这是 `@deepseek-ai/dsh-skill-filesystem` 已扫描的 project-agents 根目录（rank 200）。可选的 Node.js 控制器放在 [`.agents/skills/dist/jspace.js`](../../../skills/dist/jspace.js)，以保持套件文档中的 `<skill-root>/../dist/jspace.js` 路径。

入库的 `SKILL.md` 只补本地提供方所需的 DeepSeek Harness 文件系统 frontmatter（`name`、`description`、`disable-model-invocation: true`、`user-invocable: true`）。结束标记之后的指令正文就是该插件的 `skill/SKILL.md`。插件本身把同一套调用策略写成类型化的提供方元数据，并不在随包正文里重复 frontmatter。

自动激活不是随附组合包里的配置行。按 profile 用钉死的插件安装命令启用，然后重启该 profile：

```sh
dsh plugin --profile web add github:wxxb789/dsh-j-space#43f15f370f7d1505aed142aecd393f35110763bb
```

安装后的包会贡献它自己的 `cordis.patch.yml` 层（`id: dsh-j-space`，`autoActivate: true`）。[`examples/web-jspace/overlay.yml`](../../../../examples/web-jspace/overlay.yml) 在包已装进 profile 之后，供 profile 的 `cordis.patch.yml` 或 `--patch` overlay 重述或覆盖该插入。[`SOURCE.json`](../../../skills/j-space/SOURCE.json) 记录插件提交、安装命令，以及上游套件钉死点 [Tiger3807861189/J-Space-Cognition-Suite-V3.6@`885dc51`](https://github.com/Tiger3807861189/J-Space-Cognition-Suite-V3.6/commit/885dc513702cc884f0b4fa07d24a27b2df5a1daf)。

随附的 `PROFILE_TEMPLATES`、`@deepseek-ai/dsh-base`、`@deepseek-ai/dsh-web-app`、`@deepseek-ai/dsh-headless` 和 `@deepseek-ai/dsh-entire-bridge` 均未改动。

## 曾考虑的替代方案

**把 `dsh-j-space` 挂进 base 或 web-app 组合包，或写入 `PROFILE_TEMPLATES`。** 否决，因为那些层就是随附组合。缺少树外包会让每个新 profile 启动失败，而且若给 `@deepseek-ai/dsh` 加上外部 git 依赖，会把 CLI 绑到第三方插件上。

**把整个插件（TypeScript 入口、Vite 构建、测试）做成 workspace 包。** 否决，因为本克隆已有一条外部插件路径——`dsh plugin --profile <name> add`——而本次只要求加入 skill/插件，不是新增一等包。

**只记录插件安装命令，不入库 `skill/`。** 否决，因为把本仓库当 workspace 的源码 checkout 在操作者装好 profile 组合包之前会没有 `/j-space`。

**只把 skill 放在 `.dsh/skills`。** 作为 project-dsh 根目录（rank 100）是合法的，但本仓库已把 checkout 本地 skill 放在 `.agents/skills`，而文件系统提供方文档也把这条路径定为 project-agents 发现位置。

## 后果

当本克隆是会话 workspace 时，`/j-space` 可供人调用，且不出现在模型可调用目录中。第一步自动注入仍要求已安装钉死的 profile 插件。若文件系统 skill 与已安装插件同时存在，`/j-space` 查找由 project-agents 的 rank 200 获胜；插件的 `agent/pre-step` 监听器仍从其随包正文激活。去掉 frontmatter 后，两份正文与钉死提交一致。

workspace 下的 `.jspace/` 状态已被 gitignore。Entire 桥接、会话日志和随附工具目录都不变化。

## 测试

文件系统发现和调用策略已由 `@deepseek-ai/dsh-skill-filesystem` 的测试钉住。本次不改变随附组合，因此不新增自动激活的组装应用快照。仍有一个具名缺口：需要一份无密钥快照，覆盖实际安装了 `dsh-j-space` 的 profile，并显示 `dsh-j-space` 配置行以及一次激活载荷。
