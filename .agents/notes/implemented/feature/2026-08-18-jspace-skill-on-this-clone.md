# Agent Note: J-Space skill vendored from Tiger V3.6

Status: implemented

English | [中文](2026-08-18-jspace-skill-on-this-clone.zh.md)

## Problem

This fork needed the J-Space skill that Christian actually ran on wa-pi5 on 2026-08-18: the `j-space/` folder from [J-Space Cognition Suite V3.6](https://github.com/Tiger3807861189/J-Space-Cognition-Suite-V3.6) at `/home/christian/.dsh/skills/j-space`. RaspberryPiBot used that install for Math-To-Manim #68. The `wxxb789/dsh-j-space` plugin wrapper is not that session's source of truth. Copying files into this git clone alone does not load a user skill.

## Decision

This clone vendors the current upstream `j-space/` tree at `.agents/skills/j-space/` from <https://github.com/Tiger3807861189/J-Space-Cognition-Suite-V3.6> commit `bd319d8a86d176ee12adb7bba5c3dae716a768a0`. The vendored `SKILL.md` keeps the upstream frontmatter (`name: j-space`). `LICENSE` and `THIRD_PARTY_NOTICES.md` travel with the skill as the suite README requires. `.agents/skills/j-space/SOURCE.json` pins that commit. A running `dsh` must also have the skill at `${DSH_HOME:-~/.dsh}/skills/j-space` (copy or symlink). DSH discovery is unchanged. [apps/cli/reference/README.md](../../../../apps/cli/reference/README.md) and [examples/web-jspace/overlay.yml](../../../../examples/web-jspace/overlay.yml) record `dsh plugin --profile web add github:wxxb789/dsh-j-space#main` only as an optional plugin install.

## Alternatives considered

**Ship only `dsh plugin add github:wxxb789/dsh-j-space#main`.** That path installs the wrapper (Node controller and extra tools), not the Python `scripts/jspace.py` tree on wa-pi5.

**Add that plugin to `PROFILE_TEMPLATES` or `@deepseek-ai/dsh-web-app`.** That would rewrite shipped composition.

**Change filesystem discovery so a clone-only copy always loads.** That would rewrite DSH load paths.

**Invent a thinner skill.** That would not match the Pi install.

## Consequences

`dsh-skill-filesystem` still ranks project-agents (this clone as workspace) at 200 and user-dsh (`~/.dsh/skills`) at 400. Math-To-Manim sessions therefore need the user-dsh copy. The vendored controller is Python (`scripts/jspace.py`), not the plugin's `dist/jspace.js`. `.gitignore` lists `.jspace/`. Upstream `verify_suite.py` stays the suite check. Entire.io (`@deepseek-ai/dsh-entire-bridge`) is unchanged. RaspberryPiBot and the Pi image are unchanged.

## Testing

`python3 .agents/skills/j-space/scripts/verify_suite.py` reports `verify_suite: clean`. Focused `dsh-skill-filesystem` discovery tests were not re-run; discovery paths did not change.
