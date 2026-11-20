/**
 * M23.0 — WP07: thirty replies across ten registers.
 *
 * Three questions per reply, and none of them is "does it sound nice":
 *
 *   WHAT she says     the words must survive delivery unchanged — the numbers,
 *                     names and technical terms that carry the meaning
 *   HOW she says it   the delivery must be a named profile from the closed
 *                     table, chosen by the register, never a random emotion
 *   WHY that way      a developed trait may move the profile one step, and a
 *                     trait still under development may not
 *
 * Pure and offline: no synthesiser, no model, no device. The audio side of
 * delivery was measured in M22.9 (profiles change duration by 8–15%); this
 * checks the decisions that feed it.
 *
 * Usage: npx tsx MISSION-23.0/scripts/personality-expression-matrix.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { classifyRegister, resolveSpeechDelivery, type SpeechRegister } from "../../src/core/voice/speechDelivery";
import { SPEECH_PROFILES, speechProfileArgs } from "../../src/core/voice/speechProfile";
import { toSpokenText } from "../../src/core/voice/spokenText";

interface Fixture {
  register: SpeechRegister;
  text: string;
  /** Terms that must survive into the spoken text. */
  keep: string[];
}

const FIXTURES: Fixture[] = [
  // supportive
  { register: "supportive", text: "I'm sorry — that sounds rough. Take your time.", keep: [] },
  { register: "supportive", text: "I hear you. You're not alone in this.", keep: [] },
  { register: "supportive", text: "That must have been exhausting. Take care of yourself.", keep: [] },
  // humorous
  { register: "humorous", text: "Haha, that joke was ridiculous and I loved it.", keep: [] },
  { register: "humorous", text: "Honestly, a cat running a build pipeline is absurd.", keep: [] },
  { register: "humorous", text: "Lol. A joke about sockets never connects.", keep: [] },
  // correction
  { register: "correction", text: "Actually, the capital is Lima, not Cusco.", keep: ["Lima", "Cusco"] },
  { register: "correction", text: "To be precise, it halves the search space, it does not sort it.", keep: [] },
  { register: "correction", text: "I was wrong about the boiling point. Correction: it is 100 degrees.", keep: ["100|one hundred"] },
  // serious
  { register: "serious", text: "The honest answer is that we have not verified this.", keep: [] },
  { register: "serious", text: "That claim is unverified, and I must not claim it as measured.", keep: [] },
  { register: "serious", text: "The limitation is real: what we can actually prove is narrow.", keep: [] },
  // research
  { register: "research", text: "The study found a small effect, and the dataset is public.", keep: [] },
  { register: "research", text: "Our hypothesis fits the evidence so far.", keep: [] },
  { register: "research", text: "That paper is peer reviewed, but the findings are preliminary.", keep: [] },
  // technical
  { register: "technical", text: "The endpoint returns a buffer of 16 kilobytes.", keep: ["16|sixteen"] },
  { register: "technical", text: "Run tsc and the suite together; latency drops to 114 milliseconds.", keep: ["114|one hundred fourteen"] },
  { register: "technical", text: "The commit is on the branch, and the module is loaded once.", keep: [] },
  // excited
  { register: "excited", text: "That's amazing — finally, it works!", keep: [] },
  { register: "excited", text: "Excellent! Let's go.", keep: [] },
  { register: "excited", text: "Wonderful, the lights came on!!", keep: [] },
  // long-form (over 420 characters, no other register fires first)
  {
    register: "long-form",
    text:
      "I want to take my time with this one, because the question deserves an answer that is not hurried. " +
      "There are two things worth separating: what you asked, and what you would find useful once you have it. " +
      "The first is narrow and I can answer it plainly. The second is larger, and it depends on what you are " +
      "planning afterwards, which I do not know yet. So let me answer the narrow one first, and then tell me " +
      "whether the larger one is where you actually wanted to go, and I will follow you there.",
    keep: [],
  },
  {
    register: "long-form",
    text:
      "There is a longer answer here, and I would rather give it to you properly than compress it into a slogan. " +
      "The short version is that the thing you are asking about has two halves that behave differently, and only one of " +
      "them is under my control. The other half belongs to circumstances I can describe but cannot change, so the useful " +
      "move is to make the first half as good as it can be and then check whether the second half still matters to you. " +
      "If it does, tell me and we will look at it together rather than separately.",
    keep: [],
  },
  {
    register: "long-form",
    text:
      "Let me walk through this slowly, because a hurried version of it would leave you with the impression that the " +
      "answer is simpler than it is. First, the part you already know, restated so we are using the same words. Second, " +
      "the part that surprised me when I looked closely, and why it changes what I would suggest. Third, what I would do " +
      "next if it were mine, and what I would want to know before committing to that. Ask me to stop at any point and I " +
      "will stop there instead of finishing for the sake of finishing.",
    keep: [],
  },
  // question
  { register: "question", text: "Would you like me to explain it again?", keep: [] },
  { register: "question", text: "What would you like to know first?", keep: [] },
  { register: "question", text: "Should I keep going?", keep: [] },
  // casual
  { register: "casual", text: "Sure, that works for me.", keep: [] },
  { register: "casual", text: "I had a quiet morning, mostly reading.", keep: [] },
  { register: "casual", text: "Okay, tell me more when you're ready.", keep: [] },
];

const SEED = { traits: [] };
const PLAYFUL = {
  traits: [
    { id: "playfulness", strength: 0.7, confidence: 0.75, status: "established" },
    { id: "patience", strength: 0.3, confidence: 0.35, status: "candidate" },
  ],
};
const PATIENT = {
  traits: [
    { id: "patience", strength: 0.8, confidence: 0.8, status: "established" },
    { id: "playfulness", strength: 0.5, confidence: 0.6, status: "emerging" },
  ],
};

const rows: Array<Record<string, unknown>> = [];
let registerMatches = 0;
let wordsPreserved = 0;
let profileNamed = 0;

for (const fixture of FIXTURES) {
  const register = classifyRegister(fixture.text);
  if (register === fixture.register) registerMatches += 1;

  const spoken = toSpokenText(fixture.text);
  // A term survives if any of its accepted forms does: a number is allowed to
  // be spoken ("114" → "one hundred fourteen") because that is what an ear
  // needs, and the spoken text is the thing the synthesiser actually receives.
  const missing = fixture.keep.filter((term) => !term.split("|").some((form) => spoken.includes(form)));
  if (missing.length === 0) wordsPreserved += 1;

  const seed = resolveSpeechDelivery(fixture.text, SEED);
  const playful = resolveSpeechDelivery(fixture.text, PLAYFUL);
  const patient = resolveSpeechDelivery(fixture.text, PATIENT);
  if (SPEECH_PROFILES[seed.profile]) profileNamed += 1;

  rows.push({
    register: fixture.register,
    classified: register,
    registerOk: register === fixture.register,
    text: fixture.text,
    spokenText: spoken,
    missingTerms: missing,
    seedProfile: seed.profile,
    seedPacePct: seed.pacePercentOfBaseline,
    playfulProfile: playful.profile,
    patientProfile: patient.profile,
    reason: seed.reason,
  });
}

const byRegister = Object.fromEntries(
  [...new Set(FIXTURES.map((fixture) => fixture.register))].map((register) => {
    const items = rows.filter((row) => row.register === register);
    const profiles = items.map((row) => row.seedProfile);
    const distinct = [...new Set(profiles)];
    return [register, { replies: items.length, profiles: distinct, consistent: distinct.length === 1 }];
  }),
);

const report = {
  ranAt: new Date().toISOString(),
  replies: FIXTURES.length,
  registers: byRegister,
  registersCovered: Object.keys(byRegister).length,
  registerClassification: { matched: registerMatches, total: FIXTURES.length },
  wordsPreserved: { matched: wordsPreserved, total: FIXTURES.length },
  profilesNamed: { matched: profileNamed, total: FIXTURES.length },
  profileArgs: Object.fromEntries(
    Object.values(SPEECH_PROFILES).map((profile) => [profile.id, speechProfileArgs(profile)]),
  ),
  identityEffect: {
    note: "a developed trait may move the profile one step; a candidate trait may not",
    rows: rows.map((row) => ({
      text: row.text,
      seed: row.seedProfile,
      playful: row.playfulProfile,
      patient: row.patientProfile,
    })),
  },
  rows,
};

mkdirSync(join(process.cwd(), "MISSION-23.0", "logs"), { recursive: true });
writeFileSync(join(process.cwd(), "MISSION-23.0", "logs", "personality-expression-matrix.json"), JSON.stringify(report, null, 2));

console.log(`${registerMatches}/${FIXTURES.length} registers classified as intended`);
console.log(`${wordsPreserved}/${FIXTURES.length} replies kept every meaning-bearing term when spoken`);
console.log(`${profileNamed}/${FIXTURES.length} replies resolved to a named profile\n`);
for (const [register, value] of Object.entries(byRegister)) {
  console.log(`  ${register.padEnd(11)} ${value.replies} replies → ${(value.profiles as string[]).join(", ")}${value.consistent ? "" : "   ← INCONSISTENT"}`);
}
const missed = rows.filter((row) => !row.registerOk);
if (missed.length > 0) {
  console.log("\nRegister mismatches:");
  for (const row of missed) console.log(`  expected ${row.register}, got ${row.classified}: "${String(row.text).slice(0, 70)}"`);
}
const identityMoves = rows.filter((row) => row.seedProfile !== row.playfulProfile || row.seedProfile !== row.patientProfile);
console.log(`\nidentity changes delivery on ${identityMoves.length}/${rows.length} replies`);
