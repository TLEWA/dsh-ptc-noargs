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
 * the tools/execute waterfall for run_code, and prefixes the TypeScript
 * function-body program with a one-line prelude that clones tools and fills an
 * omitted/undefined first argument with {} - the arguments object every PTC
 * binding expects.
 *
 * Scope and limits:
 * - TypeScript function-body programs only (the PTC default); Python and
 *   script-style runtimes are left alone.
 * - The injected prelude shifts user-code line numbers by one.
 * - It depends on tools/execute receiving a mutable execution object, which is
 *   how the shared pipeline runs around-dispatch wrappers today.
 */

import { injectPrelude, PRELUDE_MARKER } from './prelude.js';

/** Reserved PTC transport name; kept local so this plugin has no runtime dependency. */
const RUN_CODE_NAME = 'run_code';

export const name = 'dsh-ptc-noargs';

/** Return true when the active runtime evaluates TypeScript function bodies. */
function isTypeScriptFunctionBody(ctx) {
	const runtime = ctx.get('ptcRuntime');
	return runtime?.language === 'typescript' && runtime.programFormat === 'function-body';
}

/** Install the around-dispatch wrapper. */
export function apply(ctx) {
	ctx.on('tools/execute', async (exec, next) => {
		try {
			const code = exec.arguments?.code;
			if (
				exec.name === RUN_CODE_NAME
				&& typeof code === 'string'
				&& !code.startsWith(PRELUDE_MARKER)
				&& isTypeScriptFunctionBody(ctx)
			) {
				// Replace the execution view only; the caller's frozen argument object
				// (and the original model-facing code) stays intact.
				exec.arguments = { ...exec.arguments, code: injectPrelude(code) };
			}
		}
		catch (error) {
			// Never turn a diagnostic/plugin failure into a failed tool call.
			ctx.logger?.warn?.('dsh-ptc-noargs: skipped prelude injection: ' + (error instanceof Error ? error.message : String(error)));
		}
		return next();
	});
}
