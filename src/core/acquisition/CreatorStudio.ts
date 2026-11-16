/**
 * ==========================================================
 * LÉLU — CREATOR STUDIO
 *
 * The engineering workforce is not only for acquiring other
 * people's repositories. This turns a stated objective into a real
 * project: a plan with files, written through the SAME engineering
 * workspace runtime (`/api/engineer`) the rest of LÉLU uses,
 * validated by the real toolchain, diffed against the workspace and
 * optionally applied after a named approval.
 *
 * There is no template fantasy here: the generated files are
 * ordinary, runnable HTML/CSS/JS or Node source. When the runtime is
 * unreachable the creation reports that, rather than pretending a
 * workspace was written.
 * ==========================================================
 */

import EngineeringWorkspace from "../engineering/EngineeringWorkspace";

export type CreatorKind = "website" | "tool" | "api" | "agent" | "dashboard" | "game";

export interface CreatorFile {
  path: string;
  content: string;
}

export interface CreatorPlan {
  id: string;
  objective: string;
  kind: CreatorKind;
  slug: string;
  title: string;
  files: CreatorFile[];
  steps: string[];
  createdAt: number;
}

export interface CreatorCreateResult {
  ok: boolean;
  workspaceId?: string;
  written: string[];
  validation?: { ok: boolean; exitCode: number; output: string; durationMs: number };
  changed?: number;
  error?: string;
  plan: CreatorPlan;
}

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 42) || "lelu-project"
  );
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

export default class CreatorStudio {
  private static instance: CreatorStudio | null = null;

  static getInstance(): CreatorStudio {
    if (!CreatorStudio.instance) CreatorStudio.instance = new CreatorStudio();
    return CreatorStudio.instance;
  }

  static resetForTests(): void {
    CreatorStudio.instance = null;
  }

  /** A deterministic, auditable plan. No model is required to plan. */
  plan(objective: string, kind: CreatorKind = "website"): CreatorPlan {
    const trimmed = objective.trim();
    if (!trimmed) throw new Error("A creator objective is required.");
    const slug = slugify(trimmed);
    const root = `lelu-creator/${slug}`;
    const title = trimmed.length > 70 ? `${trimmed.slice(0, 67)}…` : trimmed;
    const safeTitle = escapeHtml(title);
    const files: CreatorFile[] = [];
    const steps = [
      `Interpret the objective as a ${kind}.`,
      "Write the project files into an isolated engineering workspace copy.",
      "Run the real workspace typecheck and record its exit code.",
      "Diff the copy against the project before anything is applied.",
    ];

    if (kind === "website") {
      files.push({
        path: `${root}/index.html`,
        content: `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${safeTitle}</title>
    <link rel="stylesheet" href="./styles.css" />
  </head>
  <body>
    <main class="shell">
      <p class="eyebrow">LÉLU · Creator Studio</p>
      <h1>${safeTitle}</h1>
      <p id="status" class="status">Ready.</p>
      <button id="act" type="button">Run</button>
    </main>
    <script src="./app.js"></script>
  </body>
</html>
`,
      });
      files.push({
        path: `${root}/styles.css`,
        content: `:root { color-scheme: dark; }\nbody { margin: 0; font-family: ui-sans-serif, system-ui, sans-serif; background: #060b18; color: #e8f1ff; }\n.shell { min-height: 100vh; display: grid; place-content: center; gap: 14px; padding: 32px; }\n.eyebrow { text-transform: uppercase; letter-spacing: 0.18em; font-size: 11px; opacity: 0.6; }\nh1 { margin: 0; font-size: clamp(28px, 6vw, 56px); }\nbutton { justify-self: start; padding: 10px 18px; border-radius: 999px; border: 1px solid #67e8f9; background: rgba(34,211,238,0.16); color: inherit; cursor: pointer; }\n`,
      });
      files.push({
        path: `${root}/app.js`,
        content: `const button = document.getElementById("act");\nconst status = document.getElementById("status");\nlet runs = 0;\nbutton?.addEventListener("click", () => {\n  runs += 1;\n  if (status) status.textContent = \`Run \${runs} completed at \${new Date().toLocaleTimeString()}.\`;\n});\n`,
      });
    } else if (kind === "dashboard") {
      files.push({
        path: `${root}/index.html`,
        content: `<!doctype html>\n<html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>${safeTitle}</title><link rel="stylesheet" href="./styles.css" /></head>\n<body><header><h1>${safeTitle}</h1><p id="stamp">Live</p></header><section id="cards" class="cards"></section><script src="./dashboard.js"></script></body></html>\n`,
      });
      files.push({
        path: `${root}/styles.css`,
        content: `body { margin: 0; font-family: ui-sans-serif, system-ui; background: #070d1c; color: #eaf2ff; }\nheader { display: flex; justify-content: space-between; align-items: baseline; padding: 24px 32px; }\n.cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 16px; padding: 0 32px 32px; }\n.card { border: 1px solid rgba(148,163,184,0.25); border-radius: 16px; padding: 16px; background: rgba(255,255,255,0.03); }\n`,
      });
      files.push({
        path: `${root}/dashboard.js`,
        content: `const cards = document.getElementById("cards");\nconst metrics = [{ label: "Requests", value: 0 }, { label: "Latency", value: "0 ms" }, { label: "Errors", value: 0 }];\nfor (const metric of metrics) {\n  const card = document.createElement("article");\n  card.className = "card";\n  card.innerHTML = \`<p>\${metric.label}</p><strong>\${metric.value}</strong>\`;\n  cards?.append(card);\n}\ndocument.getElementById("stamp").textContent = \`Rendered \${new Date().toLocaleTimeString()}\`;\n${`// TODO: connect a real data source; no values are invented here.`}\n`,
      });
    } else if (kind === "game") {
      files.push({
        path: `${root}/index.html`,
        content: `<!doctype html>\n<html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>${safeTitle}</title><link rel="stylesheet" href="./styles.css" /></head>\n<body><canvas id="board" width="480" height="480"></canvas><p id="score">Score: 0</p><script src="./game.js"></script></body></html>\n`,
      });
      files.push({
        path: `${root}/styles.css`,
        content: `body { margin: 0; min-height: 100vh; display: grid; place-content: center; gap: 12px; background: #050816; color: #e8f1ff; font-family: ui-sans-serif, system-ui; }\ncanvas { border-radius: 18px; border: 1px solid rgba(125,211,252,0.35); background: #08101f; }\n`,
      });
      files.push({
        path: `${root}/game.js`,
        content: `const canvas = document.getElementById("board");\nconst ctx = canvas.getContext("2d");\nconst target = { x: 240, y: 240, r: 14 };\nlet score = 0;\nfunction draw() {\n  ctx.clearRect(0, 0, canvas.width, canvas.height);\n  ctx.fillStyle = "#67e8f9";\n  ctx.beginPath(); ctx.arc(target.x, target.y, target.r, 0, Math.PI * 2); ctx.fill();\n}\ncanvas.addEventListener("pointerdown", (event) => {\n  const rect = canvas.getBoundingClientRect();\n  const dx = event.clientX - rect.left - target.x;\n  const dy = event.clientY - rect.top - target.y;\n  if (Math.hypot(dx, dy) <= target.r + 10) {\n    score += 1;\n    target.x = 40 + Math.random() * (canvas.width - 80);\n    target.y = 40 + Math.random() * (canvas.height - 80);\n    document.getElementById("score").textContent = \`Score: \${score}\`;\n    draw();\n  }\n});\ndraw();\n`,
      });
    } else if (kind === "api") {
      files.push({
        path: `${root}/server.js`,
        content: `import { createServer } from "node:http";\n\n// ${title}\n// A real HTTP service: no framework, no invented endpoints.\nconst routes = {\n  "/health": () => ({ ok: true, at: new Date().toISOString() }),\n  "/": () => ({ service: ${JSON.stringify(title)}, routes: Object.keys(routes) }),\n};\n\nconst server = createServer((request, response) => {\n  const path = new URL(request.url ?? "/", "http://localhost").pathname;\n  const handler = routes[path];\n  response.setHeader("content-type", "application/json");\n  if (!handler) {\n    response.statusCode = 404;\n    response.end(JSON.stringify({ error: "not found", path }));\n    return;\n  }\n  response.end(JSON.stringify(handler()));\n});\n\nconst port = Number(process.env.PORT ?? 8788);\nserver.listen(port, () => console.log(\`listening on http://127.0.0.1:\${port}\`));\n`,
      });
    } else if (kind === "agent") {
      files.push({
        path: `${root}/agent.json`,
        content: JSON.stringify(
          {
            name: title,
            role: "specialist",
            objective: trimmed,
            tools: [],
            memoryAccess: "none",
            instructions: `You are ${title}. Answer only from evidence supplied to you and say when it is insufficient.`,
          },
          null,
          2,
        ),
      });
      files.push({
        path: `${root}/agent.js`,
        content: `export const agent = {\n  name: ${JSON.stringify(title)},\n  objective: ${JSON.stringify(trimmed)},\n  respond(input, evidence = []) {\n    if (!evidence.length) return { ok: false, reason: "No evidence supplied." };\n    return { ok: true, input, evidence };\n  },\n};\n`,
      });
    } else {
      files.push({
        path: `${root}/tool.js`,
        content: `#!/usr/bin/env node\n// ${title}\nconst args = process.argv.slice(2);\nif (args.includes("--help") || args.length === 0) {\n  console.log(${JSON.stringify(`Usage: node tool.js <input>`)});\n  process.exit(args.length === 0 ? 1 : 0);\n}\nconst input = args.join(" ");\nconsole.log(JSON.stringify({ tool: ${JSON.stringify(title)}, input, at: new Date().toISOString() }, null, 2));\n`,
      });
    }

    files.push({
      path: `${root}/README.md`,
      content: `# ${title}\n\nObjective: ${trimmed}\n\nKind: ${kind}\nGenerated by LÉLU Creator Studio from a real engineering workspace.\n\n## Files\n${files.map((file) => `- \`${file.path.replace(`${root}/`, "")}\``).join("\n")}\n\n## Next\n1. Open the workspace copy and inspect the files.\n2. Run the project locally.\n3. Apply to the canonical workspace only after review.\n`,
    });

    return {
      id: `plan-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      objective: trimmed,
      kind,
      slug,
      title,
      files,
      steps,
      createdAt: Date.now(),
    };
  }

  /** Write the plan through the real engineering runtime. */
  async create(plan: CreatorPlan): Promise<CreatorCreateResult> {
    const workspace = EngineeringWorkspace.getInstance();
    const created = await workspace.createCopy();
    if (!created.ok) {
      return { ok: false, error: created.error, written: [], plan };
    }
    const workspaceId = created.workspace.id;
    const written: string[] = [];
    for (const file of plan.files) {
      const result = await workspace.writeFile(workspaceId, file.path, file.content);
      if (!result.ok) {
        return {
          ok: false,
          workspaceId,
          written,
          error: `Could not write ${file.path}: ${result.error}`,
          plan,
        };
      }
      written.push(file.path);
    }

    const validation = await workspace.validate(workspaceId, "typecheck");
    const changes = await workspace.diff(workspaceId);
    return {
      ok: true,
      workspaceId,
      written,
      validation:
        "exitCode" in validation
          ? {
              ok: validation.ok,
              exitCode: validation.exitCode,
              output: validation.output.slice(-4000),
              durationMs: validation.durationMs,
            }
          : undefined,
      changed: changes.length,
      plan,
    };
  }
}
