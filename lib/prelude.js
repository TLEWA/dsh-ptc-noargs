/**
 * One-line prelude injected at the start of a TypeScript function-body program.
 *
 * It replaces the tools binding with a null-prototype clone whose functions
 * normalize an omitted or explicitly-undefined first argument to {}. The PTC
 * worker rejects undefined while snapshotting arguments, before the host ever
 * sees the call; normalizing inside the program is the only place that can
 * happen without changing @deepseek-ai/dsh-ptc-runtime-node.
 */
export const PRELUDE_MARKER = '/* dsh-ptc-noargs */';

export const PRELUDE = "/* dsh-ptc-noargs */ tools=(()=>{const s=tools,w={__proto__:null};if(s)for(const k in s){const v=s[k];w[k]=typeof v===\"function\"?(...a)=>{if(a.length===0||a[0]===undefined)a[0]={};return v.apply(s, a)}:v}return w})();\n";

/**
 * Prefix a program with the prelude, unless it was already injected.
 * @param {string} code - TypeScript function-body source.
 * @returns {string} Program source with the normalization prelude.
 */
export function injectPrelude(code) {
	return code.startsWith(PRELUDE_MARKER) ? code : PRELUDE + code;
}
