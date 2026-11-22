# Changelog

> 主文档语言：中文 · [English](./CHANGELOG.en.md)

## [Unreleased]

- 适配 DSH 0.2.3-alpha.x 的 scoped REPL 默认执行模式：新增 scoped-repl 专用 prelude（单表达式、无顶层声明、用 `Object.defineProperty` 覆盖 `tools`、不可枚举标记保证幂等、内部 `try/catch` 不让程序崩），并在 runtime 暴露 `registerEnvironmentInitializer` 时把同一段文本注册为环境初始化器（尽力而为，失败只 `warn`）；prelude 不再把任何标识符放在 `try` 之外，用户程序自己声明 `globalThis` 时不会在首语句前抛错，并可由自注册的 `__ptcNoargsGlobal` 句柄继续归一化。
- 行为变更：scoped-repl 模式下 prelude 与用户首行同行，用户代码行号不再偏移；此前只有 function-body 一行注入，会让行号后移 1 行，该行为保留不变。
- 保留 0.2.2-rc.x 的 function-body 路径与原来精确的 `programFormat === 'function-body'` 判定，按 runtime 报告的能力分支，不读版本号；两条路径各有单元测试。
- 单元测试从 12 项增至 29 项，新增 `node:vm` 复刻的 alpha 求值环境（常驻上下文 + 每次执行前重装 `tools` 命名空间），覆盖初始化器只覆盖首个程序这一事实，以及用户声明 `globalThis` 的两种情形（有、无初始化器留下的句柄）。

## [0.2.0] - 2026-11-11

- 修正与 dsh-utf8-output 的交叉索引文案：该插件修正的是 GBK/CP936/GB18030 子进程输出，不涉及 CP932。

- 接入 Codex PR 公共审阅规则与本仓重点，保留现有 CI、人工批准和发布行为。

## [0.1.0] — 2026-11-10

首个版本。

- 新增 `dsh-ptc-noargs` 插件：包装共享流水线的 `tools/execute`，在 `run_code` 的 TypeScript function-body 程序前注入一行 prelude，把省略或为 `undefined` 的首参归一化为 `{}`。
- 不修改 PTC runtime、工具定义或模型看到的原始 `code`；注入失败只 warn，不阻断调用。
- 测试覆盖省略参数、显式 `undefined`、显式参数透传、prelude 幂等与非 TypeScript 模式跳过。
- 接入中心 CI：`ci / ci-ok` 门禁、`@v1` caller workflow、`ci.config.json` 与本地发布守卫。
