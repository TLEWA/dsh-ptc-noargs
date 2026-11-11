# Changelog

> 主文档语言：中文 · [English](./CHANGELOG.en.md)

## [0.2.0] - 2026-11-11

- 修正与 dsh-utf8-output 的交叉索引文案：该插件修正的是 GBK/CP936/GB18030 子进程输出，不涉及 CP932。

- 接入 Codex PR 公共审阅规则与本仓重点，保留现有 CI、人工批准和发布行为。

## [0.1.0] — 2026-11-10

首个版本。

- 新增 `dsh-ptc-noargs` 插件：包装共享流水线的 `tools/execute`，在 `run_code` 的 TypeScript function-body 程序前注入一行 prelude，把省略或为 `undefined` 的首参归一化为 `{}`。
- 不修改 PTC runtime、工具定义或模型看到的原始 `code`；注入失败只 warn，不阻断调用。
- 测试覆盖省略参数、显式 `undefined`、显式参数透传、prelude 幂等与非 TypeScript 模式跳过。
- 接入中心 CI：`ci / ci-ok` 门禁、`@v1` caller workflow、`ci.config.json` 与本地发布守卫。
