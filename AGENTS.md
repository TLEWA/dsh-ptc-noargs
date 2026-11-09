# AGENTS.md

本仓库是一个 DSH 插件。开工前先读仓库的 `README.md`；通用流程与检查项看中心仓的 [PROCESS.md](https://github.com/TLEWA/dsh-plugin-ci/blob/v1/PROCESS.md) 与 [docs/gates.md](https://github.com/TLEWA/dsh-plugin-ci/blob/v1/docs/gates.md)。本文件只强调本类仓库最容易出错的点。

## 插件的硬性约束

- `package.json` 必须有顶层 `engines.dsh` 与 `engines.node`；写在 `dsh.engines.dsh` 会被宿主忽略。
- `dsh.manifestVersion` 必须是 1，`dsh.bundle.patch` 必须指向真实存在的 `cordis.patch.yml`。
- `cordis.patch.yml` 里 `insert[].name` 必须等于包名；`id` 是用户可见的短名，不要随意改。
- `lib/` 是直接运行的源码（本仓库没有构建步骤）；不要新增 build 步骤，也不要把 `lib/*.js` 改成生成物。
- `package.json` 的 `scripts.prepublishOnly` 必须调用 `dsh-ci-gate --prepublish`；它拦截本机 `npm publish`，不要删除或绕过。

## 本仓库专属

`dsh-ptc-noargs` 不 patch PTC runtime，而是在 `lib/index.js` 里包装共享流水线的 `tools/execute`：
当工具是 `run_code`、程序是 TypeScript function-body、且参数含 `code` 时，只替换 execution 视图里的
`code`，在前面注入一行 prelude，把`tools.foo()` / `tools.foo(undefined)` 的首参归一化为 `{}`。

- 仅处理 TypeScript function-body；Python、REPL、script 模式必须保持 no-op。
- 不修改 runtime、工具定义，也不修改模型或日志看到的原始 `code`；只改传给下游的浅拷贝参数。
- prelude 必须单行、以 `PRELUDE_MARKER` 开头，并在注入前检查幂等；已经带 prelude 的 code 不要重复注入。
- 归一化只填首参：省略或 `undefined` 改成 `{}`；显式传入的对象原样透传，第二参及以后不要动。
- 注入失败只 `warn`，不能把诊断失败变成工具调用失败；`ctx.logger` 缺失时静默跳过。
- 依赖 `tools/execute` 收到可变 execution 对象；上游若收紧，插件应安全跳过而不是报错。
- 测试都在 `test/prelude.test.mjs`（`node:test`），覆盖省略参数、显式 `undefined`、显式参数透传、幂等与非
  TypeScript 模式跳过；用 `npm test` 跑，不要引入测试框架依赖。

## 每次改动

1. 从最新 main 开 `feat/` 或 `fix/` 分支。
2. 改代码、测试、双语文档与 CHANGELOG（同一个 PR）。
3. 本地跑 gate，全绿再 push；不要复制 gate 脚本，CI 会通过 `.ci` 运行中心仓的版本。
4. 开 PR 并按模板勾选；`ci / ci-ok` 通过后由维护者合并。

```bash
npx --yes --package=github:TLEWA/dsh-plugin-ci#v1 dsh-ci-gate
npm test
```

## 发布

只由维护者打 tag 触发 `release.yml`。模型不得执行 `npm publish`、不得改版本号（除非在 `release/` 分支上且被明确要求）。
