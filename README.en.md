# dsh-ptc-noargs

[简体中文](README.md) · [English](README.en.md)

A minimal Cordis plugin that fixes no-argument tool calls in DSH PTC `run_code`.

## Problem

Inside `run_code`, calling a tool without an arguments object:

```ts
await tools.job_list()
await tools.job_list(undefined)
```

fails with:

```text
binding arguments must be lossless JSON
```

The PTC worker snapshots binding arguments as lossless JSON before handing the call to the host. `undefined` has no such representation, so the worker rejects the call and the host never sees it. Passing `await tools.job_list({})` works, but models often omit `{}` for tools with no required arguments.

## How it works

The plugin listens on the shared `tools/execute` waterfall. When the tool is `run_code`, the program is a TypeScript function body, and `arguments.code` is a string, it prefixes the execution copy of the code with a one-line prelude:

```js
tools=(()=>{const s=tools,w={__proto__:null};if(s)for(const k in s){const v=s[k];w[k]=typeof v==="function"?(...a)=>{if(a.length===0||a[0]===undefined)a[0]={};return v(...a)}:v}return w})();
```

The prelude clones the `tools` namespace and wraps each function so that an omitted or explicitly `undefined` first argument becomes `{}`; all other arguments pass through unchanged. User code still refers to `tools` by the same name.

The plugin does not modify the PTC runtime or tool definitions, and it does not alter what the model sees: logs and UI keep the original `code`; only the executed copy contains the prelude.

## Scope and limitations

- TypeScript function-body programs only (the PTC default). Python, REPL, and script modes are skipped.
- The injected prelude is one line, so user-code line numbers shift by one; stack traces shift too.
- It relies on `tools/execute` receiving an execution object whose `arguments` field can be replaced. That is how the shared pipeline behaves today, but it is not a documented stable API; if upstream tightens it, the plugin skips safely (`warn` only, never blocks the call).
- `null` is not rewritten; only omission and explicit `undefined` are normalized.
- It does not affect ordinary tool calls through the native executor; only PTC bindings inside `run_code`.
- Verified on DSH 0.2.2-rc.1; peer dependency is `@deepseek-ai/cordis >=4.0.0-rc <5`.

## Install

Keep the plugin in a stable directory (not a temporary workspace). The recommended route is the plugin page (no restart):

1. **Plugins** → **Add plugin**, enter the local directory path.
2. Click **Enable now**; the manager shows **Running** when active.

Alternatively, quit the desktop app and use the CLI:

```powershell
# Clone from GitHub into a stable location (or move a downloaded directory there):
git clone https://github.com/TLEWA/dsh-ptc-noargs.git "C:\Users\<you>\.dsh\local-plugins\dsh-ptc-noargs"

dsh plugin --profile desktop add "link:C:\Users\<you>\.dsh\local-plugins\dsh-ptc-noargs"
```

Alternatively, run `npm pack` in this directory and install the resulting `.tgz` (no dependency on the source directory):

```powershell
dsh plugin --profile desktop add "C:\path\to\dsh-ptc-noargs-0.2.0.tgz"
```

> If `dsh` is not on PATH, use `resources\runtime\cli\bin\dsh.cmd` under your DSH install directory.

A CLI install needs a restart; a plugin-page install is hot-loaded. Verify with:

```ts
// run_code
await tools.job_list()
await tools.list_agents()
```

It should return normally instead of raising `binding arguments must be lossless JSON`.

Uninstall:

```powershell
dsh plugin --profile desktop remove dsh-ptc-noargs
```

Uninstalling from the plugin manager takes effect immediately; a CLI uninstall needs a restart.

## Verification and tests

```bash
node test/prelude.test.mjs
```

12 unit tests cover: omitted first argument, explicit `undefined`, explicit arguments, `null`, non-function bindings, a `__proto__` binding, idempotence, `Object` shadowing, strict mode, `run_code` wrapping, non-TypeScript runtimes, and a throwing runtime lookup.

In a real PTC worker, the baseline `tools.job_list()` raised exactly `binding arguments must be lossless JSON`; with the prelude, both `job_list()` and `job_list(undefined)` returned `[]`.

A live end-to-end comparison was also run in the desktop host (DSH 0.2.2-rc.1): after hot-loading via **Plugins → Add plugin → Enable now**, `await tools.job_list()`, `await tools.job_list(undefined)`, `await tools.get_goal()`, and `await tools.list_agents()` all returned normally while the manager showed **Running**; after uninstalling from the plugin manager, the same `await tools.job_list()` immediately raised `binding arguments must be lossless JSON` again. The host was not restarted between the two halves.

## Rollback

Uninstall from the plugin manager; a CLI uninstall needs a restart. It does not write to the DSH installation directory; a `link:` install only adds one entry to the profile `package.json` and the Cordis composition (which should be restored on uninstall).

## Other DSH projects I work on

Fixing argument-less PTC calls is only one corner of DSH. These are the other plugins I maintain — take what fits.

- **[dsh-better-choice](https://github.com/TLEWA/dsh-better-choice)** — an `ask_user_question` enhancement: right-click an option to add a note, or ask the model a side question with the same context before choosing.
- **[dsh-fastload](https://github.com/TLEWA/dsh-fastload)** — trims the first history page of long sessions while preserving the tail the user actually sees.
- **[dsh-if](https://github.com/TLEWA/dsh-if)** — the `/if` command: let the model judge a condition from prior context, then send the instruction below it as a user message only when it holds.
- **[dsh-opencode-go-router](https://github.com/TLEWA/dsh-opencode-go-router)** — rotates OpenCode Go routing after a context fold or a system-prompt rewrite, so less of the prompt cache is lost.
- **[dsh-sidebar-organizer](https://github.com/TLEWA/dsh-sidebar-organizer)** — a layout organizer for seven regions: sidebar, sidebar footer, conversation tabs, composer, session header, right panel, and settings navigation all support long-press drag to reorder, and panels can be tucked into "More".
- **[dsh-sidebar-row-menu](https://github.com/TLEWA/dsh-sidebar-row-menu)** — right-click menus for sidebar rows: workspace rows, session rows and the conversation body each get their own menu, with "Open with" and "More actions" submenus.
- **[dsh-utf8-output](https://github.com/TLEWA/dsh-utf8-output)** — fixes GBK/CP936/GB18030 mojibake from DSH subprocess output on Windows.

## License

MIT

## Codex PR review

This repository adopts the v1 shared review block in AGENTS.md from [central CI](https://github.com/TLEWA/dsh-plugin-ci). Cloud Codex reviews PRs and new commits; maintainers retain final approval and merging. Review results must cover the latest commit. Review consumes subscription usage; use `@codex review` for missing results.
