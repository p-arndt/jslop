export { parseFile, parseComponent } from "./parser.js";
export type { ParsedFile, ParsedComponent, ParsedImport, ViewNode } from "./parser.js";
export { generate } from "./codegen.js";
export type { CodegenOptions } from "./codegen.js";

import { parseFile } from "./parser.js";
import { generate, type CodegenOptions } from "./codegen.js";

export function compile(source: string, opts?: CodegenOptions): string {
  return generate(parseFile(source), opts);
}
