/**
 * Fetch and verify LÉLU's CC0 reference library.
 *
 * Downloads exactly the archives the pipeline uses, checks them against the
 * recorded SHA256 digests, and extracts them into resources/cc0/. Every URL
 * here points at a pack that its publisher lists as CC0; see
 * resources/cc0/README.md for the licence audit.
 *
 *   node scripts/asre/fetch-cc0.mjs [--force]
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = "resources/cc0";
const MH = join(ROOT, "makehuman");
const PACKS = join(MH, "packs");

/** Pack name → download URL. All CC0, per the publisher's pack index. */
const PACKS_LIST = {
  makehuman_system_assets: "https://files.makehumancommunity.org/asset_packs/makehuman_system_assets/makehuman_system_assets_cc0.zip",
  hands01: "https://files.makehumancommunity.org/asset_packs/hands01/hands01_cc0.zip",
  cheek01: "https://files.makehumancommunity.org/asset_packs/cheek01/cheek01_cc0.zip",
  nose01: "https://files.makehumancommunity.org/asset_packs/nose01/nose01_cc0.zip",
  ears01: "https://files.makehumancommunity.org/asset_packs/ears01/ears01_cc0.zip",
  arms01: "https://files.makehumancommunity.org/asset_packs/arms01/arms01_cc0.zip",
  hair01: "https://files.makehumancommunity.org/asset_packs/hair01/hair01_cc0.zip",
  skins01: "https://files.makehumancommunity.org/asset_packs/skins01/skins01_cc0.zip",
  poses01: "https://files.makehumancommunity.org/asset_packs/poses01/poses01_cc0.zip",
};

/** Pinned digests of the archives this pipeline was built and measured against. */
const SHA256 = {
  makehuman_system_assets: "b542127a8e25547c7c29c19f2d1d2adb9a664c80396ecd694095dbc8028a0107",
  hands01: "b874210dc3a9a179b73a3dd04976bc27521f47f985d106ce46fb45a480ee1701",
  cheek01: "ee96e19850878bbacaa8ac2b6a8ea871b667d36b21ca079e74062385b8fae1e9",
  nose01: "21ab5bbd05ec3f1ccad44ff2d7a679cf8f2d8e8b368f5b7367ba00c7701db906",
  ears01: "d32691d10015c7cd0f382f0101dca375153ecfaabd2a875d2b26cc38e17a30dd",
  arms01: "ea415e07a5e642c0dd9fbcf19d81d644125708c131eaf024800465fb18b1bf7b",
  hair01: "49445d69848a313ec41a9970f6a0fe4bcf925c9f1c6ef40a76f119c2e07940c9",
  skins01: "7495ab99287053bd19ff1636114e64b608994d9f7437fea6cc75ea387f96dba9",
  poses01: "67b1d14923adda85f371f81e1c529fcd058f975d0bf93848838e1a3860705b7d",
};

const force = process.argv.includes("--force");
mkdirSync(PACKS, { recursive: true });

for (const [name, url] of Object.entries(PACKS_LIST)) {
  const out = join(PACKS, `${name}.zip`);
  const dir = join(MH, name);
  if (!force && existsSync(dir) && existsSync(join(dir, "..")) && readdirSafe(dir)) {
    console.log(`${name.padEnd(26)} present`);
    continue;
  }
  console.log(`${name.padEnd(26)} downloading ${url}`);
  execFileSync("curl", ["-sL", "--retry", "2", "-o", out, url], { stdio: "inherit" });
  const digest = createHash("sha256").update(readFileSync(out)).digest("hex");
  if (SHA256[name] && digest !== SHA256[name]) throw new Error(`${name}: sha256 ${digest} does not match the recorded ${SHA256[name]}`);
  mkdirSync(dir, { recursive: true });
  execFileSync("unzip", ["-oq", out, "-d", dir], { stdio: "inherit" });
  console.log(`${name.padEnd(26)} ok ${digest.slice(0, 16)}…`);
}
console.log("\nreference library ready under", MH);

function readdirSafe(dir) {
  try {
    return readFileSync(join(dir, "..")).length >= 0;
  } catch {
    return true;
  }
}
