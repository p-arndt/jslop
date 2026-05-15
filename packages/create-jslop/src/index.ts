#!/usr/bin/env node
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

const HERE = dirname(fileURLToPath(import.meta.url));
// dist/index.js → ../templates resolves to the templates dir that ships in the
// npm tarball (see `files` in package.json).
const TEMPLATES_DIR = resolve(HERE, "..", "templates");

interface Args {
  projectName: string | null;
  template: string | null;
  yes: boolean;
}

function parseArgs(argv: string[]): Args {
  const out: Args = { projectName: null, template: null, yes: false };
  for (const a of argv) {
    if (a === "--yes" || a === "-y") out.yes = true;
    else if (a.startsWith("--template=")) out.template = a.slice("--template=".length);
    else if (!a.startsWith("-") && !out.projectName) out.projectName = a;
  }
  return out;
}

function listTemplates(): string[] {
  return readdirSync(TEMPLATES_DIR).filter((n) =>
    statSync(join(TEMPLATES_DIR, n)).isDirectory()
  );
}

function loadOwnVersion(): string {
  const pkg = JSON.parse(
    readFileSync(resolve(HERE, "..", "package.json"), "utf8")
  ) as { version: string };
  return pkg.version;
}

function copyTree(from: string, to: string, replacements: Record<string, string>): void {
  mkdirSync(to, { recursive: true });
  for (const entry of readdirSync(from)) {
    const src = join(from, entry);
    // npm strips `.gitignore` from published tarballs (renames it to .npmignore).
    // Workaround: ship as `_gitignore` and rename at scaffold time. Same trick
    // for any other dotfile we want to ship.
    const renamed = entry.startsWith("_") ? "." + entry.slice(1) : entry;
    const dst = join(to, renamed);
    const s = statSync(src);
    if (s.isDirectory()) {
      copyTree(src, dst, replacements);
      continue;
    }
    // Substitute placeholders only in text-ish files; for everything else
    // copy bytes verbatim so we don't accidentally corrupt binaries.
    if (looksTextual(entry)) {
      let text = readFileSync(src, "utf8");
      for (const [k, v] of Object.entries(replacements)) {
        text = text.split(k).join(v);
      }
      writeFileSync(dst, text);
    } else {
      cpSync(src, dst);
    }
  }
}

function looksTextual(name: string): boolean {
  return /\.(json|jsonc|mjs|cjs|js|ts|tsx|jsx|jslop|css|html|md|txt|svg|yml|yaml|toml)$/i.test(name)
    || name === "package.json"
    || name.startsWith("_");
}

async function promptName(): Promise<string> {
  const rl = createInterface({ input: stdin, output: stdout });
  const answer = (await rl.question("Project name: ")).trim();
  rl.close();
  if (!answer) {
    console.error("project name is required");
    process.exit(1);
  }
  return answer;
}

async function promptTemplate(available: string[]): Promise<string> {
  if (available.length === 1) return available[0]!;
  console.log("Available templates:");
  available.forEach((t, i) => console.log(`  ${i + 1}. ${t}`));
  const rl = createInterface({ input: stdin, output: stdout });
  const answer = (await rl.question(`Pick one [1-${available.length}, default 1]: `)).trim();
  rl.close();
  const idx = answer === "" ? 1 : Number(answer);
  if (!Number.isInteger(idx) || idx < 1 || idx > available.length) {
    console.error(`invalid choice: ${answer}`);
    process.exit(1);
  }
  return available[idx - 1]!;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const templates = listTemplates();

  const projectName = args.projectName ?? (await promptName());
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(projectName)) {
    console.error(`invalid project name: ${projectName}`);
    console.error("use letters, digits, '.', '_', '-' and start with a letter or digit.");
    process.exit(1);
  }

  const template = args.template ?? (await promptTemplate(templates));
  if (!templates.includes(template)) {
    console.error(`unknown template: ${template}`);
    console.error(`available: ${templates.join(", ")}`);
    process.exit(1);
  }

  const target = resolve(process.cwd(), projectName);
  if (existsSync(target)) {
    console.error(`directory already exists: ${relative(process.cwd(), target) || "."}`);
    process.exit(1);
  }

  const version = loadOwnVersion();
  // create-jslop is in the same fixed-version group as @jslop/*, so its own
  // version doubles as the framework version the scaffold should request.
  const jslopRange = `^${version}`;

  const replacements: Record<string, string> = {
    "__JSLOP_VERSION__": jslopRange,
    "__PROJECT_NAME__": projectName,
  };

  copyTree(join(TEMPLATES_DIR, template), target, replacements);

  console.log(`\n✔ Created ${projectName} (template: ${template})\n`);
  console.log("Next steps:");
  console.log(`  cd ${projectName}`);
  console.log("  pnpm install   # or: npm install / bun install");
  console.log("  pnpm dev\n");
}

void main();
