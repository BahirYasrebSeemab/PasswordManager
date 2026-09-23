// Repeatable regression gate for the spec's anti-HTML-sink control. This replaces a
// one-shot manual `grep` a human ran during Task 14: every .ts/.tsx file under src/
// (excluding test files, which may legitimately use these APIs in jsdom setup) is
// walked and scanned for sinks that would let untrusted page/vault content be
// interpreted as markup or code, rather than rendered as inert text.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const SRC_ROOT = join(import.meta.dirname, "..");

// [label, pattern]. Patterns are deliberately narrow (word-boundaried where it
// matters) so this doesn't false-positive on unrelated identifiers.
const BANNED_PATTERNS: [string, RegExp][] = [
  ["innerHTML", /\binnerHTML\b/],
  ["outerHTML", /\bouterHTML\b/],
  ["insertAdjacentHTML", /\binsertAdjacentHTML\b/],
  ["dangerouslySetInnerHTML", /\bdangerouslySetInnerHTML\b/],
  ["document.write", /\bdocument\.write\b/],
  ["new Function", /\bnew\s+Function\b/],
  ["bare eval(", /(?<![.\w$])eval\s*\(/],
];

function isScannableSourceFile(path: string): boolean {
  if (!/\.(ts|tsx)$/.test(path)) return false;
  return !/\.test\.(ts|tsx)$/.test(path);
}

function listFilesRecursively(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return listFilesRecursively(full);
    return entry.isFile() ? [full] : [];
  });
}

test("no source file under src/ uses an HTML/code sink (innerHTML, eval, etc.)", () => {
  const files = listFilesRecursively(SRC_ROOT).filter(isScannableSourceFile);
  // Sanity check: the walk itself must actually be finding source files, or this
  // test would pass vacuously if the walk were ever broken.
  expect(files.length).toBeGreaterThan(10);

  const offenses: string[] = [];
  for (const file of files) {
    const content = readFileSync(file, "utf8");
    for (const [label, pattern] of BANNED_PATTERNS) {
      if (pattern.test(content)) {
        offenses.push(`${relative(SRC_ROOT, file)}: matched banned pattern "${label}"`);
      }
    }
  }

  expect(offenses, `Found HTML/code sink usage:\n${offenses.join("\n")}`).toEqual([]);
});
