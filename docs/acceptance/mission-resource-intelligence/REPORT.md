# Job 3 — LÉLU Autonomous Resource Intelligence & Self-Expansion

## Starting point
- Branch: `claude/lelu-integration-performance-eai80a`. Starting commit: `19614f7` (Job 1 / zero-spend, suite 2,130 pass / 0 fail).
- Job 2 was still running in another session when Job 3 started. Its branch `claude/lelu-open-source-expansion-qz626l` landed at `8d8435e` during this job, based on `184b9cd`. It was **merged, not overwritten** (`a681372`, no conflicts), and verified:
  - its tests (`creative-kit`) pass together with Job 3's;
  - its pinned dependency `mediabunny@1.66.0` was evaluated first (MPL-2.0, active, security low; evidence 16), then installed from the lockfile with scripts disabled;
  - the merged tree builds.
- Job 3 reuses the existing acquisition pipeline: Repo Executive, Executor, Engineering Council, ApprovalGate, CapabilityIntegrator, `/api/acquisition`. It adds no new orchestration framework, no LangGraph/LangChain, and no separate application.

## Files changed
New:
- `src/core/acquisition/ResourceIntelligence.ts` — deterministic judgement.
- `src/core/acquisition/ResourceTools.ts` — tools and the chat scan.
- `plugins/resourceApi.ts` — discovery, evidence, sandbox, audit and the promote gate.
- `src/core/world/WorldExport.ts` — the new STL/OBJ capability.
- `tests/resource-intelligence.test.ts`, `tests/resource-sandbox.test.ts`.

Changed:
- `server.ts`, `vite.config.ts` — mount the API.
- `plugins/acquisitionApi.ts` — pip installs are wheel-only into the acquisition folder.
- `CommandCenterToolDefinitions.ts`, `CommandCenterExecutors.ts` — layered tool registration.
- `world/WorldTools.ts` — `world.export`.
- `agents/AgentTemplates.ts`, `ExecutiveOwnership.ts` — Resource Intelligence agent, owned by Agent Forge.
- `router/AcquisitionResolver.ts` — no-model scan when no repository is named.
- `router/IntelligenceResolver.ts` — "find a tool" no longer answered from the stored catalog.
- `tools/ToolSchemas.ts` — chat routing hints.

## Discovery sources
All public, no key, $0:
- **npm registry**: search, manifests, release history.
- **GitHub**: search and repository metadata. Unauthenticated, so classed as free-limited and rate-limited. The remaining quota is reported and never bypassed.
- **GitLab**: project search. During the demo it answered 429; this is reported as unavailable.
- **PyPI**: evaluate by name.
- **OSV.dev**: known vulnerabilities.

Results are cached for 10 minutes. A deterministic relevance filter drops off-topic hits; one was dropped for "stl exporter".

## Resource evaluation
`evaluateResource` covers:
- **Class:** local, browser-native, public, free-limited, local-inference or paid. A free-limited resource is never described as unlimited.
- **License:** an SPDX expression; for an `A OR B` expression, the most permissive option counts. Obligations come from the license's risk class.
- **Maintenance:** from the real release date. When a package has more than 250 versions, the registry's last-modified date is used as a fallback.
- **Size and dependencies:** count and weight of runtime dependencies, unpacked size.
- **Install-time scripts:** only lifecycle scripts are judged. Piped downloads, eval or exfiltration patterns block the resource.
- **Security and compatibility:** OSV vulnerabilities, compatibility, and overlap with what is installed — including "installed only transitively: declare it before relying on it".

The result is a score and a verdict: recommended, acceptable, not-recommended or blocked. Paid, unknown-license and suspicious-install resources are blocked. Ranking prefers anything usable that is already installed over adding a new dependency.

## Capability gap detection
`detectCapabilityGaps` checks the request against 14 gap signatures, using the **live, executable** tool list. Examples:
- STL, OBJ and glTF export;
- LaTeX typesetting and function plots;
- QR codes;
- WebM and MP4 video;
- audio conversion, HEIC, PDF text;
- keyframe animation, FEA/CFD, arXiv.

Job 2's tools count as coverage: GLB → `creative.scene3d`, WebM → `creative.film`, plots → `creative.chart`, arXiv → `data.query`. Each gap names the installed modules that could close it, which are checked on disk, and the discovery queries to run.

## Sandbox and integration safeguards
Downloaded code never runs in the production runtime:
- **Install:** `npm install --ignore-scripts` into a throwaway folder. The environment carries only proxy/CA plumbing, with no keys. Packages over 40 MB are refused; paid or suspicious ones are refused before download.
- **Run:** a separate `node --permission` process inside a fresh network namespace (`unshare -rn`). It can read only its own folder, write only to its `out` folder, and has no child processes, workers or addons. Its environment is empty, it has a 20 s timeout and its output is capped. On hosts without network namespaces, a preload guard disables network APIs and the response says so.
- **Proof:** the escape probe (evidence 04) shows project read, system read, spawn and network all denied, with 0 secrets visible.
- **Promotion** requires all of:
  - a passing sandbox record;
  - a non-blocked evaluation;
  - the user's own approval.

  Without the record → 409 `not_verified`; without approval → 403 `approval_required` (evidence 09–10). Even with all three, it only records an integration plan (pinned version, `--ignore-scripts`, rollback via `git revert`) for the engineering workspace, which keeps its own approval and tests.
- **Acquisitions:** the existing pipeline's `pip install` now uses wheels only, into the acquisition folder, so `setup.py` cannot run.
- **Audit:** everything is logged to `.lelu-state/resources/log.jsonl` (gitignored, no secrets). Repository text is treated as data.

## Demonstrations
All runs were live against the running server and the production build. Evidence is in `evidence/`.

| # | Demonstration | Result |
|---|---|---|
| 1 | Real gap | "Export my sculpture as an STL" → `3d-export-stl` missing; installed `three` STLExporter found on disk (01) |
| 2 | ≥2 alternatives | npm + GitHub discovery, 9 relevant results (02) |
| 3 | Comparison | `three` (installed, MIT, active) recommended; `@jscad/stl-serializer` (MIT, 29 KB, 2 deps) recommended; `stl-exporter` and `threejs-export-stl` not recommended (abandoned 8–9 years) (03) |
| 4 | Isolated PoC | `@jscad/stl-serializer` installed in the sandbox (1.6 MB, 1.2 s, scripts off) → valid 12-facet STL; reused `three` → STL 364 facets + OBJ 2 objects in 80 ms (05, 06) |
| 5 | Registered capability | `world.export` (STL/OBJ) built on the installed three exporters — no new dependency. A live chat turn called `resources_register`, which checked the tool is executable and sandbox `mwgq81qd-bo8sl` passed (13) |
| 6 | Agent discovers and invokes it | Live chat: "Export the objects in my world as an STL…" → model chose `world_export` → `ok`, download link. Re-verified on the merged tree (11, 18) |
| 7 | Reuse, not duplication | Asking again for an STL library → "Already covered … world.export", with no search at all (14). MP4 gap → names Job 2's installed `mediabunny` as reusable (17) |
| 8 | Untrusted code gated | Escape probe denied everything (04); promotion refused unverified / unapproved (09, 10) |
| 9 | Paid blocked | `openai` and `replicate` evaluated BLOCKED (score capped); sandbox install of `replicate` refused before download (07, 08) |
| 10 | No unnecessary LLM calls | Gap detection, discovery, evaluation, sandbox and audit return `modelCalls: 0`. The LaTeX and MP4 chat scans were answered by the existing `AcquisitionResolver` with no model request during the turn (12, 17) |

Continuous improvement: `resources.audit` checked LÉLU's 42 direct dependencies (15). It found:
- 0 known vulnerabilities in the installed versions;
- 2 abandoned (`exceljs` 1,121 days, `pdf-lib` 1,833 days);
- 4 major versions behind;
- 2 paid-API SDKs (gated by the spend policy);
- 27 packages with more than two installed copies.

Nothing is replaced automatically. Discovery runs on demand, from chat or the tools, and when a gap is detected. It is cached and never runs as a background crawl.

## LLM / API usage avoided
- Every judgement is deterministic; source scans confirm none of the resource modules reaches a model API.
- In chat, "find a free open-source tool…" and "what are you missing…" are answered by the existing acquisition resolver with 0 model calls. Before this change, the same LaTeX request was either answered from an unrelated stored catalog, or turned into a GitHub search with the whole sentence as the query, which found nothing.
- Only free public endpoints are used; nothing paid was called.

## Performance and storage impact
- **New dependencies:** none. STL/OBJ reuse the installed `three`.
- **Bundle:** about 64 KB of new lazy-loaded chunks; nothing added to cold boot.
- **Sandbox:** installed code is deleted after each run, leaving only records (20 runs = 304 KB plus 56 KB of logs). Run time 70–95 ms; npm install 1.2 s for a 1.6 MB package.

## Test results
- Typecheck: 0 errors. Lint: 0 errors (pre-existing warnings in archived scripts only). Production build: passes on the merged tree.
- Full suite at the final commit: **2,167 tests — 2,161 pass, 0 fail, 6 skipped** (Job 1 baseline 2,130 pass; Job 2 and Job 3 tests added).
- Job 3 suites: `resource-intelligence` (9) and `resource-sandbox` (6) — classification, SPDX, install-script inspection, verdicts and ranking, gap detection with Job 2 coverage, the dependency audit, the routing fix, STL/OBJ export, sandbox isolation (live escape probe), installed-module reuse, failure reporting, registration, and no model calls.
- Security checks:
  - OSV vulnerability audit of all direct dependencies (0 known in the installed versions);
  - a secret-pattern scan of every new file and evidence file (0 hits);
  - the existing credential-exposure and spend-policy suites pass.

  Semgrep, Trivy and Gitleaks are not installed in this container, so they were not run.
- Not verified: GitLab discovery during the demo (rate-limited, 429); MP4 encoding itself (gap detection and reuse identification only — no MP4 capability was built); capability registration is stored per browser (CapabilityRegistry in localStorage), so the registration demo's record lives in that browser profile.
