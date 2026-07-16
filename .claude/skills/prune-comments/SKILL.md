---
name: prune-comments
description: Clear bloated prose comments; make code self-explanatory instead. Use when comments read like essays, or the user asks to prune/clean/trim comments.
---

# Prune comments

Comments are a last resort. A comment may only state a constraint the code cannot show — a platform quirk, an invariant, or why the obvious approach fails. Everything else must be expressed by the code itself.

## The test

Go sentence by sentence through each comment block:

- **Narrates what the code does** → delete. If the code is unclear without it, rename or extract a function until the name says it.
- **Justifies the design / tells its history** → delete. Git history and the spec hold that. A bare spec ref (e.g. `// §6`) may survive if it anchors a hard rule.
- **Restates a domain concept** → delete; CONTEXT.md is the glossary.
- **States a real constraint** (e.g. "structured clone throws on `el`", "same-origin strips worker error messages") → keep, compressed to the constraint itself. One or two sentences, no scene-setting.

## Rewrite rules

- Surviving comments: max 2 lines, one idea. No metaphors, no "the point is", no essays split by blank lines.
- File headers: max 2 lines stating the module's single job — or none if the filename already says it.
- Prefer extracting a well-named function/variable over explaining a block. `const box = measurementRootBox(root)` beats four lines about what the box is.
- Never delete a constraint the code can't express — when unsure whether a sentence is constraint or narration, keep the constraint half, drop the rest.

## Process

1. Find offenders: comment blocks ≥4 consecutive `//` lines (or any comment longer than the code it describes).
2. Rewrite per the rules above; extract/rename where a comment was doing a name's job.
3. Behavior must not change. Verify from repo root: `pnpm typecheck && pnpm test && pnpm lint`.
