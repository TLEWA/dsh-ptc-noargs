# dsh-ptc-noargs

[简体中文](README.md) · [English](README.en.md)

一个最小 Cordis 插件，修复 DSH PTC `run_code` 中无参工具调用被拒绝的问题。

## 问题

在 `run_code` 里调用省略参数的工具：

```ts
await tools.job_list()
await tools.job_list(undefined)
```

会失败：

```text
binding arguments must be lossless JSON
```

原因是 PTC worker 在把调用交给宿主之前，先对绑定参数做 lossless JSON 快照；`undefined` 没有可序列化表示，于是 worker 直接拒绝，宿主根本收不到这次调用。显式传 `await tools.job_list({})` 可以绕过，但模型经常省略空参数工具的 `{}`。

## 原理

插件监听共享工具流水线的 `tools/execute` waterfall。仅当工具是 `run_code`、程序是 TypeScript function-body、且参数含 `code` 时，它把执行视图的 `code` 前面加一行 prelude：

```js
tools=(()=>{const s=tools,w={__proto__:null};if(s)for(const k in s){const v=s[k];w[k]=typeof v==="function"?(...a)=>{if(a.length===0||a[0]===undefined)a[0]={};return v(...a)}:v}return w})();
```

这段代码克隆 `tools` 命名空间，把每个函数包装成：首参省略或为 `undefined` 时改为 `{}`，其余参数原样传递。用户代码看到的仍是原来的 `tools` 名字，但每次调用都会经过归一化。

插件不修改 PTC runtime、不修改工具定义，也不修改模型看到的原始参数：日志和 UI 仍记录原始 `code`；只有实际执行的副本带 prelude。

## 支持范围与限制

- 仅支持 TypeScript function-body（PTC 默认模式）。Python、REPL、script 模式会跳过。
- 注入的 prelude 占一行，用户代码行号整体后移 1 行；报错栈里的行号也会偏移。
- 依赖 `tools/execute` 收到可替换 `arguments` 字段的 execution 对象。这是当前共享流水线的行为，但并非 README 承诺的稳定 API；上游若收紧，插件会安全跳过（只 `warn`，不阻断调用）。
- `null` 不会被改写；只归一化“省略”和“显式 `undefined`”。
- 不适用于原生工具执行器下的普通工具调用；它只处理 `run_code` 的 PTC 绑定。
- 已在 DSH 0.2.2-rc.1 验证；peer 为 `@deepseek-ai/cordis >=4.0.0-rc <5`。

## 安装

插件应放在稳定目录（不要留在临时工作区）。推荐用插件页安装（无需重启）：

1. **插件** → **添加插件**，输入本地目录路径。
2. 安装后点 **立即启用**；管理器显示“运行中”即已生效。

也可以退出桌面端后用 CLI 安装：

```powershell
# 从 GitHub 克隆到稳定位置（也可以手动移动已下载的目录）：
git clone https://github.com/TLEWA/dsh-ptc-noargs.git "C:\Users\<you>\.dsh\local-plugins\dsh-ptc-noargs"

dsh plugin --profile desktop add "link:C:\Users\<you>\.dsh\local-plugins\dsh-ptc-noargs"
```

也可以先在本目录执行 `npm pack`，再用生成的 `.tgz` 安装（这样不会依赖源码目录）：

```powershell
dsh plugin --profile desktop add "C:\path\to\dsh-ptc-noargs-0.1.0.tgz"
```

> 如果 `dsh` 不在 PATH，改用 DSH 安装目录下的 `resources\runtime\cli\bin\dsh.cmd`。

CLI 安装后重启 DSH；插件页安装会热加载，通常无需重启。验证：

```ts
// run_code
await tools.job_list()
await tools.list_agents()
```

应返回正常结果，而不是 `binding arguments must be lossless JSON`。

卸载：

```powershell
dsh plugin --profile desktop remove dsh-ptc-noargs
```

从插件管理器卸载后立即恢复；CLI 卸载后重启恢复。

## 验证与测试

```bash
node test/prelude.test.mjs
```

12 项单元测试覆盖：省略首参、显式 `undefined`、显式参数、`null`、非函数绑定、`__proto__` 绑定、幂等、`Object` 遮蔽、严格模式、`run_code` 包装、非 TS runtime 跳过、runtime 查找异常。

真实 PTC worker 中已验证：基线 `tools.job_list()` 精确报 `binding arguments must be lossless JSON`；注入 prelude 后 `job_list()` 与 `job_list(undefined)` 均返回 `[]`。

桌面端真实宿主（DSH 0.2.2-rc.1）中也完成了端到端对照：通过插件页“添加插件 → 立即启用”热加载后，`await tools.job_list()`、`await tools.job_list(undefined)`、`await tools.get_goal()`、`await tools.list_agents()` 均正常返回，管理器显示“运行中”；从插件管理器卸载后，同一 `await tools.job_list()` 立即恢复报 `binding arguments must be lossless JSON`。整个正负对照未重启宿主。

## 回滚

从插件管理器卸载即可；CLI 卸载后重启。插件不写入 DSH 安装目录，不改 profile 以外的文件；`link:` 安装只会在 profile 的 `package.json` / Cordis 组合中增加一项（卸载后应恢复原状）。

## 我的其他 DSH 项目

修复 PTC 无参调用只是 DSH 的一小块。下面这些插件也都由我维护，按需取用。

- **[dsh-better-choice](https://github.com/TLEWA/dsh-better-choice)** —— `ask_user_question` 增强：右键选项补备注，选之前先拿同一份上下文旁问模型一句。
- **[dsh-fastload](https://github.com/TLEWA/dsh-fastload)** —— 长会话首屏历史瘦身：缩小首次打开时的历史页，同时保留用户实际看到的尾部内容。
- **[dsh-if](https://github.com/TLEWA/dsh-if)** —— `/if` 命令：让模型结合上文判断条件，成立才把下面的指令作为用户消息发出。
- **[dsh-opencode-go-router](https://github.com/TLEWA/dsh-opencode-go-router)** —— 上下文折叠或系统提示被重写后轮换 OpenCode Go 路由，少丢一点提示缓存。
- **[dsh-sidebar-organizer](https://github.com/TLEWA/dsh-sidebar-organizer)** —— 七区域布局整理器：侧栏、侧栏底部、对话标签、输入框、会话头部、右侧栏、设置导航都能长按拖拽排序，面板可以收进「更多」再拖回来。
- **[dsh-sidebar-row-menu](https://github.com/TLEWA/dsh-sidebar-row-menu)** —— 侧栏行右键菜单：工作区行、会话行与会话正文各有自己的右键菜单，含「打开方式」「更多操作」二级菜单。
- **[dsh-utf8-output](https://github.com/TLEWA/dsh-utf8-output)** —— 修复 Windows 下 DSH 子进程 GBK/CP936/CP932 输出乱码。

## 许可

MIT
