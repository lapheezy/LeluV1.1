/**
 * LÉLU 2 — research command line.
 *
 *   npx tsx scripts/lelu2/research.ts observe
 *   npx tsx scripts/lelu2/research.ts session
 *   npx tsx scripts/lelu2/research.ts record --file research/inbox/entry.json
 *   npx tsx scripts/lelu2/research.ts list --wp WP03
 *   npx tsx scripts/lelu2/research.ts search "floating roots"
 *   npx tsx scripts/lelu2/research.ts verify --id R-... --evidence measurement:artifacts/...
 *   npx tsx scripts/lelu2/research.ts gaps
 *   npx tsx scripts/lelu2/research.ts contradictions
 *   npx tsx scripts/lelu2/research.ts agenda
 *   npx tsx scripts/lelu2/research.ts visual --a x.png --b y.png --out result.json
 *   npx tsx scripts/lelu2/research.ts capability-promote --id R-... --name ...
 *   npx tsx scripts/lelu2/research.ts publish
 *   npx tsx scripts/lelu2/research.ts dashboard --out artifacts/lelu2/research/dashboard.html
 *
 * Every command prints what it actually did, and the exit status is
 * non-zero only when the command could not do it.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { inflateSync } from "node:zlib";

import {
  CognitionBridge,
  ObservationLog,
  ResearchAgenda,
  ResearchJournal,
  ResearchStore,
  compareRenders,
  decodePng,
  type EvidenceRef,
  type ResearchEntryInput,
  type WorkPackage,
} from "../../src/core/cognition/research/index";
import { FsDocStore, PROJECT_ROOT, RESEARCH_DIR, artifacts, gitCommits, results, source } from "./research-fs";

const store = new ResearchStore(new FsDocStore());
const journal = new ResearchJournal(store);
const session = process.env.LELU_SESSION ?? `S-${new Date().toISOString().slice(0, 10)}`;
const observations = new ObservationLog(store, () => Date.now(), session);

function args(argv: string[]): { positional: string[]; flags: Map<string, string> } {
  const positional: string[] = [];
  const flags = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item.startsWith("--")) {
      const [name, inline] = item.slice(2).split("=");
      if (inline !== undefined) flags.set(name, inline);
      else if (argv[index + 1] !== undefined && !argv[index + 1].startsWith("--")) flags.set(name, argv[++index]);
      else flags.set(name, "true");
    } else {
      positional.push(item);
    }
  }
  return { positional, flags };
}

function print(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function parseEvidence(flag: string | undefined): EvidenceRef[] {
  if (!flag) return [];
  return flag
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const [kind, ...rest] = item.split(":");
      const ref = rest.join(":");
      return { kind: kind as EvidenceRef["kind"], ref } as EvidenceRef;
    });
}

function spanishEntry(): void {
  // Deliberately not implemented: the journal is English, like the code and
  // the reports it cites. This exists so a typo cannot silently fall through.
  process.stderr.write("unknown command; run without arguments for usage\n");
  process.exitCode = 2;
}

async function main(): Promise<void> {
  const { positional, flags } = args(process.argv.slice(2));
  const command = positional[0];

  switch (command) {
    case "observe": {
      const sourceData = source();
      const limit = Number(flags.get("limit") ?? 60);
      const fresh = observations.sync({ ...sourceData, commits: () => sourceData.commits(limit) });
      const digest = observations.digest();
      print({
        session,
        root: RESEARCH_DIR,
        newObservations: fresh.length,
        stored: observations.all().length,
        byWorkPackage: digest.byWorkPackage,
        byType: digest.byType,
        commits: digest.commits.slice(0, 6),
        note: "each event is one timestamped document under research/observations/",
      });
      break;
    }

    case "session": {
      print(observations.digest(flags.get("session") ?? session));
      break;
    }

    case "timeline": {
      for (const event of observations.all()) {
        const time = new Date(event.at).toISOString().slice(11, 19);
        process.stdout.write(`${time}  ${event.workPackage.padEnd(7)} ${event.type.padEnd(19)} ${event.summary}\n`);
      }
      break;
    }

    case "record": {
      const file = flags.get("file");
      if (!file) throw new Error("record needs --file <json>");
      const input = JSON.parse(readFileSync(resolve(PROJECT_ROOT, file), "utf8")) as ResearchEntryInput;
      const entry = journal.record({ ...input, session });
      print({ recorded: entry.id, kind: entry.kind, status: entry.status, confidence: entry.confidence, files: [`research/${entry.kind}/${entry.id}.json`, `research/${entry.kind}/${entry.id}.md`] });
      break;
    }

    case "list": {
      const entries = journal.list({
        workPackage: (flags.get("wp") as WorkPackage) ?? undefined,
        status: flags.get("status") as never,
        kind: flags.get("kind") as never,
      });
      print(entries.map((entry) => ({ id: entry.id, wp: entry.workPackage, status: entry.status, kind: entry.kind, confidence: entry.confidence, question: entry.question })));
      break;
    }

    case "search": {
      const query = positional.slice(1).join(" ");
      if (!query) throw new Error("search needs a query");
      print(journal.search(query).map((hit) => ({ id: hit.entry.id, score: hit.score, matched: hit.matched, question: hit.entry.question })));
      break;
    }

    case "show": {
      const id = positional[1];
      if (!id) throw new Error("show needs an entry id");
      const entry = journal.get(id);
      if (!entry) {
        process.stderr.write(`no entry ${id}\n`);
        process.exitCode = 1;
        break;
      }
      print(entry);
      break;
    }

    case "verify": {
      const id = flags.get("id");
      if (!id) throw new Error("verify needs --id <entry>");
      const entry = journal.verify(id, {
        note: flags.get("note"),
        evidence: parseEvidence(flags.get("evidence")),
        confidence: flags.get("confidence") ? Number(flags.get("confidence")) : undefined,
      });
      print({ verified: entry.id, status: entry.status, confidence: entry.confidence, evidence: entry.evidence.length });
      break;
    }

    case "refute": {
      const id = flags.get("id");
      const earlier = flags.get("earlier");
      const assumption = flags.get("assumption");
      if (!id || !earlier || !assumption) throw new Error("refute needs --id, --earlier and --assumption");
      const entry = journal.refute(id, {
        entryId: earlier,
        assumption,
        note: flags.get("note") ?? "",
        evidence: parseEvidence(flags.get("evidence")),
      });
      print({ entry: entry.id, refutations: entry.refutations.length });
      break;
    }

    case "gaps": {
      print(journal.gaps());
      break;
    }

    case "contradictions": {
      print({ contradictions: journal.contradictions(), disproven: journal.disprovenAssumptions() });
      break;
    }

    case "agenda": {
      const agenda = new ResearchAgenda();
      const proposals = agenda.rank([
        ...agenda.fromGaps(journal.gaps()),
        ...agenda.fromFailures(observations.recurrences(), observations.all()),
      ]);
      print(proposals);
      break;
    }

    case "stats": {
      print({ ...journal.stats(), observations: observations.all().length, index: store.readIndex() });
      break;
    }

    case "visual": {
      const a = flags.get("a");
      const b = flags.get("b");
      if (!a || !b) throw new Error("visual needs --a <png> and --b <png>");
      const read = (path: string) => decodePng(readFileSync(resolve(PROJECT_ROOT, path)), inflateSync);
      const comparison = compareRenders(read(a), read(b), { a, b });
      const out = flags.get("out");
      if (out) {
        const target = resolve(PROJECT_ROOT, out);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, JSON.stringify(comparison, null, 2) + "\n");
      }
      print(comparison);
      break;
    }

    case "capability-promote": {
      const id = flags.get("id");
      const name = flags.get("name");
      if (!id || !name) throw new Error("capability-promote needs --id <entry> and --name");
      const entry = journal.get(id);
      if (!entry) throw new Error(`no entry ${id}`);
      const record = new (await import("../../src/core/cognition/research/capabilities")).default(store).promote(entry, {
        name,
        acceptance: (flags.get("accept") ?? "").split("|").filter(Boolean),
        testCommand: flags.get("test") ?? "",
        notes: flags.get("note") ? [flags.get("note") as string] : [],
      });
      print(record);
      break;
    }

    case "publish": {
      const bridge = new CognitionBridge();
      const verified = journal.list({ status: "verified" });
      const outcomes = await bridge.publishAll(verified);
      print({ verified: verified.length, outcomes });
      break;
    }

    case "reindex": {
      const index = store.index();
      store.writeIndex(index);
      print(index);
      break;
    }

    case "dashboard": {
      const { renderDashboard } = await import("./research-dashboard");
      const out = resolve(PROJECT_ROOT, flags.get("out") ?? "artifacts/lelu2/research/dashboard.html");
      const html = renderDashboard({ journal, observations, store, researchDir: RESEARCH_DIR });
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, html);
      print({ dashboard: out, bytes: html.length });
      break;
    }

    case "seed": {
      const { seed } = await import("./research-seed");
      print(await seed({ journal, observations, store, session }));
      break;
    }

    case "acceptance": {
      const { runAcceptance } = await import("./research-acceptance");
      print(await runAcceptance({ journal, observations, store, session }));
      break;
    }

    case undefined: {
      process.stdout.write(
        [
          "LÉLU research journal",
          "",
          "  observe            ingest commits, artefacts and test results",
          "  session            reconstruct the observed session",
          "  timeline           every observation, in time order",
          "  record --file f    record a research entry from JSON",
          "  list / search / show",
          "  verify --id --evidence kind:ref",
          "  refute --id --earlier --assumption",
          "  gaps / contradictions / agenda / stats",
          "  visual --a --b --out",
          "  capability-promote --id --name --accept --test",
          "  publish            push verified entries into KnowledgeLibrary",
          "  dashboard --out    render the journal as HTML",
          "  seed / acceptance  mission data and the 11-criteria proof",
          "",
        ].join("\n"),
      );
      break;
    }

    default:
      spanishEntry();
  }

  if (command && command !== "verify" && command !== "refute" && !existsSync(RESEARCH_DIR)) {
    process.stderr.write("warning: research directory was not created\n");
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});

export { gitCommits, artifacts, results };
