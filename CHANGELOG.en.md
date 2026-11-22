# Changelog

> Primary documentation language: Chinese · [中文](./CHANGELOG.md)

## [Unreleased]

- Support the scoped REPL default of DSH 0.2.3-alpha.x: a dedicated scoped-repl prelude (one expression, no top-level declaration, `Object.defineProperty` over `tools`, a non-enumerable marker for idempotence, and an inner `try/catch` that never breaks the program), and - when the runtime exposes `registerEnvironmentInitializer` - the same text registered as the environment initializer (best-effort; a failure only `warn`s).
- Behavior change: in scoped-repl mode the prelude shares the user's first line, so user-code line numbers no longer shift. The function-body path keeps its previous one-line injection, which still shifts line numbers by one.
- The 0.2.2-rc.x function-body path keeps its exact `programFormat === 'function-body'` gate; the branch is capability detection from what the runtime reports, never a version string, and both paths have unit tests.
- Unit tests go from 12 to 27, adding a `node:vm` replica of the alpha evaluation environment (retained context plus a fresh `tools` namespace before every run) that pins the initializer covering only the first program.

## [0.2.0] - 2026-11-11

- Fix the cross-repo index entry for dsh-utf8-output: it repairs GBK/CP936/GB18030 subprocess output, not CP932.

- Adopt shared Codex PR review rules and repository-specific review guidance; preserve existing CI, human approval, and release behavior.

## [0.1.0] — 2026-11-10

Initial release.

- Adds the `dsh-ptc-noargs` plugin: it wraps the shared pipeline's `tools/execute` and, for `run_code` TypeScript function-body programs, prefixes the program with a one-line prelude that normalizes an omitted or `undefined` first argument to `{}`.
- It does not change the PTC runtime, tool definitions, or the original `code` the model sees; an injection failure only warns and never blocks the call.
- Tests cover an omitted argument, an explicit `undefined`, pass-through of explicit arguments, prelude idempotence, and skipping non-TypeScript modes.
- Wired to the canonical CI: `ci / ci-ok` gate, `@v1` caller workflows, `ci.config.json` and the local publish guard.
