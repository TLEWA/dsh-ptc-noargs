# Changelog

> Primary documentation language: Chinese · [中文](./CHANGELOG.md)

## [0.2.0] - 2026-11-11

- Fix the cross-repo index entry for dsh-utf8-output: it repairs GBK/CP936/GB18030 subprocess output, not CP932.

- Adopt shared Codex PR review rules and repository-specific review guidance; preserve existing CI, human approval, and release behavior.

## [0.1.0] — 2026-11-10

Initial release.

- Adds the `dsh-ptc-noargs` plugin: it wraps the shared pipeline's `tools/execute` and, for `run_code` TypeScript function-body programs, prefixes the program with a one-line prelude that normalizes an omitted or `undefined` first argument to `{}`.
- It does not change the PTC runtime, tool definitions, or the original `code` the model sees; an injection failure only warns and never blocks the call.
- Tests cover an omitted argument, an explicit `undefined`, pass-through of explicit arguments, prelude idempotence, and skipping non-TypeScript modes.
- Wired to the canonical CI: `ci / ci-ok` gate, `@v1` caller workflows, `ci.config.json` and the local publish guard.
