/**
 * ==========================================================
 * LÉLU — RESOURCE INTELLIGENCE (deterministic half)
 *
 * The judgement LÉLU applies to a resource BEFORE she recommends or
 * integrates it, and the recognition of a capability she lacks. Every
 * function here is pure: structured metadata in (registry manifests,
 * repository metadata, vulnerability counts, the request text), a
 * verdict out. No model call, no network — the server half
 * (plugins/resourceApi.ts) fetches the evidence from public no-key
 * endpoints and the existing acquisition pipeline (RepoExecutive,
 * RepoExecutor, EngineeringCouncil, ApprovalGate, CapabilityIntegrator)
 * remains the path into production.
 *
 * Classes (never "unlimited" — a free service with a quota is
 * "free-limited" and says so):
 *   local            runs without any external service
 *   browser-native   uses the device/browser's own capabilities
 *   public           a public endpoint that needs no key
 *   free-limited     free, but quota/rate/usage restricted or key-gated
 *   local-inference  needs a model and local compute
 *   paid             needs payment or paid inference (spend policy applies)
 * ==========================================================
 */
import { licenseObligations, licenseRisk, type LicenseRisk } from "./AcquisitionTypes.ts";

export type ResourceClass = "local" | "browser-native" | "public" | "free-limited" | "local-inference" | "paid";

export const RESOURCE_CLASS_MEANING: Record<ResourceClass, string> = {
  local: "Executes without an external service",
  "browser-native": "Uses device/browser capabilities",
  public: "Uses a public no-key endpoint (availability not guaranteed)",
  "free-limited": "Free but quota- or usage-restricted — not unlimited",
  "local-inference": "Requires a model and local compute",
  paid: "Requires payment or paid inference — blocked without your explicit authorization",
};

/** What the server gathered about one resource. Every field is optional: missing evidence is reported, never guessed. */
export interface ResourceEvidence {
  source: "npm" | "github" | "gitlab" | "pypi" | "installed";
  name: string;
  url?: string;
  description?: string;
  keywords?: string[];
  license?: string;
  latestVersion?: string;
  /** ISO time of the latest release / push. */
  lastRelease?: string;
  firstRelease?: string;
  releaseCount?: number;
  archived?: boolean;
  deprecated?: string;
  stars?: number;
  dependencies?: string[];
  peerDependencies?: string[];
  unpackedSize?: number;
  /** The registry's dist.integrity for latestVersion (sha512). */
  integrity?: string;
  scripts?: Record<string, string>;
  engines?: Record<string, string>;
  /** Known vulnerabilities for the evaluated version (OSV). */
  vulnerabilities?: number;
  readmeExcerpt?: string;
  /** Already installed in LÉLU (node_modules / package.json). */
  installed?: boolean;
  installedVersion?: string;
  /** Declared in LÉLU's own package.json (false: only present as another package's dependency). */
  installedDeclared?: boolean;
}

/* ----------------------------------------------------------------------------
 * License normalisation (registry strings → the SPDX ids licenseRisk knows)
 * -------------------------------------------------------------------------- */

const EXTRA_PERMISSIVE = new Set(["BLUEOAK-1.0.0", "PYTHON-2.0", "ZLIB", "WTFPL", "BSD", "APACHE 2.0", "APACHE2", "APACHE-2"]);
const RISK_ORDER: LicenseRisk[] = ["permissive", "weak-copyleft", "copyleft", "unknown"];

/** The most permissive reading of an SPDX expression (an "OR" lets LÉLU pick). */
export function resourceLicenseRisk(raw: string | undefined): { spdx: string; risk: LicenseRisk } {
  const spdx = (raw ?? "").trim() || "UNKNOWN";
  const options = spdx.replace(/[()]/g, "").split(/\s+OR\s+/i).map((part) =>
    part.trim().replace(/-(only|or-later)$/i, "").replace(/\+$/, ""),
  );
  let best: LicenseRisk = "unknown";
  for (const option of options) {
    const risk = EXTRA_PERMISSIVE.has(option.toUpperCase()) ? "permissive" : licenseRisk(option);
    if (RISK_ORDER.indexOf(risk) < RISK_ORDER.indexOf(best)) best = risk;
  }
  return { spdx, risk: best };
}

/* ----------------------------------------------------------------------------
 * Classification
 * -------------------------------------------------------------------------- */

/** SDKs whose purpose is a paid hosted API. Their presence makes a resource paid. */
const PAID_SDKS = [
  /^openai$/, /^@anthropic-ai\//, /^replicate$/, /^@google\/generative-ai$/, /^@google\/genai$/, /^elevenlabs$/,
  /^@elevenlabs\//, /^cohere-ai$/, /^@mistralai\//, /^@fal-ai\//, /^stability-ai/, /^@aws-sdk\//, /^@azure\//,
  /^twilio$/, /^stripe$/, /^@deepgram\//, /^assemblyai$/, /^groq-sdk$/, /^together-ai$/, /^@runwayml\//,
];
const LOCAL_INFERENCE = [
  /^onnxruntime/, /^@xenova\/transformers$/, /^@huggingface\/transformers$/, /^@mlc-ai\//, /^@tensorflow\//,
  /^node-llama-cpp$/, /^whisper/, /^@mediapipe\//, /^ml5$/, /^brain\.js$/, /^@wllama\//,
];
const BROWSER_HINTS = /\b(browser|webgl|webgpu|wasm|webassembly|canvas|web ?audio|web ?worker|indexeddb|dom)\b/i;
const NODE_ONLY = /^(fs-extra|node-gyp|sharp|canvas|puppeteer|playwright|better-sqlite3)$/;
const PRICING_TEXT = /\b(pricing|paid plan|subscription|billing|credits? (?:are|per)|per (?:request|call|minute) (?:fee|cost)|enterprise plan)\b/i;
const LIMITED_TEXT = /\b(api[ -]?key|access token|sign ?up|rate[- ]limit|quota|free tier|requests? per (?:day|month|minute))\b/i;
const PUBLIC_TEXT = /\b(no (?:api )?key (?:required|needed)|public api|open endpoint|keyless)\b/i;
const MODEL_TEXT = /\b(model weights|\.gguf|\.onnx|download(?:s|ing)? (?:the )?model|inference)\b/i;

export interface Classification {
  class: ResourceClass;
  reasons: string[];
}

export function classifyResource(evidence: ResourceEvidence): Classification {
  const deps = [...(evidence.dependencies ?? []), ...(evidence.peerDependencies ?? [])];
  const text = `${evidence.description ?? ""} ${(evidence.keywords ?? []).join(" ")} ${evidence.readmeExcerpt ?? ""}`;
  const paidDeps = deps.filter((dep) => PAID_SDKS.some((pattern) => pattern.test(dep)));
  if (paidDeps.length || PAID_SDKS.some((pattern) => pattern.test(evidence.name))) {
    return { class: "paid", reasons: [`depends on a paid API SDK: ${(paidDeps.length ? paidDeps : [evidence.name]).join(", ")}`] };
  }
  if (PRICING_TEXT.test(text)) return { class: "paid", reasons: ["its own description mentions pricing, billing or a paid plan"] };
  const inference = deps.filter((dep) => LOCAL_INFERENCE.some((pattern) => pattern.test(dep)));
  if (inference.length || MODEL_TEXT.test(text)) {
    return {
      class: "local-inference",
      reasons: [inference.length ? `runs a model locally via ${inference.join(", ")}` : "its description says it downloads or runs a model"],
    };
  }
  if (LIMITED_TEXT.test(text)) return { class: "free-limited", reasons: ["needs a key or sign-up, or names a rate limit/quota"] };
  if (PUBLIC_TEXT.test(text)) return { class: "public", reasons: ["describes a public endpoint that needs no key"] };
  if (BROWSER_HINTS.test(text) && !deps.some((dep) => NODE_ONLY.test(dep))) {
    return { class: "browser-native", reasons: ["built on browser capabilities (canvas/WebGL/WASM/Web Audio)"] };
  }
  return { class: "local", reasons: ["no network, key, model or paid dependency was found in its metadata"] };
}

/* ----------------------------------------------------------------------------
 * Install-script inspection
 * -------------------------------------------------------------------------- */

const LIFECYCLE = ["preinstall", "install", "postinstall", "prepare", "prepublish"];
const SUSPICIOUS: Array<[RegExp, string]> = [
  [/\b(curl|wget)\b[^|]*\|\s*(sh|bash|node)/i, "pipes a download straight into a shell"],
  [/\b(curl|wget|Invoke-WebRequest)\b/i, "downloads during install"],
  [/\beval\s*\(|new Function\s*\(/, "evaluates generated code"],
  [/base64\s*(-d|--decode)|Buffer\.from\([^)]*base64/i, "decodes an embedded payload"],
  [/node\s+-e\b|python3?\s+-c\b/, "runs inline code"],
  [/\bpowershell\b|\bcmd\.exe\b/i, "invokes a system shell"],
  [/\brm\s+-rf\s+[~/]/, "deletes outside its own folder"],
  [/process\.env[\s\S]{0,80}(fetch|https?\.request)/, "reads the environment and sends it over the network"],
  [/chmod\s+\+x|sudo\b/, "changes permissions / escalates"],
];

export interface InstallRisk {
  lifecycle: string[];
  suspicious: Array<{ script: string; finding: string }>;
  risk: "none" | "low" | "high";
}

export function inspectInstallScripts(scripts: Record<string, string> | undefined): InstallRisk {
  const lifecycle = LIFECYCLE.filter((name) => scripts?.[name]);
  const suspicious: InstallRisk["suspicious"] = [];
  // Only install-time scripts run when a package is installed; a dev
  // script such as "test:perf" never runs on a consumer's machine.
  for (const name of lifecycle) {
    for (const [pattern, finding] of SUSPICIOUS) if (pattern.test(scripts![name])) suspicious.push({ script: name, finding });
  }
  return { lifecycle, suspicious, risk: suspicious.length ? "high" : lifecycle.length ? "low" : "none" };
}

/* ----------------------------------------------------------------------------
 * Evaluation
 * -------------------------------------------------------------------------- */

export interface ResourceEvaluation {
  name: string;
  source: ResourceEvidence["source"];
  version?: string;
  classification: Classification;
  license: { spdx: string; risk: LicenseRisk; obligations: string[] };
  maintenance: { status: "active" | "slow" | "stale" | "abandoned" | "unknown"; daysSinceRelease?: number; archived: boolean; deprecated?: string; releases?: number };
  dependencies: { count: number; weight: "none" | "light" | "moderate" | "heavy" };
  size: { bytes?: number; label: string };
  security: { installRisk: InstallRisk; vulnerabilities?: number; risk: "low" | "medium" | "high"; observations: string[] };
  overlap: { installed: boolean; installedVersion?: string; note?: string };
  compatibility: string[];
  /** 0..1, derived from the fields above. */
  score: number;
  verdict: "recommended" | "acceptable" | "not-recommended" | "blocked";
  reasons: string[];
}

const DAY = 86_400_000;

export function evaluateResource(evidence: ResourceEvidence, now = Date.now()): ResourceEvaluation {
  const classification = classifyResource(evidence);
  const { spdx, risk } = resourceLicenseRisk(evidence.license);
  const reasons: string[] = [];

  const last = evidence.lastRelease ? Date.parse(evidence.lastRelease) : NaN;
  const days = Number.isFinite(last) ? Math.floor((now - last) / DAY) : undefined;
  const archived = Boolean(evidence.archived);
  const status: ResourceEvaluation["maintenance"]["status"] =
    archived || evidence.deprecated ? "abandoned" : days === undefined ? "unknown" : days <= 180 ? "active" : days <= 540 ? "slow" : days <= 1100 ? "stale" : "abandoned";

  const depCount = evidence.dependencies?.length ?? 0;
  const weight = depCount === 0 ? "none" : depCount <= 3 ? "light" : depCount <= 12 ? "moderate" : "heavy";
  const bytes = evidence.unpackedSize;
  const sizeLabel = bytes === undefined ? "unknown size" : bytes < 1_000_000 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1_048_576).toFixed(1)} MB`;

  const installRisk = inspectInstallScripts(evidence.scripts);
  const observations: string[] = [];
  if (installRisk.lifecycle.length) observations.push(`install-time scripts: ${installRisk.lifecycle.join(", ")} (never run here: installs use --ignore-scripts)`);
  for (const s of installRisk.suspicious) observations.push(`${s.script}: ${s.finding}`);
  if (evidence.vulnerabilities) observations.push(`${evidence.vulnerabilities} known vulnerabilit${evidence.vulnerabilities === 1 ? "y" : "ies"} (OSV)`);
  if (archived) observations.push("repository is archived");
  if (evidence.deprecated) observations.push(`deprecated: ${evidence.deprecated.slice(0, 120)}`);
  const securityRisk = installRisk.risk === "high" || (evidence.vulnerabilities ?? 0) > 0 ? "high" : installRisk.risk === "low" || weight === "heavy" ? "medium" : "low";

  const compatibility: string[] = [];
  const node = evidence.engines?.node;
  if (node) compatibility.push(`declares node ${node}`);
  if (evidence.dependencies?.some((dep) => NODE_ONLY.test(dep))) compatibility.push("has native/Node-only dependencies: server-side only");
  if (classification.class === "browser-native") compatibility.push("can run in LÉLU's browser runtime");

  const overlap = evidence.installed
    ? {
        installed: true,
        installedVersion: evidence.installedVersion,
        note: evidence.installedDeclared === false
          ? "installed only as another package's dependency — reusable, but declare it explicitly before relying on it"
          : "already installed in LÉLU — reuse it instead of adding a dependency",
      }
    : { installed: false };

  const recency = status === "active" ? 1 : status === "slow" ? 0.7 : status === "stale" ? 0.35 : status === "unknown" ? 0.5 : 0;
  const lic = risk === "permissive" ? 1 : risk === "weak-copyleft" ? 0.6 : risk === "copyleft" ? 0.2 : 0;
  const sec = securityRisk === "low" ? 1 : securityRisk === "medium" ? 0.6 : 0.1;
  const deps = weight === "none" ? 1 : weight === "light" ? 0.85 : weight === "moderate" ? 0.6 : 0.3;
  const size = bytes === undefined ? 0.6 : bytes < 500_000 ? 1 : bytes < 5_000_000 ? 0.75 : bytes < 50_000_000 ? 0.45 : 0.15;
  const cls = { local: 1, "browser-native": 1, public: 0.8, "free-limited": 0.5, "local-inference": 0.6, paid: 0 }[classification.class];
  let score = 0.22 * lic + 0.2 * recency + 0.2 * sec + 0.13 * deps + 0.1 * size + 0.15 * cls;
  if (overlap.installed) score = Math.min(1, score + 0.1);
  score = Math.round(score * 100) / 100;

  let verdict: ResourceEvaluation["verdict"];
  if (classification.class === "paid") {
    verdict = "blocked";
    reasons.push("paid: needs your explicit authorization before any use (spend policy)");
  } else if (risk === "unknown") {
    verdict = "blocked";
    reasons.push("no recognised license: cannot be integrated until clarified");
  } else if (installRisk.risk === "high") {
    verdict = "blocked";
    reasons.push("suspicious install-time behaviour");
  } else if (status === "abandoned" || risk === "copyleft" || securityRisk === "high") {
    verdict = "not-recommended";
    if (status === "abandoned") reasons.push("abandoned, archived or deprecated upstream");
    if (risk === "copyleft") reasons.push("copyleft obligations would apply to LÉLU's distribution");
    if (securityRisk === "high") reasons.push("known vulnerabilities");
  } else {
    verdict = score >= 0.75 ? "recommended" : "acceptable";
  }
  // A blocked resource cannot read as a strong candidate.
  if (verdict === "blocked") score = Math.min(score, 0.2);
  if (classification.class === "free-limited") reasons.push("free but limited — not unlimited capacity");
  if (overlap.installed) reasons.push(evidence.installedDeclared === false ? `installed ${evidence.installedVersion ?? ""} transitively: no download needed, but declare it before relying on it`.replace("  ", " ") : "already installed: no new dependency needed");

  return {
    name: evidence.name,
    source: evidence.source,
    version: evidence.latestVersion,
    classification,
    license: { spdx, risk, obligations: licenseObligations(({ permissive: "MIT", "weak-copyleft": "MPL-2.0", copyleft: "GPL-3.0", unknown: spdx } as Record<LicenseRisk, string>)[risk]) },
    maintenance: { status, daysSinceRelease: days, archived, deprecated: evidence.deprecated, releases: evidence.releaseCount },
    dependencies: { count: depCount, weight },
    size: { bytes, label: sizeLabel },
    security: { installRisk, vulnerabilities: evidence.vulnerabilities, risk: securityRisk, observations },
    overlap,
    compatibility,
    score,
    verdict,
    reasons,
  };
}

/** Best first: never-blocked before blocked, installed (reuse) before new, then score. */
export function rankEvaluations(evaluations: ResourceEvaluation[]): ResourceEvaluation[] {
  // Any usable resource already installed beats adding a new one.
  const rank = { recommended: 0, acceptable: 0, "not-recommended": 2, blocked: 3 } as const;
  return [...evaluations].sort(
    (a, b) => rank[a.verdict] - rank[b.verdict] || Number(b.overlap.installed) - Number(a.overlap.installed) || b.score - a.score,
  );
}

/** One line per evaluation, for chat. */
export function describeEvaluation(e: ResourceEvaluation): string {
  return (
    `${e.name}${e.version ? `@${e.version}` : ""} [${e.source}] — ${e.verdict.toUpperCase()} (score ${e.score}). ` +
    `${e.classification.class}: ${RESOURCE_CLASS_MEANING[e.classification.class]}. ` +
    `License ${e.license.spdx} (${e.license.risk}); maintenance ${e.maintenance.status}` +
    `${e.maintenance.daysSinceRelease !== undefined ? ` (last release ${e.maintenance.daysSinceRelease} d ago)` : ""}; ` +
    `${e.dependencies.count} runtime deps (${e.dependencies.weight}); ${e.size.label}; security ${e.security.risk}` +
    `${e.security.observations.length ? ` — ${e.security.observations.join("; ")}` : ""}.` +
    `${e.reasons.length ? ` ${e.reasons.join("; ")}.` : ""}`
  );
}

/* ----------------------------------------------------------------------------
 * Capability gap detection
 * -------------------------------------------------------------------------- */

export interface GapSignature {
  id: string;
  label: string;
  match: RegExp;
  /** LÉLU tools that, when registered and available, satisfy it. */
  tools: string[];
  /** Already-installed modules that could provide it (checked on disk by the server). */
  reuse: string[];
  /** Discovery queries for open-source alternatives. */
  search: string[];
  /**
   * A curated proof of concept for the installed reuse candidate: an ES
   * module run in the sandbox that prints its evidence and exits non-zero on
   * failure. With it, the whole lifecycle up to "awaiting approval" runs
   * without a model writing code.
   */
  proof?: string;
}

/** Browser FileReader for Node, so three's GLTFExporter can be proven in the sandbox. */
const FILE_READER_SHIM =
  "globalThis.FileReader=class{readAsArrayBuffer(b){b.arrayBuffer().then(r=>{this.result=r;this.onloadend&&this.onloadend()})}" +
  "readAsDataURL(b){b.arrayBuffer().then(r=>{this.result='data:application/octet-stream;base64,'+Buffer.from(r).toString('base64');this.onloadend&&this.onloadend()})}};";

const PROOF_GLB =
  FILE_READER_SHIM +
  "const T=await import('three');const {GLTFExporter}=await import('three/examples/jsm/exporters/GLTFExporter.js');" +
  "const g=new T.Group();const a=new T.Mesh(new T.BoxGeometry(1,1,1));const b=new T.Mesh(new T.SphereGeometry(0.5,16,12));b.position.set(2,0,0);g.add(a,b);" +
  "const glb=await new GLTFExporter().parseAsync(g,{binary:true});const v=new DataView(glb);" +
  "const ok=v.getUint32(0,true)===0x46546c67&&v.getUint32(4,true)===2;console.log(JSON.stringify({glbBytes:glb.byteLength,magic:'glTF',version:2,meshes:2,ok}));if(!ok)process.exit(1);";

const PROOF_STL =
  "const T=await import('three');const {STLExporter}=await import('three/examples/jsm/exporters/STLExporter.js');" +
  "const s=new T.Scene();s.add(new T.Mesh(new T.BoxGeometry(1,1,1)));s.updateMatrixWorld(true);" +
  "const n=(new STLExporter().parse(s).match(/facet normal/g)||[]).length;console.log(JSON.stringify({stlFacets:n}));if(n!==12)process.exit(1);";

export const GAP_SIGNATURES: GapSignature[] = [
  { id: "3d-export-stl", label: "Export 3D objects as STL (3D printing)", match: /\b(stl|3d[- ]?print\w*)\b/i, tools: ["world.export"], reuse: ["three/examples/jsm/exporters/STLExporter.js"], search: ["stl exporter", "stl serializer"], proof: PROOF_STL },
  { id: "3d-export-obj", label: "Export 3D objects as Wavefront OBJ", match: /\b(\.obj|obj file|wavefront)\b/i, tools: ["world.export"], reuse: ["three/examples/jsm/exporters/OBJExporter.js"], search: ["obj exporter 3d", "wavefront obj writer"] },
  { id: "world-export-gltf", label: "Export my world's objects as glTF/GLB", match: /(?:\b(?:world|room|environment|objects?|scene i built)\b.{0,60}\b(?:gltf|glb)\b|\b(?:gltf|glb)\b.{0,60}\b(?:world|room|environment|objects)\b)/i, tools: ["world.gltf"], reuse: ["three/examples/jsm/exporters/GLTFExporter.js"], search: ["gltf exporter", "gltf transform"], proof: PROOF_GLB },
  { id: "3d-export-gltf", label: "Export 3D scenes as glTF/GLB", match: /\b(gltf|glb)\b/i, tools: ["creative.scene3d", "creative.export"], reuse: ["three/examples/jsm/exporters/GLTFExporter.js"], search: ["gltf exporter", "gltf transform"] },
  { id: "math-typesetting", label: "Typeset LaTeX math", match: /\b(latex|katex|typeset\w*|equation rendering)\b/i, tools: ["math.render"], reuse: ["katex/dist/katex.mjs"], search: ["latex math renderer", "math typesetting"] },
  { id: "function-plot", label: "Plot mathematical functions", match: /\b(plot|graph)\s+(?:the\s+)?(?:function|equation|y\s*=|f\(x\))/i, tools: ["math.plot", "creative.chart"], reuse: [], search: ["function plot", "math function graph"] },
  { id: "qr-code", label: "Generate QR codes", match: /\bqr[- ]?codes?\b/i, tools: ["qr.create"], reuse: [], search: ["qr code generator", "qrcode svg"] },
  { id: "video-webm", label: "Render a short video (WebM)", match: /\b(webm|encode (?:a |the )?video|render (?:a |the )?video|make (?:a |the )?(?:short )?(?:video|film))\b/i, tools: ["creative.film", "media.encode"], reuse: [], search: ["webm encoder", "webcodecs muxer"] },
  { id: "video-mp4", label: "Write MP4 video", match: /\bmp4\b/i, tools: ["media.mp4"], reuse: ["mediabunny/package.json"], search: ["mp4 muxer", "ffmpeg wasm"] },
  { id: "audio-convert", label: "Convert audio formats", match: /\b(mp3|wav|ogg|flac)\b.{0,20}\b(to|into)\b/i, tools: ["media.convert"], reuse: [], search: ["audio encoder wasm", "mp3 encoder"] },
  { id: "image-heic", label: "Read HEIC/HEIF images", match: /\bhei[cf]\b/i, tools: ["media.convert"], reuse: [], search: ["heic decoder", "heic to jpeg"] },
  { id: "pdf-text", label: "Extract text from PDFs", match: /\b(read|parse|extract)\b.{0,30}\bpdf\b/i, tools: ["pdf.read", "studio.read"], reuse: ["pdfjs-dist/build/pdf.mjs"], search: ["pdf text extraction", "pdf parser"] },
  { id: "animation-keyframes", label: "Keyframe animation of 3D objects", match: /\b(keyframes?|animate (?:the|this|my|a) (?:object|model|cube|sphere))\b/i, tools: ["world.animate"], reuse: ["gsap/dist/gsap.js"], search: ["keyframe animation library", "tween engine"] },
  { id: "engineering-fea", label: "Structural / fluid simulation (FEA/CFD)", match: /\b(finite element|\bfea\b|stress analysis|cfd|fluid (?:dynamics|simulation))\b/i, tools: ["sim.fea"], reuse: [], search: ["finite element javascript", "fea solver wasm"] },
  { id: "arxiv-papers", label: "Read research papers from arXiv", match: /\barxiv\b/i, tools: ["research.arxiv", "data.query"], reuse: [], search: ["arxiv api client"] },
];

export interface GapReport {
  /** Signatures the request touches. */
  touched: string[];
  /** Touched and already covered by an available tool. */
  covered: Array<{ id: string; label: string; tool: string }>;
  /** Touched and not covered: the real gaps. */
  missing: Array<{ id: string; label: string; reuse: string[]; search: string[]; tools: string[]; proof?: string }>;
}

/**
 * What a request needs that LÉLU cannot do right now. `availableTools` is
 * the live tool registry (ids of executable tools), so a capability
 * registered later stops being a gap without changing this code.
 */
export function detectCapabilityGaps(request: string, availableTools: Iterable<string>): GapReport {
  const tools = new Set(availableTools);
  const report: GapReport = { touched: [], covered: [], missing: [] };
  for (const sig of GAP_SIGNATURES) {
    if (!sig.match.test(request)) continue;
    report.touched.push(sig.id);
    const tool = sig.tools.find((id) => tools.has(id));
    if (tool) report.covered.push({ id: sig.id, label: sig.label, tool });
    else report.missing.push({ id: sig.id, label: sig.label, reuse: sig.reuse, search: sig.search, tools: sig.tools, proof: sig.proof });
  }
  return report;
}

/* ----------------------------------------------------------------------------
 * Continuous improvement: dependency audit analysis
 * -------------------------------------------------------------------------- */

export interface DependencyFact {
  name: string;
  declared: string;
  installed?: string;
  latest?: string;
  deprecated?: string;
  vulnerabilities?: number;
  lastRelease?: string;
  license?: string;
}

export interface AuditFinding {
  name: string;
  kind: "vulnerable" | "deprecated" | "abandoned" | "major-behind" | "paid-sdk" | "duplicate" | "license";
  detail: string;
}

const major = (version: string | undefined): number | undefined => {
  const m = /(\d+)\./.exec(version ?? "");
  return m ? Number(m[1]) : undefined;
};

/**
 * Findings only — nothing is replaced automatically. Each one is a reason
 * to compare, test and keep a rollback, never an instruction to upgrade.
 */
export function analyzeDependencies(facts: DependencyFact[], duplicates: Record<string, string[]> = {}, now = Date.now()): AuditFinding[] {
  const findings: AuditFinding[] = [];
  for (const fact of facts) {
    if (fact.vulnerabilities) findings.push({ name: fact.name, kind: "vulnerable", detail: `${fact.vulnerabilities} known vulnerabilit${fact.vulnerabilities === 1 ? "y" : "ies"} in ${fact.installed ?? fact.declared}` });
    if (fact.deprecated) findings.push({ name: fact.name, kind: "deprecated", detail: fact.deprecated.slice(0, 160) });
    const last = fact.lastRelease ? Date.parse(fact.lastRelease) : NaN;
    if (Number.isFinite(last) && now - last > 1100 * DAY) findings.push({ name: fact.name, kind: "abandoned", detail: `no release for ${Math.floor((now - last) / DAY)} days` });
    const have = major(fact.installed ?? fact.declared.replace(/^[\^~>=<\s]+/, ""));
    const latest = major(fact.latest);
    if (have !== undefined && latest !== undefined && latest > have) findings.push({ name: fact.name, kind: "major-behind", detail: `${fact.installed ?? fact.declared} → ${fact.latest} (compare and test before changing)` });
    if (PAID_SDKS.some((pattern) => pattern.test(fact.name))) findings.push({ name: fact.name, kind: "paid-sdk", detail: "client SDK for a paid API: calls through it are gated by the spend policy (it may also serve free compatible endpoints — check usage before removing)" });
    const lic = fact.license ? resourceLicenseRisk(fact.license) : undefined;
    if (lic && lic.risk !== "permissive") findings.push({ name: fact.name, kind: "license", detail: `${lic.spdx} (${lic.risk})` });
  }
  for (const [name, versions] of Object.entries(duplicates)) {
    if (versions.length > 1) findings.push({ name, kind: "duplicate", detail: `${versions.length} copies installed: ${versions.slice(0, 6).join(", ")}` });
  }
  return findings;
}
