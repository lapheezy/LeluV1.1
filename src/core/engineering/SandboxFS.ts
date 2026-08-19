/**
 * ==========================================================
 * LÉLU
 * SANDBOX FS — the isolated engineering sandbox
 *
 * A virtual file system confined entirely to this browser:
 * create / read / edit / delete files and directories, generate
 * complete starter projects from templates, and run REAL static
 * analysis on file contents. There is no runtime execution and
 * no access outside the sandbox — by design (autonomy L2).
 *
 * Persisted through KvStore with a total size cap.
 * ==========================================================
 */

import KvStore from "../storage/KvStore";

export interface SandboxFileRecord {
  path: string;
  content: string;
  updatedAt: number;
}

export interface SandboxNode {
  type: "file" | "dir";
  path: string;
}

export interface ProjectTemplate {
  id: string;
  label: string;
  description: string;
  files: Record<string, string>;
}

export interface AnalysisResult {
  lines: number;
  characters: number;
  sizeKB: number;
  todoCount: number;
  functionCount: number;
  braceBalance: number;
}

export interface WriteResult {
  ok: boolean;
  error?: string;
}

const KEY = "lelu.sandbox.v1";
const MAX_BYTES = 512 * 1024; // 512 KB persisted sandbox cap

/** Normalize a sandbox path: absolute-ish "/" root, no "..", no trailing "/".
 *  Returns "" for invalid paths (including any ".." attempt) so callers
 *  reject them explicitly. */
function normalizePath(input: string): string {
  const cleaned = input.replace(/\\/g, "/").replace(/^\.?\//, "").replace(/\/+$/, "");
  const parts = cleaned.split("/").filter((part) => part !== "" && part !== ".");
  if (parts.some((part) => part === "..")) {
    return "";
  }
  return parts.join("/");
}

export const PROJECT_TEMPLATES: ProjectTemplate[] = [
  {
    id: "web",
    label: "Website",
    description: "Static site — HTML, CSS, JavaScript",
    files: {
      "index.html": `<!doctype html>\n<html lang="en">\n  <head>\n    <meta charset="UTF-8" />\n    <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n    <title>New Site</title>\n    <link rel="stylesheet" href="styles.css" />\n  </head>\n  <body>\n    <main>\n      <h1>New Site</h1>\n      <p>Built in the LÉLU sandbox.</p>\n    </main>\n    <script src="main.js"></script>\n  </body>\n</html>\n`,
      "styles.css": `:root {\n  color-scheme: dark;\n  font-family: system-ui, sans-serif;\n}\nbody {\n  margin: 0;\n  min-height: 100vh;\n  display: grid;\n  place-items: center;\n  background: #020617;\n  color: #e2e8f0;\n}\n`,
      "main.js": `// entry point\nconsole.log("site ready");\n`,
      "README.md": `# New Site\n\nA starter static site generated in the LÉLU sandbox.\n`,
    },
  },
  {
    id: "app",
    label: "Web App",
    description: "Single-page application skeleton",
    files: {
      "index.html": `<!doctype html>\n<html lang="en">\n  <head>\n    <meta charset="UTF-8" />\n    <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n    <title>New App</title>\n  </head>\n  <body>\n    <div id="app"></div>\n    <script type="module" src="src/app.js"></script>\n  </body>\n</html>\n`,
      "src/app.js": `import { render } from "./ui.js";\n\nconst state = { count: 0 };\n\nrender(state);\n\nexport function increment() {\n  state.count += 1;\n  render(state);\n}\n`,
      "src/ui.js": `export function render(state) {\n  const root = document.getElementById("app");\n  root.innerHTML = \`\n    <h1>New App</h1>\n    <p>count: \${state.count}</p>\n    <button onclick="window.increment()">+1</button>\n  \`;\n  window.increment = () => {\n    state.count += 1;\n    render(state);\n  };\n}\n`,
      "README.md": `# New App\n\nA single-page app skeleton generated in the LÉLU sandbox.\n`,
    },
  },
  {
    id: "api",
    label: "API",
    description: "REST-style server skeleton with routes",
    files: {
      "server.js": `// Minimal REST-style API server\nconst http = require("http");\n\nconst items = [];\n\nfunction send(res, status, body) {\n  res.writeHead(status, { "content-type": "application/json" });\n  res.end(JSON.stringify(body));\n}\n\nconst server = http.createServer((req, res) => {\n  if (req.method === "GET" && req.url === "/items") {\n    return send(res, 200, { items });\n  }\n  if (req.method === "POST" && req.url === "/items") {\n    let raw = "";\n    req.on("data", (chunk) => (raw += chunk));\n    req.on("end", () => {\n      const item = JSON.parse(raw || "{}");\n      items.push({ id: items.length + 1, ...item });\n      send(res, 201, { item: items[items.length - 1] });\n    });\n    return;\n  }\n  send(res, 404, { error: "not found" });\n});\n\nserver.listen(3000, () => console.log("api listening on :3000"));\n`,
      "routes/items.js": `// route handlers live here in a real project\nmodule.exports = { list: () => [], create: (item) => item };\n`,
      "README.md": `# New API\n\nA REST-style API skeleton generated in the LÉLU sandbox.\n`,
    },
  },
  {
    id: "cli",
    label: "CLI Tool",
    description: "Command-line tool skeleton",
    files: {
      "cli.js": `#!/usr/bin/env node\n// Minimal CLI tool\nconst args = process.argv.slice(2);\n\nif (args.includes("--help") || args.length === 0) {\n  console.log("Usage: node cli.js <name>");\n  process.exit(0);\n}\n\nconsole.log(\`hello, \${args[0]}!\`);\n`,
      "package.json": `{\n  "name": "new-cli",\n  "version": "0.1.0",\n  "bin": { "new-cli": "./cli.js" },\n  "scripts": { "start": "node cli.js" }\n}\n`,
      "README.md": `# New CLI\n\nA command-line tool skeleton generated in the LÉLU sandbox.\n`,
    },
  },
  {
    id: "game",
    label: "Game",
    description: "Canvas game skeleton — player, loop, input",
    files: {
      "index.html": `<!doctype html>\n<html lang="en">\n  <head>\n    <meta charset="UTF-8" />\n    <title>New Game</title>\n    <style>\n      body { margin: 0; background: #020617; display: grid; place-items: center; min-height: 100vh; }\n      canvas { border: 1px solid #334155; }\n    </style>\n  </head>\n  <body>\n    <canvas id="game" width="480" height="320"></canvas>\n    <script src="game.js"></script>\n  </body>\n</html>\n`,
      "game.js": `// Minimal canvas game loop\nconst canvas = document.getElementById("game");\nconst ctx = canvas.getContext("2d");\n\nconst player = { x: 240, y: 160, size: 14, speed: 3 };\nconst keys = {};\n\nwindow.addEventListener("keydown", (e) => (keys[e.key] = true));\nwindow.addEventListener("keyup", (e) => (keys[e.key] = false));\n\nfunction update() {\n  if (keys.ArrowLeft) player.x -= player.speed;\n  if (keys.ArrowRight) player.x += player.speed;\n  if (keys.ArrowUp) player.y -= player.speed;\n  if (keys.ArrowDown) player.y += player.speed;\n}\n\nfunction draw() {\n  ctx.fillStyle = "#0f172a";\n  ctx.fillRect(0, 0, canvas.width, canvas.height);\n  ctx.fillStyle = "#67e8f9";\n  ctx.beginPath();\n  ctx.arc(player.x, player.y, player.size, 0, Math.PI * 2);\n  ctx.fill();\n}\n\nfunction loop() {\n  update();\n  draw();\n  requestAnimationFrame(loop);\n}\n\nloop();\n`,
      "README.md": `# New Game\n\nA canvas game skeleton generated in the LÉLU sandbox.\n`,
    },
  },
  {
    id: "agent",
    label: "Agent",
    description: "LÉLU agent definition — role, tools, instructions",
    files: {
      "agent.json": `{\n  "name": "New Specialist",\n  "role": "Specialist",\n  "description": "A custom agent built in the engineering sandbox.",\n  "tools": [],\n  "capabilities": [],\n  "instructions": "You are a specialist agent. Describe what you do and how you work."\n}\n`,
      "README.md": `# New Agent\n\nAn agent specification generated in the LÉLU sandbox. Import its\nsettings into the Agents workspace to bring it to life.\n`,
    },
  },
];

export default class SandboxFS {
  private static instance: SandboxFS | null = null;
  private files: Record<string, { content: string; updatedAt: number }>;

  private constructor() {
    this.files = KvStore.getInstance().get<Record<string, { content: string; updatedAt: number }>>(KEY) ?? {};
  }

  public static getInstance(): SandboxFS {
    if (!SandboxFS.instance) {
      SandboxFS.instance = new SandboxFS();
    }
    return SandboxFS.instance;
  }

  private persist(): void {
    try {
      KvStore.getInstance().set(KEY, this.files);
    } catch {
      // best-effort — sandbox stays in memory if storage is blocked
    }
  }

  private totalBytes(): number {
    let total = 0;
    for (const file of Object.values(this.files)) {
      total += file.content.length * 2; // UTF-16 approximation
    }
    return total;
  }

  /** Flat list of files (paths only). */
  public filePaths(): string[] {
    return Object.keys(this.files).sort();
  }

  /** Tree nodes: directories first (alphabetical), then files. */
  public list(): SandboxNode[] {
    const dirs = new Set<string>();
    for (const path of Object.keys(this.files)) {
      const parts = path.split("/");
      for (let index = 1; index < parts.length; index += 1) {
        dirs.add(parts.slice(0, index).join("/"));
      }
    }
    const nodes: SandboxNode[] = [
      ...[...dirs].map((path) => ({ type: "dir" as const, path })),
      ...Object.keys(this.files).map((path) => ({ type: "file" as const, path })),
    ];
    return nodes.sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === "dir" ? -1 : 1;
      }
      return a.path.localeCompare(b.path);
    });
  }

  public read(path: string): string | null {
    return this.files[normalizePath(path)]?.content ?? null;
  }

  public write(path: string, content: string): WriteResult {
    const normalized = normalizePath(path);
    if (!normalized) {
      return { ok: false, error: "Invalid path." };
    }
    const previous = this.files[normalized];
    const delta = (content.length * 2) - (previous ? previous.content.length * 2 : 0);
    if (this.totalBytes() + delta > MAX_BYTES) {
      return { ok: false, error: `Sandbox full — ${MAX_BYTES / 1024} KB cap reached. Remove files first.` };
    }
    this.files = {
      ...this.files,
      [normalized]: { content, updatedAt: Date.now() },
    };
    this.persist();
    return { ok: true };
  }

  public remove(path: string): void {
    const normalized = normalizePath(path);
    const next = { ...this.files };
    delete next[normalized];
    this.files = next;
    this.persist();
  }

  public reset(): void {
    this.files = {};
    this.persist();
  }

  public sizeKB(): number {
    return Math.round(this.totalBytes() / 1024);
  }

  /** Generate a complete starter project from a template. */
  public generateProject(templateId: string, name: string): WriteResult & { paths?: string[] } {
    const template = PROJECT_TEMPLATES.find((item) => item.id === templateId);
    if (!template) {
      return { ok: false, error: `Unknown template "${templateId}".` };
    }
    const slug = name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "project";
    const root = `projects/${slug}`;
    const paths: string[] = [];
    for (const [relative, content] of Object.entries(template.files)) {
      const full = `${root}/${relative}`;
      const result = this.write(full, content);
      if (!result.ok) {
        return { ok: false, error: result.error };
      }
      paths.push(full);
    }
    return { ok: true, paths };
  }

  /** REAL static analysis of a sandbox file (no runtime execution). */
  public analyze(path: string): AnalysisResult | null {
    const content = this.read(path);
    if (content === null) {
      return null;
    }
    const lines = content.split("\n");
    let balance = 0;
    for (const line of lines) {
      balance += (line.match(/\{/g) ?? []).length - (line.match(/\}/g) ?? []).length;
    }
    return {
      lines: lines.length,
      characters: content.length,
      sizeKB: Math.round((content.length * 2) / 1024),
      todoCount: (content.match(/TODO|FIXME/g) ?? []).length,
      functionCount: (content.match(/\b(function\s+\w+|=>|def\s+\w+)\b/g) ?? []).length,
      braceBalance: balance,
    };
  }
}
