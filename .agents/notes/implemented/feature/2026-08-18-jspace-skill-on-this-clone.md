# Agent Note: J-Space skill on this clone

Status: implemented

English | [中文](2026-08-18-jspace-skill-on-this-clone.zh.md)

## Problem

This Entire.io clone needs the J-Space cognition suite that DeepSeek Harness already used as a profile plugin, without rewriting the harness, the Entire bridge, or the shipped web and headless bundles.

## Decision

The clone vendors the skill tree from [`wxxb789/dsh-j-space`](https://github.com/wxxb789/dsh-j-space) commit [`43f15f370f7d1505aed142aecd393f35110763bb`](https://github.com/wxxb789/dsh-j-space/commit/43f15f370f7d1505aed142aecd393f35110763bb) into [`.agents/skills/j-space`](../../../skills/j-space/SKILL.md). That is the existing project-agents root scanned by `@deepseek-ai/dsh-skill-filesystem` (rank 200). The optional Node.js controller stays at [`.agents/skills/dist/jspace.js`](../../../skills/dist/jspace.js) so the suite's documented `<skill-root>/../dist/jspace.js` path still resolves.

The vendored `SKILL.md` adds only the DeepSeek Harness filesystem frontmatter the local provider requires (`name`, `description`, `disable-model-invocation: true`, `user-invocable: true`). The instruction body after that closer is the plugin's `skill/SKILL.md`. The plugin itself represents the same invocation policy as typed provider metadata and does not repeat frontmatter in its packaged body.

Automatic activation is not a shipped bundle row. Enable it per profile with the pinned plugin add, then restart that profile:

```sh
dsh plugin --profile web add github:wxxb789/dsh-j-space#43f15f370f7d1505aed142aecd393f35110763bb
```

The installed package contributes its own `cordis.patch.yml` layer (`id: dsh-j-space`, `autoActivate: true`). [`examples/web-jspace/overlay.yml`](../../../../examples/web-jspace/overlay.yml) restates that insert for a profile `cordis.patch.yml` or a `--patch` overlay after the package is installed. [`SOURCE.json`](../../../skills/j-space/SOURCE.json) records the plugin commit, the install line, and the upstream suite pin [Tiger3807861189/J-Space-Cognition-Suite-V3.6@`885dc51`](https://github.com/Tiger3807861189/J-Space-Cognition-Suite-V3.6/commit/885dc513702cc884f0b4fa07d24a27b2df5a1daf).

The shipped `PROFILE_TEMPLATES`, `@deepseek-ai/dsh-base`, `@deepseek-ai/dsh-web-app`, `@deepseek-ai/dsh-headless`, and `@deepseek-ai/dsh-entire-bridge` are unchanged.

## Alternatives considered

**Mount `dsh-j-space` in the base or web-app bundle, or add it to `PROFILE_TEMPLATES`.** Rejected because those layers are the shipped composition. A missing out-of-tree package would fail every fresh profile, and publishing `@deepseek-ai/dsh` with an external git dependency would couple the CLI to a third-party plugin.

**Vendor the entire plugin (TypeScript entry, Vite build, tests) as a workspace package.** Rejected because this clone already has one external-plugin path — `dsh plugin --profile <name> add` — and the request is a skill/plugin add, not a new first-party package.

**Document the plugin add only, without vendoring `skill/`.** Rejected because a source checkout used as the workspace would then lack `/j-space` until each operator installed the profile bundle.

**Place the skill under `.dsh/skills` only.** Valid as the project-dsh root (rank 100), but this repository already keeps checkout-local skills under `.agents/skills`, and that is the path the filesystem provider documents for project-agents discovery.

## Consequences

When this clone is the session workspace, `/j-space` is user-invocable and absent from the model-invocable catalog. Automatic first-step injection still requires the pinned profile plugin. If both the filesystem skill and the installed plugin are present, project-agents rank 200 wins `/j-space` lookup; the plugin's `agent/pre-step` listener continues to activate from its own packaged body. After frontmatter is stripped, those bodies match the pinned commit.

Workspace `.jspace/` state is gitignored. The Entire bridge, session log, and shipped tool catalog do not change.

## Testing

Filesystem discovery and invocation policy are already pinned by `@deepseek-ai/dsh-skill-filesystem` tests. This change does not alter shipped composition, so it adds no assembled-application snapshot of automatic activation. A named gap remains: a keyless snapshot of a profile that has actually installed `dsh-j-space` and shown the `dsh-j-space` row plus one activation payload.
