/**
 * Preludes injected at the start of a TypeScript PTC program.
 *
 * PTC snapshots every binding call's arguments as lossless JSON before it hands
 * the call to the host. A call with no argument (or an explicit undefined) has no
 * such snapshot, so the worker rejects it with "binding arguments must be
 * lossless JSON" before the host ever sees it. Both preludes clone the tools
 * namespace and fill an omitted/undefined first argument with {} - the arguments
 * object every PTC binding expects - without touching the runtime.
 *
 * Two program formats need two shapes:
 *
 * - function-body (DSH <= 0.2.2-rc.x, and alpha with executionMode per-call):
 *   the program is the body of a function, so a bare assignment to the tools
 *   global is allowed. PRELUDE keeps that original shape unchanged.
 * - scoped-repl (DSH 0.2.3-alpha.x default): the program is evaluated inside a
 *   retained context where the runtime reinstalls a FRESH, non-writable tools
 *   namespace before every program (dsh-ptc-runtime-node/src/process.ts:185).
 *   A bare assignment throws "Cannot redefine property: tools" and a top-level
 *   declaration collides with the carried binding, so the scoped prelude
 *   redefines the global with Object.defineProperty and declares nothing at the
 *   top level.
 */
export const PRELUDE_MARKER = '/* dsh-ptc-noargs */';

export const PRELUDE = "/* dsh-ptc-noargs */ tools=(()=>{const s=tools,w={__proto__:null};if(s)for(const k in s){const v=s[k];w[k]=typeof v===\"function\"?(...a)=>{if(a.length===0||a[0]===undefined)a[0]={};return v.apply(s, a)}:v}return w})();\n";

/**
 * Scoped REPL prelude. One statement, no top-level declaration, never throws.
 *
 * - It runs as a user program, so the scoped REPL's declaration scanner must see
 *   nothing to carry into later programs; the whole wrap lives inside an arrow.
 * - It reads the current namespace from globalThis and reinstalls the wrapper
 *   with Object.defineProperty, because the runtime defines tools as a
 *   non-writable (configurable) data property and strict-mode assignment throws.
 * - The wrapper carries a non-enumerable __ptcNoargs marker, so re-running the
 *   prelude (or an environment initializer that already wrapped tools) is a
 *   no-op instead of a second layer.
 * - try/catch is mandatory: a throw here would fail the whole program, and the
 *   same text is also registered as an environment initializer, where a throw
 *   discards the retained environment.
 * - No newline follows: user code keeps its original line numbers.
 */
export const SCOPED_REPL_PRELUDE = '/* dsh-ptc-noargs */ (g=>{try{const s=g.tools;if(!s||s.__ptcNoargs)return;const w={__proto__:null};for(const k in s){const v=s[k];w[k]=typeof v==="function"?(...a)=>{if(a.length===0||a[0]===undefined)a[0]={};return v.apply(s,a)}:v}Object.defineProperty(w,"__ptcNoargs",{value:true});Object.defineProperty(g,"tools",{value:w,configurable:true,enumerable:true})}catch{}})(globalThis);';

/**
 * Program handed to PtcRuntime.registerEnvironmentInitializer.
 *
 * The initializer runs once per retained environment, before its first program,
 * so it covers that first program; later programs get a fresh namespace from the
 * runtime and rely on the per-program prelude again. Registering it is
 * best-effort: the seam exists only on runtimes that also report
 * programFormat === 'scoped-repl'.
 */
export const ENVIRONMENT_INITIALIZER = SCOPED_REPL_PRELUDE;

/**
 * Prefix a TypeScript function-body program with the prelude, unless it was
 * already injected.
 * @param {string} code - TypeScript function-body source.
 * @returns {string} Program source with the normalization prelude.
 */
export function injectPrelude(code) {
	return code.startsWith(PRELUDE_MARKER) ? code : PRELUDE + code;
}

/**
 * Prefix a scoped REPL program with the prelude, unless it was already injected.
 * @param {string} code - TypeScript scoped REPL program source.
 * @returns {string} Program source with the normalization prelude.
 */
export function injectScopedReplPrelude(code) {
	return code.startsWith(PRELUDE_MARKER) ? code : SCOPED_REPL_PRELUDE + code;
}
