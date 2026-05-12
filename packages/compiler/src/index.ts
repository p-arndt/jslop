export { parseComponent } from "./parser.js";
export type { ParsedComponent, ViewNode } from "./parser.js";
export { generate } from "./codegen.js";
export type { CodegenOptions } from "./codegen.js";

import { parseComponent } from "./parser.js";
import { generate, type CodegenOptions } from "./codegen.js";

export function compile(source: string, opts?: CodegenOptions): string {
  const parsed = parseComponent(source);
  return generate(parsed, opts);
}
