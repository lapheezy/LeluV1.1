/**
 * Runner for the EarthCore pipeline proof:
 *   1. load the project env files (same loader server.ts uses)
 *   2. start the standalone runtime server (provides the AIS bridge)
 *   3. bundle the test with `import.meta.env` statically defined
 *   4. execute the bundle and print the result
 */
import { loadEnvFilesIntoProcess } from "../plugins/loadEnvFiles.ts";

const summary = loadEnvFilesIntoProcess(["VITE_FIRMS_API_KEY", "AISSTREAM_API_KEY"]);
console.log(
  `env files: ${summary.filesLoaded.join(", ") || "none"} | FIRMS=${summary.keys.VITE_FIRMS_API_KEY ? "SET" : "absent"} | AIS=${summary.keys.AISSTREAM_API_KEY ? "SET" : "absent"}`,
);

const PORT = 4581;
const serverProc = Bun.spawn(["bun", "run", "server.ts"], {
  env: { ...process.env, PORT: String(PORT) },
  stdout: "pipe",
  stderr: "pipe",
});
await Bun.sleep(2500);

const out = await Bun.build({
  entrypoints: ["scripts/earth-pipeline-test.ts"],
  outdir: "/tmp/lelu-pipeline",
  naming: "pipeline-test.js",
  define: {
    "import.meta.env": JSON.stringify({
      VITE_FIRMS_API_KEY: process.env.VITE_FIRMS_API_KEY ?? "",
      VITE_EARTH_VESSELS_ENDPOINT: `http://127.0.0.1:${PORT}/api/ais/vessels`,
    }),
  },
});
if (!out.success) {
  console.error("build failed", out.logs);
  serverProc.kill();
  process.exit(1);
}
const entry = out.outputs.find((o) => o.kind === "entry-point");
if (!entry) {
  console.error("no entry point output");
  serverProc.kill();
  process.exit(1);
}

const runProc = Bun.spawn(["bun", "run", entry.path], { stdout: "inherit", stderr: "inherit" });
const code = await runProc.exited;
serverProc.kill();
process.exit(code ?? 1);
