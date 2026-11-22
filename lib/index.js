/**
 * dsh-ptc-noargs - make tools.foo() work inside PTC run_code programs.
 *
 * The PTC worker snapshots every binding call's arguments before it invokes the
 * host. A call with no argument (or an explicit undefined) has no lossless JSON
 * snapshot, so the worker rejects it with:
 *
 *   binding arguments must be lossless JSON
 *
 * This plugin leaves the runtime and the tool definitions untouched. It wraps
 * the tools/execute waterfall for run_code and prefixes the execution copy of
 * the program with a one-line prelude that clones tools and fills an
 * omitted/undefined first argument with {} - the arguments object every PTC
 * binding expects.
 *
 * Two program formats exist, and they need different preludes:
 * - function-body (DSH <= 0.2.2-rc.x, and 0.2.3-alpha.x under
 *   executionMode per-call): the original path, guarded by an exact
 *   programFormat check, unchanged.
 * - scoped-repl (the 0.2.3-alpha.x default): the runtime reinstalls a fresh,
 *   non-writable tools namespace before every program, so the prelude has to be
 *   re-applied per program with Object.defineProperty. The same text is also
 *   registered through PtcRuntime.registerEnvironmentInitializer, which covers
 *   a retained environment's first program; registration is best-effort and
 *   never required for correctness.
 *
 * The branch is capability detection only - program format plus the presence of
 * the initializer seam - never a version string.
 *
 * Scope and limits:
 * - TypeScript programs only; Python and script-style runtimes are left alone.
 * - In function-body mode the prelude occupies a line, so user-code line numbers
 *   shift by one. In scoped-repl mode the prelude sits on the user's first line
 *   and line numbers are preserved.
 * - It depends on tools/execute receiving a mutable execution object, which is
 *   how the shared pipeline runs around-dispatch wrappers today.
 */

import {
	ENVIRONMENT_INITIALIZER,
	injectPrelude,
	injectScopedReplPrelude,
	PRELUDE_MARKER,
} from './prelude.js';

/** Reserved PTC transport name; kept local so this plugin has no runtime dependency. */
const RUN_CODE_NAME = 'run_code';

const WARN_INJECTION = 'dsh-ptc-noargs: skipped prelude injection: ';
const WARN_INITIALIZER = 'dsh-ptc-noargs: skipped environment initializer: ';

export const name = 'dsh-ptc-noargs';

/** Read the optional PTC runtime service; absent when PTC is not composed. */
function readRuntime(ctx) {
	return ctx.get('ptcRuntime');
}

/** Return true when the runtime evaluates TypeScript function bodies (rc.x / per-call). */
function isTypeScriptFunctionBody(runtime) {
	return runtime?.language === 'typescript' && runtime?.programFormat === 'function-body';
}

/** Return true when the runtime evaluates scoped REPL programs and exposes the initializer seam. */
function isScopedReplProgram(runtime) {
	return (
		runtime?.language === 'typescript'
		&& runtime?.programFormat === 'scoped-repl'
		&& typeof runtime?.registerEnvironmentInitializer === 'function'
	);
}

/** Describe an unknown thrown value for a warning line. */
function describe(error) {
	return error instanceof Error ? error.message : String(error);
}

/** Install the around-dispatch wrapper. */
export function apply(ctx) {
	// The register-once slot is a runtime singleton: a second registration throws,
	// and the returned disposer would drain (and thereby discard) a live
	// environment. So we attempt it at most once per plugin load and never hold a
	// disposer - unloading the plugin must not kill a running program.
	let initializerAttempted = false;

	/** Best-effort registration of the environment initializer. */
	const registerInitializer = (runtime) => {
		if (initializerAttempted) return;
		initializerAttempted = true;
		try {
			runtime.registerEnvironmentInitializer(ENVIRONMENT_INITIALIZER);
		}
		catch (error) {
			ctx.logger?.warn?.(WARN_INITIALIZER + describe(error));
		}
	};

	// Try once at load time: a retained environment usually starts with a
	// run_code call, but the first program may also come from another tool, and
	// registering early is the only way to cover it. A missing or older runtime
	// simply skips; the execute path retries once the runtime is visible.
	try {
		const runtime = readRuntime(ctx);
		if (isScopedReplProgram(runtime)) registerInitializer(runtime);
	}
	catch (error) {
		ctx.logger?.warn?.(WARN_INITIALIZER + describe(error));
	}

	ctx.on('tools/execute', async (exec, next) => {
		try {
			const code = exec.arguments?.code;
			if (
				exec.name === RUN_CODE_NAME
				&& typeof code === 'string'
				&& !code.startsWith(PRELUDE_MARKER)
			) {
				const runtime = readRuntime(ctx);
				if (isTypeScriptFunctionBody(runtime)) {
					// Replace the execution view only; the caller's frozen argument object
					// (and the original model-facing code) stays intact.
					exec.arguments = { ...exec.arguments, code: injectPrelude(code) };
				}
				else if (isScopedReplProgram(runtime)) {
					// Covers a runtime that only became visible after apply().
					registerInitializer(runtime);
					exec.arguments = { ...exec.arguments, code: injectScopedReplPrelude(code) };
				}
			}
		}
		catch (error) {
			// Never turn a diagnostic/plugin failure into a failed tool call.
			ctx.logger?.warn?.(WARN_INJECTION + describe(error));
		}
		return next();
	});
}
