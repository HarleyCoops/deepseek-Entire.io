# Agent Note: Beautiful UI as the chat-presentation visual reference

Status: implemented

English | [中文](2026-08-16-beautiful-ui-visual-reference.zh.md)

## Problem

Agents and contributors who change Web chat presentation, or a mounted TUI chat frontend, have no recorded visual and interaction catalog for thinking rows, tool cards, approval and ask-user prompts, streaming text, and the prompt composer. WorkspaceAlberta is this clone's `workspace-alberta` product profile on official DeepSeek Harness and needs the same catalog so Web chat stays aligned.

## Decision

[Beautiful UI](https://www.beautifului.dev/) is the visual and interaction reference when changing those elements. It is a catalog of AI-native primitives — thinking traces, streaming text, approval cards, tool chips, task rows, the prompt bar, chat, and context cards — not a library to install.

Do not vendor Beautiful UI, add a `beautifului` npm dependency, or treat the catalog as code to copy into `packages/`. Implementation stays in the existing client stack: [docs/web-styling.md](../../../../docs/web-styling.md) owns tokens and CSS Modules; the [web styling system](2026-07-19-web-styling-system.md) still forbids a component library.

WorkspaceAlberta uses the same reference. Web is the shipped interactive surface; a mounted TUI profile uses the same catalog.

Root `AGENTS.md` carries the one-to-three-line standing order. `packages/client/AGENTS.md` links this note for the Web client stack.

## Alternatives considered

**List the catalog in root `AGENTS.md`.** Rejected: standing orders are one to three lines that link a home. A resource inventory does not belong in the root file.

**Vendor Beautiful UI or add it as an npm dependency.** Rejected: the catalog is a visual and interaction reference. Installing it would make presentation a third-party implementation and would violate the client stack's no-component-library rule.

**Restyle Web to match the catalog in the same change.** Rejected: recording the reference is a documentation decision. Restyling is a separate product change and is not implied by adopting the catalog as a reference.

**Give each harness its own visual catalog.** Rejected: alignment between DeepSeek Harness and the WorkspaceAlberta profile is the reason to share one catalog.

**Put the home in [docs/web-styling.md](../../../../docs/web-styling.md).** Rejected: that page owns token and CSS-module rules, not the cross-surface primitive catalog.

## Consequences

A change to Web or TUI chat presentation consults Beautiful UI for primitive intent and keeps implementation in the existing client stack. This decision adds no product code, npm dependency, or restyle. The [web styling system](2026-07-19-web-styling-system.md) remains the token and CSS-module authority.

## Verification

`pnpm run doc-sync` checks Agent Note format, Markdown links, translation pairing, and the root `AGENTS.md` word budget. No `packages/` behavior changes, so no product test applies.
