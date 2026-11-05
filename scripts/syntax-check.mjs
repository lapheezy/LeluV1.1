#!/usr/bin/env node
/**
 * Syntax-only check of the named TypeScript/JavaScript files, with the
 * project's own TypeScript parser. Reports parse errors and nothing else
 * (no types, no lint rules), so it can gate a generated change before the
 * slower typecheck. Used by the engineering runtime's "syntax-files"
 * operation inside workspace copies, where file-walking linters skip
 * everything under the git-ignored sandbox directory.
 *
 *   node scripts/syntax-check.mjs src/a.ts src/b.tsx
 */
import { readFileSync } from "node:fs";
import ts from "typescript";

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("usage: syntax-check.mjs <file> [file...]");
  process.exit(2);
}

let errors = 0;
for (const file of files) {
  let source;
  try {
    source = readFileSync(file, "utf8");
  } catch (error) {
    console.error(`${file}: cannot read (${error.code ?? error.message})`);
    errors += 1;
    continue;
  }
  const { diagnostics = [] } = ts.transpileModule(source, {
    fileName: file,
    reportDiagnostics: true,
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  });
  for (const diagnostic of diagnostics) {
    const where = diagnostic.file && diagnostic.start !== undefined
      ? diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start)
      : null;
    console.error(
      `${file}${where ? `:${where.line + 1}:${where.character + 1}` : ""}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")}`,
    );
    errors += 1;
  }
}
console.log(errors === 0 ? `syntax ok: ${files.length} file(s)` : `${errors} syntax error(s) in ${files.length} file(s)`);
process.exit(errors === 0 ? 0 : 1);
