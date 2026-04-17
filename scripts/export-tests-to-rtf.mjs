import { readdir, readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const workspaceRoot = process.cwd();
const testsDir = path.join(workspaceRoot, "tests");
const outDir = path.join(workspaceRoot, "exports");
const outFile = path.join(outDir, "all-tests.rtf");

function rtfEscape(text) {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/\{/g, "\\{")
    .replace(/\}/g, "\\}")
    // RTF expects CRLF-like paragraph breaks via \par
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => (line.length ? line : ""))
    .join("\\par\n");
}

async function listTestFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      files.push(...(await listTestFiles(full)));
    } else if (e.isFile() && e.name.endsWith(".test.ts")) {
      files.push(full);
    }
  }
  return files;
}

function rel(p) {
  return path.relative(workspaceRoot, p).replaceAll(path.sep, "/");
}

async function main() {
  const files = (await listTestFiles(testsDir)).sort((a, b) => rel(a).localeCompare(rel(b)));
  await mkdir(outDir, { recursive: true });

  const parts = [];
  parts.push("{\\rtf1\\ansi\\deff0");
  parts.push("{\\fonttbl{\\f0\\fnil\\fcharset0 Menlo;}{\\f1\\fnil\\fcharset0 Arial;}}");
  parts.push("\\fs20");

  parts.push("\\f1\\b Ironsight Test Suite (tests/**/*.test.ts)\\b0\\f0\\par");
  parts.push(`\\f1 Generated: ${new Date().toISOString()}\\f0\\par`);
  parts.push(`\\f1 Files: ${files.length}\\f0\\par\\par`);

  for (const file of files) {
    const content = await readFile(file, "utf8");
    parts.push("\\f1\\b ----------------------------------------\\b0\\f0\\par");
    parts.push(`\\f1\\b ${rtfEscape(rel(file))}\\b0\\f0\\par\\par`);
    parts.push("\\f0");
    parts.push(rtfEscape(content));
    parts.push("\\par\\par");
  }

  parts.push("}");
  await writeFile(outFile, parts.join("\n"), "utf8");
  process.stdout.write(`${rel(outFile)}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

