/**
 * The build this page is running, as compiled in by vite.config.ts
 * (plugins/buildInfo.ts). Undefined outside a Vite build (node tests).
 */
export interface BuildInfo {
  sha: string;
  shortSha: string;
  branch: string;
  dirty: boolean;
  builtAt: string;
  mode: string;
  source: string;
}

declare const __LELU_BUILD__: BuildInfo | undefined;

export function buildInfo(): BuildInfo {
  return typeof __LELU_BUILD__ !== "undefined"
    ? __LELU_BUILD__
    : { sha: "unknown", shortSha: "unknown", branch: "unknown", dirty: false, builtAt: "", mode: "unknown", source: "none" };
}

/** One line: what to read off a phone screen. */
export function buildLabel(info: BuildInfo = buildInfo()): string {
  const when = info.builtAt ? info.builtAt.replace("T", " ").slice(0, 16) + "Z" : "?";
  return `LÉLU ${info.shortSha}${info.dirty ? "+dirty" : ""} · ${info.branch} · ${info.mode} · built ${when}`;
}
