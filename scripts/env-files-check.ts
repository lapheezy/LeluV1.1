/**
 * Wider presence check: do FIRMS/AISSTREAM keys exist under ANY name
 * in the env files? Prints only key NAMES (never values).
 */
import { existsSync, readFileSync } from "node:fs";

const FILES = [".env", ".env.local"];

for (const file of FILES) {
  if (!existsSync(file)) {
    console.log(`${file}: MISSING`);
    continue;
  }
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  const hits: string[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    // Extract the key name before any = (tolerates `export K=` and `K = v`)
    const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (!m) continue;
    const name = m[1];
    if (/FIRMS|AISSTREAM|AIS/i.test(name)) {
      const rest = line.slice(line.indexOf("=") + 1).trim();
      hits.push(`${name}=${rest.length > 0 ? `SET(${rest.length} chars)` : "EMPTY"}`);
    }
  }
  console.log(
    `${file}: FIRMS/AIS-related keys → ${hits.length === 0 ? "none found" : hits.join(" | ")}`,
  );
}
