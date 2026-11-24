#!/usr/bin/env node
/*
 * Every Home control takes its own tap, at iPhone SE, iPhone 15 and iPhone 15 Pro Max.
 * Runs tests/e2e/mobile-touch-targets.e2e.mjs against LELU_URL (default http://localhost:4173).
 * Read-only: it opens Home and hit-tests; it changes nothing.
 */
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const base = process.env.LELU_URL || 'http://localhost:4173';
const out = process.argv[2] || path.resolve('mobile-touch-targets-e2e');
const run = spawnSync(process.execPath, [path.join(__dirname, '..', '..', 'tests', 'e2e', 'mobile-touch-targets.e2e.mjs'), base, out], { stdio: 'inherit' });
process.exit(run.status ?? 1);
