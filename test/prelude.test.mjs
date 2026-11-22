import { deepEqual as looseEqual } from 'node:assert';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createContext, Script } from 'node:vm';

import { apply } from '../lib/index.js';
import {
	ENVIRONMENT_INITIALIZER,
	injectPrelude,
	injectScopedReplPrelude,
	PRELUDE,
	PRELUDE_MARKER,
	SCOPED_REPL_PRELUDE,
} from '../lib/prelude.js';

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

/** Run a source string the same way the TypeScript function-body PTC mode does. */
async function run(source, tools) {
	const fn = new AsyncFunction('tools', "'use strict';\n" + source);
	return await fn(tools);
}

/** Build a null-prototype tools namespace like the PTC worker does. */
function namespace(entries) {
	const tools = Object.create(null);
	for (const [key, value] of Object.entries(entries)) {
		Object.defineProperty(tools, key, { enumerable: true, value });
	}
	return tools;
}

test('omitted first argument becomes {}', async () => {
	const calls = [];
	const tools = namespace({ job_list: async (args) => { calls.push(args); return { args }; } });
	await run(PRELUDE + 'return await tools.job_list();', tools);
	assert.deepEqual(calls, [{}]);
});

test('explicit undefined becomes {}', async () => {
	const calls = [];
	const tools = namespace({ get_goal: async (args) => { calls.push(args); return args; } });
	await run(PRELUDE + 'return await tools.get_goal(undefined);', tools);
	assert.deepEqual(calls, [{}]);
});

test('explicit arguments pass through unchanged', async () => {
	const calls = [];
	const input = { path: '/tmp/x', limit: 2 };
	const tools = namespace({ read: async (args) => { calls.push(args); return args; } });
	const result = await run(PRELUDE + 'return await tools.read({ path: "/tmp/x", limit: 2 });', tools);
	assert.deepEqual(calls, [input]);
	assert.deepEqual(result, input);
});

test('null is not rewritten', async () => {
	const calls = [];
	const tools = namespace({ accept_null: async (args) => { calls.push(args); return args; } });
	await run(PRELUDE + 'return await tools.accept_null(null);', tools);
	assert.deepEqual(calls, [null]);
});

test('non-function bindings survive and keys stay enumerable', async () => {
	const tools = namespace({ version: 7, ping: async (args) => args });
	const result = await run(PRELUDE + 'return [tools.version, Object.keys(tools).sort()];', tools);
	assert.deepEqual(result, [7, ['ping', 'version']]);
});

test('a binding named __proto__ becomes an ordinary own key', async () => {
	const calls = [];
	const tools = namespace({ ['__proto__']: async (args) => { calls.push(args); return args; } });
	await run(PRELUDE + 'return await tools["__proto__"]();', tools);
	assert.deepEqual(calls, [{}]);
});

test('injection is idempotent', () => {
	const once = injectPrelude('return 1;');
	assert.equal(injectPrelude(once), once);
	assert.ok(once.startsWith(PRELUDE_MARKER));
});

test('prelude works when user code shadows Object', async () => {
	await assert.doesNotReject(run(PRELUDE + 'const Object = 1; return Object;', namespace({})));
});

test('prelude keeps an existing strict directive harmless', async () => {
	const tools = namespace({ ping: async (args) => args });
	assert.deepEqual(await run(PRELUDE + '"use strict"; return await tools.ping();', tools), {});
});

/** Minimal Cordis-like context for the plugin unit test. */
function mockContext(runtime = { language: 'typescript', programFormat: 'function-body' }, warnings) {
	const listeners = new Map();
	const ctx = {
		get(name) { return name === 'ptcRuntime' ? runtime : undefined; },
		logger: { warn(message) { warnings?.push(message); } },
		on(event, listener) {
			const list = listeners.get(event) ?? [];
			list.push(listener);
			listeners.set(event, list);
			return () => {};
		},
	};
	apply(ctx);
	return { listeners, ctx };
}

test('tools/execute wraps run_code for TypeScript function bodies', async () => {
	const { listeners } = mockContext();
	const original = Object.freeze({ code: 'return 1;', description: 'test' });
	const exec = { name: 'run_code', arguments: original };
	let seen;
	const result = await listeners.get('tools/execute')[0](exec, async () => {
		seen = exec.arguments;
		return 42;
	});
	assert.equal(result, 42);
	assert.notEqual(seen, original);
	assert.equal(original.code, 'return 1;');
	assert.ok(seen.code.startsWith(PRELUDE_MARKER));
	assert.equal(seen.description, 'test');
});

test('tools/execute leaves other tools and runtimes alone', async () => {
	const { listeners } = mockContext({ language: 'python', programFormat: 'script' });
	const exec = { name: 'run_code', arguments: { code: 'print(1)', description: 'test' } };
	await listeners.get('tools/execute')[0](exec, async () => {});
	assert.equal(exec.arguments.code, 'print(1)');
});

test('tools/execute still calls next when runtime lookup throws', async () => {
	const ctx = {
		get() { throw new Error('runtime unavailable'); },
		logger: { warn() {} },
		on(_event, listener) { this.listener = listener; },
	};
	apply(ctx);
	const exec = { name: 'run_code', arguments: { code: 'return 1;', description: 'test' } };
	let called = false;
	const result = await ctx.listener(exec, async () => { called = true; return 7; });
	assert.equal(called, true);
	assert.equal(result, 7);
	assert.equal(exec.arguments.code, 'return 1;');
});

/**
 * Minimal replica of the alpha scoped REPL (dsh-ptc-runtime-node/src/process.ts):
 * one retained context, and a FRESH tools namespace installed before every
 * program. That reinstall is what makes an initializer-only fix insufficient.
 */
function scopedRepl() {
	const sandbox = Object.create(null);
	const context = createContext(sandbox, { codeGeneration: { strings: false, wasm: false } });
	Object.defineProperty(sandbox, 'global', {
		configurable: true,
		enumerable: true,
		value: new Script('globalThis').runInContext(context),
	});
	let submissions = 0;
	return {
		sandbox,
		/** Install a namespace exactly like the child host does before each run. */
		install(tools) {
			Object.defineProperty(sandbox, 'tools', { configurable: true, enumerable: true, value: tools });
		},
		/** Evaluate one program: strict-mode async wrapper, no top-level return. */
		evaluate(source) {
			submissions += 1;
			const filename = 'program-' + submissions + '.js';
			const factory = new Script(
				'"use strict";(function (__$binding_vals, __$binding_getters) { return async function () {\n'
				+ source
				+ '\n} })()',
				{ filename },
			);
			const program = factory.runInContext(context);
			return { run: async () => await program([], []) };
		},
	};
}

/** First stack frame line number recorded for a filename, or -1. */
function stackLine(error, filename) {
	const frame = String(error?.stack ?? '').split('\n').find((entry) => entry.includes(filename));
	const match = /:(\d+):\d+/.exec(frame ?? '');
	return match ? Number(match[1]) : -1;
}

test('scoped REPL prelude normalizes every retained run', async () => {
	const repl = scopedRepl();
	const calls = [];
	for (let index = 0; index < 3; index += 1) {
		const raw = namespace({ job_list: async (args) => { calls.push(args); return args; } });
		repl.install(raw);
		await repl.evaluate(injectScopedReplPrelude('return await tools.job_list();')).run();
		// The host reinstall is replaced by the wrapper on every run.
		assert.notEqual(repl.sandbox.tools, raw);
		assert.equal(repl.sandbox.tools.__ptcNoargs, true);
	}
	// Arguments cross the realm boundary, so compare them loosely.
	looseEqual(calls, [{}, {}, {}]);
});

test('scoped REPL prelude keeps the function-body normalization rules', async () => {
	const repl = scopedRepl();
	const calls = [];
	repl.install(namespace({ probe: async (args) => { calls.push(args); return args; } }));
	await repl.evaluate(injectScopedReplPrelude([
		'await tools.probe();',
		'await tools.probe(undefined);',
		'await tools.probe(null);',
		'await tools.probe({ path: "/tmp/x" }, "second");',
	].join('\n'))).run();
	looseEqual(calls, [{}, {}, null, { path: '/tmp/x' }]);
});

test('scoped REPL prelude keeps user line numbers', async () => {
	const inline = scopedRepl();
	inline.install(namespace({}));
	const baselineError = await inline
		.evaluate('const a = 1;\nthrow new Error("boom");')
		.run()
		.then(() => null, (error) => error);
	const shifted = scopedRepl();
	shifted.install(namespace({}));
	const injectedError = await shifted
		.evaluate(injectScopedReplPrelude('const a = 1;\nthrow new Error("boom");'))
		.run()
		.then(() => null, (error) => error);
	const baselineLine = stackLine(baselineError, 'program-1.js');
	const injectedLine = stackLine(injectedError, 'program-1.js');
	assert.ok(baselineLine > 0, 'baseline stack frame should be recorded');
	assert.equal(injectedLine, baselineLine);
});

test('scoped REPL prelude is idempotent inside one program', async () => {
	const repl = scopedRepl();
	const calls = [];
	repl.install(namespace({ ping: async (args) => { calls.push(args); return args; } }));
	await repl.evaluate(SCOPED_REPL_PRELUDE + SCOPED_REPL_PRELUDE + 'await tools.ping();').run();
	looseEqual(calls, [{}]);
});

test('scoped REPL prelude fails safe without a tools global', async () => {
	const repl = scopedRepl();
	await repl.evaluate(SCOPED_REPL_PRELUDE).run();
	assert.equal(typeof repl.sandbox.tools, 'undefined');
});

test('scoped REPL prelude keeps tools non-writable, like the host', async () => {
	const repl = scopedRepl();
	repl.install(namespace({}));
	const error = await repl
		.evaluate(injectScopedReplPrelude('tools = 1;'))
		.run()
		.then(() => null, (rejection) => rejection);
	// The rejection comes from the vm realm, so check shape rather than identity.
	assert.ok(error, 'assigning to tools should be rejected');
	assert.match(String(error.message), /tools/);
});

test('scoped REPL prelude survives a program that shadows globalThis', async () => {
	const repl = scopedRepl();
	// The host runs the environment initializer before the first program.
	await repl.evaluate(SCOPED_REPL_PRELUDE).run();
	const calls = [];
	repl.install(namespace({ ping: async (args) => { calls.push(args); return args; } }));
	const shadowed = await repl
		.evaluate(injectScopedReplPrelude('const globalThis = 1;\nreturn await tools.ping();'))
		.run();
	// The declaration is carried, so the prelude reads the handle it registered.
	looseEqual(calls, [{}]);
	looseEqual(shadowed, {});
	assert.equal(repl.sandbox.__ptcNoargsGlobal, repl.sandbox.global);
});

test('a shadowed globalThis no longer fails the program before its first statement', async () => {
	const repl = scopedRepl();
	repl.install(namespace({ ping: async () => 'called' }));
	// No initializer ran first, so the handle is missing: the prelude must degrade,
	// not throw a ReferenceError out of the program's first statement.
	const result = await repl
		.evaluate(injectScopedReplPrelude('const globalThis = 1;\nreturn globalThis;'))
		.run();
	assert.equal(result, 1);
});

test('scoped REPL prelude is a single declaration-free statement', () => {
	assert.ok(SCOPED_REPL_PRELUDE.startsWith(PRELUDE_MARKER));
	assert.match(SCOPED_REPL_PRELUDE, /^\/\* dsh-ptc-noargs \*\/ \(\(\)=>\{[\s\S]*\}\)\(\);$/);
	assert.ok(!SCOPED_REPL_PRELUDE.includes('__$binding_'));
	assert.ok(!SCOPED_REPL_PRELUDE.includes('\n'));
	assert.equal(injectScopedReplPrelude('return 1;'), SCOPED_REPL_PRELUDE + 'return 1;');
	const injected = injectScopedReplPrelude('return 1;');
	assert.equal(injectScopedReplPrelude(injected), injected);
});

/** Runtime stub that records initializer registrations. */
function scopedRuntime(overrides = {}) {
	const registered = [];
	const runtime = {
		language: 'typescript',
		programFormat: 'scoped-repl',
		registerEnvironmentInitializer(program) {
			registered.push(program);
			return async () => {};
		},
		...overrides,
	};
	return { registered, runtime };
}

test('tools/execute wraps run_code for scoped REPL programs', async () => {
	const { registered, runtime } = scopedRuntime();
	const original = Object.freeze({ code: 'await tools.job_list();', description: 'test' });
	const exec = { name: 'run_code', arguments: original };
	const { listeners } = mockContext(runtime);
	let seen;
	const result = await listeners.get('tools/execute')[0](exec, async () => {
		seen = exec.arguments;
		return 42;
	});
	assert.equal(result, 42);
	assert.notEqual(seen, original);
	assert.equal(original.code, 'await tools.job_list();');
	assert.equal(seen.code, SCOPED_REPL_PRELUDE + 'await tools.job_list();');
	assert.equal(seen.description, 'test');
	// No line shift: the prelude stays on the user's first line.
	assert.equal(seen.code.split('\n').length, original.code.split('\n').length);
	assert.equal(registered.length, 1);
});

test('environment initializer is registered once per plugin load', async () => {
	const { registered, runtime } = scopedRuntime();
	const { listeners } = mockContext(runtime);
	assert.deepEqual(registered, [ENVIRONMENT_INITIALIZER]);
	for (let index = 0; index < 3; index += 1) {
		const exec = { name: 'run_code', arguments: { code: 'await tools.job_list();' } };
		await listeners.get('tools/execute')[0](exec, async () => {});
	}
	assert.deepEqual(registered, [ENVIRONMENT_INITIALIZER]);
	assert.ok(ENVIRONMENT_INITIALIZER.startsWith(PRELUDE_MARKER));
});

test('environment initializer covers the first program of an environment', async () => {
	const repl = scopedRepl();
	const calls = [];
	// The host installs the namespace, then evaluates the initializer, then runs
	// the first user program without reinstalling anything.
	repl.install(namespace({ job_list: async (args) => { calls.push(args); return args; } }));
	await repl.evaluate(ENVIRONMENT_INITIALIZER).run();
	await repl.evaluate('await tools.job_list();').run();
	looseEqual(calls, [{}]);
});

test('a later program needs the per-program prelude again', async () => {
	const repl = scopedRepl();
	const calls = [];
	repl.install(namespace({ job_list: async (args) => { calls.push(args); return args; } }));
	await repl.evaluate(ENVIRONMENT_INITIALIZER).run();
	for (let index = 0; index < 2; index += 1) {
		repl.install(namespace({ job_list: async (args) => { calls.push(args); return args; } }));
		await repl.evaluate('await tools.job_list();').run();
	}
	// The retained environment does not keep the initializer's wrapper: the host
	// reinstalls a fresh namespace, so both bare calls arrive raw.
	assert.deepEqual(calls, [undefined, undefined]);
});

test('function-body runtimes never touch the initializer slot', async () => {
	let registered = 0;
	const runtime = {
		language: 'typescript',
		programFormat: 'function-body',
		registerEnvironmentInitializer() { registered += 1; return async () => {}; },
	};
	const { listeners } = mockContext(runtime);
	const exec = { name: 'run_code', arguments: { code: 'return 1;' } };
	await listeners.get('tools/execute')[0](exec, async () => {});
	assert.equal(registered, 0);
	assert.equal(exec.arguments.code, PRELUDE + 'return 1;');
});

test('a scoped REPL runtime without the initializer seam stays inert', async () => {
	const { listeners } = mockContext({ language: 'typescript', programFormat: 'scoped-repl' });
	const exec = { name: 'run_code', arguments: { code: 'await tools.job_list();' } };
	let called = false;
	const result = await listeners.get('tools/execute')[0](exec, async () => { called = true; return 9; });
	assert.equal(called, true);
	assert.equal(result, 9);
	assert.equal(exec.arguments.code, 'await tools.job_list();');
});

test('a failing initializer registration only warns', async () => {
	const warnings = [];
	const runtime = {
		language: 'typescript',
		programFormat: 'scoped-repl',
		registerEnvironmentInitializer() { throw new Error('environment initializer is already registered'); },
	};
	const { listeners } = mockContext(runtime, warnings);
	assert.equal(warnings.length, 1);
	assert.ok(warnings[0].startsWith('dsh-ptc-noargs: skipped environment initializer: '));
	assert.match(warnings[0], /already registered/);
	const exec = { name: 'run_code', arguments: { code: 'await tools.job_list();' } };
	let called = false;
	const result = await listeners.get('tools/execute')[0](exec, async () => { called = true; return 5; });
	assert.equal(called, true);
	assert.equal(result, 5);
	// The per-program prelude still runs; the seam is only an optimization.
	assert.equal(exec.arguments.code, SCOPED_REPL_PRELUDE + 'await tools.job_list();');
	assert.equal(warnings.length, 1);
});

test('scoped REPL path leaves an already annotated program alone', async () => {
	const { listeners } = mockContext(scopedRuntime().runtime);
	const code = PRELUDE_MARKER + ' already;';
	const exec = { name: 'run_code', arguments: { code } };
	await listeners.get('tools/execute')[0](exec, async () => {});
	assert.equal(exec.arguments.code, code);
});

