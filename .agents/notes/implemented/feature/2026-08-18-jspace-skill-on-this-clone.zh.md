# Agent Note: 从 Tiger V3.6 纳入 J-Space skill

Status: implemented

[English](2026-08-18-jspace-skill-on-this-clone.md) | 中文

## 问题

本 fork 需要的是 Christian 在 2026-08-18 于 wa-pi5 上实际运行的 J-Space skill（技能）：来自 [J-Space Cognition Suite V3.6](https://github.com/Tiger3807861189/J-Space-Cognition-Suite-V3.6) 的 `j-space/` 目录，安装在 `/home/christian/.dsh/skills/j-space`。RaspberryPiBot 用该安装处理 Math-To-Manim #68。`wxxb789/dsh-j-space` 插件包装器不是那次会话的权威来源。只把文件拷进本 git clone 并不会加载用户 skill。

## 决策

本 clone 从 <https://github.com/Tiger3807861189/J-Space-Cognition-Suite-V3.6> 提交 `bd319d8a86d176ee12adb7bba5c3dae716a768a0` 纳入当前上游 `j-space/` 树到 `.agents/skills/j-space/`。纳入的 `SKILL.md` 保留上游 frontmatter（`name: j-space`）。按套件 README 要求，`LICENSE` 与 `THIRD_PARTY_NOTICES.md` 随 skill 一并分发。`.agents/skills/j-space/SOURCE.json` 钉住该提交。正在运行的 `dsh` 还必须在 `${DSH_HOME:-~/.dsh}/skills/j-space` 有该 skill（复制或符号链接）。DSH 发现路径未改。[apps/cli/reference/README.md](../../../../apps/cli/reference/README.md) 与 [examples/web-jspace/overlay.yml](../../../../examples/web-jspace/overlay.yml) 仅将 `dsh plugin --profile web add github:wxxb789/dsh-j-space#main` 记为可选插件安装。

## 考虑过的替代

**只提供 `dsh plugin add github:wxxb789/dsh-j-space#main`。** 该路径会装上包装器（Node 控制器与额外工具），而不是 wa-pi5 上的 Python `scripts/jspace.py` 树。

**把该插件写进 `PROFILE_TEMPLATES` 或 `@deepseek-ai/dsh-web-app`。** 这会改写随附组合。

**改文件系统发现、让仅存在于 clone 中的副本始终加载。** 这会改写 DSH 加载路径。

**自撰更薄的 skill。** 这与 Pi 安装不一致。

## 后果

`dsh-skill-filesystem` 仍将 project-agents（本 clone 作为工作区）排在 200、user-dsh（`~/.dsh/skills`）排在 400。因此 Math-To-Manim 会话需要 user-dsh 副本。纳入的控制器是 Python（`scripts/jspace.py`），不是插件的 `dist/jspace.js`。`.gitignore` 列出 `.jspace/`。上游 `verify_suite.py` 仍是套件检查。Entire.io（`@deepseek-ai/dsh-entire-bridge`）未改。RaspberryPiBot 与 Pi 镜像未改。

## 测试

`python3 .agents/skills/j-space/scripts/verify_suite.py` 报告 `verify_suite: clean`。未重跑聚焦的 `dsh-skill-filesystem` 发现测试；发现路径未改。
