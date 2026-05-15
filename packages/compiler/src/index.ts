export { parseFile, parseComponent, JSlopParseError, formatParseError } from "./parser.js";
export type { ParsedFile, ParsedComponent, ParsedImport, ViewNode } from "./parser.js";
export { generate } from "./codegen.js";
export type { CodegenOptions } from "./codegen.js";

import { parseFile, JSlopParseError, formatParseError } from "./parser.js";
import { generate, type CodegenOptions } from "./codegen.js";

export interface CompileOptions extends CodegenOptions {
  /**
   * Source filename, used purely to label diagnostics. When set, a parse
   * error is re-thrown with a file:line:col header, a code frame, and any
   * available hint — far more useful than a raw character offset.
   */
  filename?: string;
}

export function compile(source: string, opts?: CompileOptions): string {
  try {
    return generate(parseFile(source), opts);
  } catch (err) {
    if (err instanceof JSlopParseError) {
      const formatted = formatParseError(err, source, opts?.filename);
      const wrapped = new Error(formatted);
      (wrapped as Error & { cause?: unknown }).cause = err;
      wrapped.name = "JSlopParseError";
      throw wrapped;
    }
    throw err;
  }
}
