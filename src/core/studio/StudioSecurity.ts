/**
 * ==========================================================
 * LÉLU — SESSION 3C: SECRET HYGIENE
 *
 * "Never expose secrets in frontend code" is enforced at the write
 * boundary, not left as an instruction. A file that would ship a
 * credential to a browser is refused before it reaches the disk.
 *
 * The detector is deliberately narrow: it looks for a KEY WITH A VALUE
 * and for well-known credential shapes. It does not flag the *name* of a
 * server-side variable, because telling a build script to read
 * `process.env.STRIPE_SECRET_KEY` is correct, and blocking it would make
 * the guard useless.
 * ==========================================================
 */

export interface SecretFinding {
  line: number;
  kind: string;
  /** The variable name, never its value. */
  name: string;
}

const CLIENT_PREFIX = /^(?:VITE_|NEXT_PUBLIC_|PUBLIC_|REACT_APP_|NUXT_PUBLIC_)/;
/** `VITE_KEY=value` / `VITE_KEY: "value"`, bare or inside a quoted string. */
const CLIENT_ENV_STYLE =
  /\b(VITE_[A-Z0-9_]{2,}|NEXT_PUBLIC_[A-Z0-9_]{2,})\s*[:=]\s*["']?([^\s"'`,;]{8,})/g;
const ASSIGNMENT = /\b([A-Z0-9_]{3,})\s*[:=]\s*["'`]([^"'`\s]{12,})["'`]/g;
const KNOWN_SHAPES: Array<{ kind: string; pattern: RegExp }> = [
  { kind: "private key", pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { kind: "OpenAI-style key", pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/ },
  { kind: "AWS access key", pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { kind: "GitHub token", pattern: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/ },
  { kind: "Supabase service role", pattern: /\bsb_secret_[A-Za-z0-9_-]{16,}\b/ },
  { kind: "generic bearer token", pattern: /\bBearer\s+[A-Za-z0-9_-]{24,}\b/ },
];

/**
 * What in this content would leak a credential to a browser.
 * Returns [] when the file is safe to write.
 */
export function scanForSecrets(content: string): SecretFinding[] {
  const findings: SecretFinding[] = [];
  const lines = content.split("\n");

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const lineNumber = index + 1;

    for (const shape of KNOWN_SHAPES) {
      if (shape.pattern.test(line)) {
        findings.push({ line: lineNumber, kind: shape.kind, name: shape.kind });
      }
    }

    CLIENT_ENV_STYLE.lastIndex = 0;
    let envMatch = CLIENT_ENV_STYLE.exec(line);
    while (envMatch) {
      findings.push({
        line: lineNumber,
        kind: "browser-exposed environment variable",
        name: envMatch[1],
      });
      envMatch = CLIENT_ENV_STYLE.exec(line);
    }

    ASSIGNMENT.lastIndex = 0;
    let match = ASSIGNMENT.exec(line);
    while (match) {
      const name = match[1];
      if (CLIENT_PREFIX.test(name)) {
        findings.push({
          line: lineNumber,
          kind: "browser-exposed environment variable",
          name,
        });
      }
      match = ASSIGNMENT.exec(line);
    }
  }

  return findings;
}

/** A refusal message that names the problem without repeating the value. */
export function describeSecretFindings(findings: readonly SecretFinding[]): string {
  const unique = [...new Map(findings.map((finding) => [finding.name + finding.line, finding])).values()];
  return unique
    .map((finding) => `line ${finding.line}: ${finding.kind} (${finding.name})`)
    .join("; ");
}

/** The studio refuses a write when this is non-empty. */
export function refuseReasonForWrite(content: string): string | null {
  const findings = scanForSecrets(content);
  if (findings.length === 0) return null;
  return (
    `Refused: this file would expose a credential to the browser (${describeSecretFindings(findings)}). ` +
    "Keep secrets on the server and read them from process.env; never inline them in frontend code."
  );
}
