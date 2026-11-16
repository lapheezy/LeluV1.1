/**
 * The guard shared by both M14.5 real-cloud harnesses.
 *
 * Only the isolated lelu-v11-test project is accepted. This is intentionally
 * stricter than "a URL with a matching ref": a production ref supplied by
 * mistake is refused before a client is created.
 */
export const M145_TEST_PROJECT_REF = "ugshflwlyakipeduifkd";

const TEST_URL_PREFIXES = [
  `https://${M145_TEST_PROJECT_REF}.supabase.co`,
  `https://${M145_TEST_PROJECT_REF}.supabase.in`,
];

export function validateM145Target({ url, projectRef, publishableKey, allowReal }) {
  if (allowReal !== "1" && allowReal !== true) {
    return {
      ok: false,
      status: "BLOCKED",
      reason: "LELU_M145_ALLOW_REAL is not 1; real cloud execution is opt-in.",
    };
  }
  const missing = [
    ["LELU_M145_SUPABASE_URL", url],
    ["LELU_M145_SUPABASE_PUBLISHABLE_KEY", publishableKey],
    ["LELU_M145_PROJECT_REF", projectRef],
  ].filter(([, value]) => !value).map(([name]) => name);
  if (missing.length > 0) {
    return { ok: false, status: "BLOCKED", reason: `Missing ${missing.join(", ")}.`, missing };
  }
  if (projectRef !== M145_TEST_PROJECT_REF) {
    return {
      ok: false,
      status: "FAIL",
      reason: `Refusing to run: ${projectRef} is not the isolated ${M145_TEST_PROJECT_REF} test project.`,
    };
  }
  if (!TEST_URL_PREFIXES.some((prefix) => url === prefix || url.startsWith(`${prefix}/`))) {
    return {
      ok: false,
      status: "FAIL",
      reason: "Refusing to run: the URL is not the isolated lelu-v11-test project URL.",
    };
  }
  return { ok: true, projectRef };
}
