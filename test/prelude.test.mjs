import assert from 'node:assert/strict';
import test from 'node:test';

import { apply } from '../lib/index.js';
import { injectPrelude, PRELUDE, PRELUDE_MARKER } from '../lib/prelude.js';

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
function mockContext(runtime = { language: 'typescript', programFormat: 'function-body' }) {
	const listeners = new Map();
	const ctx = {
		get(name) { return name === 'ptcRuntime' ? runtime : undefined; },
		logger: { warn() {} },
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
