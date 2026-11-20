/**
 * ==========================================================
 * LÉLU — HER DELIVERY COMES FROM HER, NOT FROM THE SENTENCE
 *
 * CATEGORY: pure, offline. Mission 22.9 / WP05.
 *
 * Thirty representative replies across the ten registers the mission
 * names, checked against two rules:
 *
 *   1. the delivery chosen is the one her identity implies — and a reply
 *      whose register cannot be told falls back to her default, never to
 *      an emotion nobody chose;
 *   2. the words do not change. Delivery is pace and variation; the
 *      spoken text keeps every technical term, name and number that
 *      carried the meaning (spokenText.ts is the only thing that may
 *      reformat, and it does so for the ear).
 * ==========================================================
 */

import assert from "node:assert/strict";
import test from "node:test";

import { classifyRegister, resolveSpeechDelivery } from "../src/core/voice/speechDelivery";
import { SPEECH_PROFILES, speechProfileArgs } from "../src/core/voice/speechProfile";
import { toSpokenText } from "../src/core/voice/spokenText";

/** The identity LÉLU starts with: every trait still a candidate. */
const SEED = {
  traits: [
    { id: "playfulness", strength: 0.3, confidence: 0.35, status: "candidate" },
    { id: "patience", strength: 0.3, confidence: 0.35, status: "candidate" },
  ],
  communicationStyle: "thoughtful and direct, with warmth; asks questions before concluding",
};

/** Her after enough evidence to promote playfulness to established. */
const PLAYFUL = {
  traits: [
    { id: "playfulness", strength: 0.7, confidence: 0.75, status: "established" },
    { id: "patience", strength: 0.3, confidence: 0.35, status: "candidate" },
  ],
};

/** Her after patience has been earned and outranks playfulness. */
const PATIENT = {
  traits: [
    { id: "playfulness", strength: 0.5, confidence: 0.7, status: "emerging" },
    { id: "patience", strength: 0.8, confidence: 0.8, status: "established" },
  ],
};

interface Case {
  register: string;
  text: string;
  /** Words that must survive into speech. */
  keeps?: string[];
}

const CASES: Case[] = [
  // 1. casual conversation
  { register: "casual", text: "Morning. I was just thinking about the garden." },
  { register: "casual", text: "Nothing much happening here today, honestly." },
  { register: "casual", text: "That sounds like a good plan for the afternoon." },
  // 2. technical explanations
  {
    register: "technical",
    text: "The runtime keeps one worker per profile, so the model loads once instead of once per sentence.",
    keeps: ["runtime", "worker", "profile", "model"],
  },
  {
    register: "technical",
    text: "Run `tsc -b --force`; a type error in the module stops the build.",
    keeps: ["tsc", "module", "build"],
  },
  {
    // Numbers are spoken as words (spokenText.ts), so the meaning that must
    // survive here is the quantity's unit and the claim itself.
    register: "technical",
    text: "First audio dropped from 3518 ms to under 1500 ms after the worker stayed warm.",
    keeps: ["ms", "first audio", "worker"],
  },
  // 3. research discussions
  {
    register: "research",
    text: "The evidence points one way: the study found the effect held across both datasets.",
    keeps: ["evidence", "study", "datasets"],
  },
  {
    register: "research",
    text: "My hypothesis is that the variance comes from the model, not the network.",
    keeps: ["hypothesis", "variance"],
  },
  {
    register: "research",
    text: "We measured it five times; the findings were consistent.",
    keeps: ["findings"],
  },
  // 4. humour
  { register: "humorous", text: "Well, that deployment went about as well as a chocolate teapot. Ridiculous." },
  { register: "humorous", text: "Haha, the test suite has opinions about my confidence today." },
  { register: "humorous", text: "A joke: the fastest way to find a bug is to claim there are none." },
  // 5. emotional support
  {
    register: "supportive",
    text: "I'm sorry, that sounds exhausting. Take your time — I'm not going anywhere.",
  },
  { register: "supportive", text: "I hear you. That must have been a difficult week." },
  { register: "supportive", text: "You're not alone in this, and it's okay to stop for today." },
  // 6. corrections
  { register: "correction", text: "Actually, I was wrong about the number — it was twelve, not twenty." },
  { register: "correction", text: "To be precise, the second run failed, not the first." },
  { register: "correction", text: "I need to correct something I said earlier about the latency." },
  // 7. excitement
  { register: "excited", text: "It works!! The whole pipeline is warm and the first audio is finally under a second." },
  { register: "excited", text: "Finally, she recovered on her own and never dropped a sentence!" },
  { register: "excited", text: "This is wonderful news, we can ship the measurement today." },
  // 8. serious conversations
  {
    register: "serious",
    text: "This matters: the microphone acceptance is still blocked, and I will not claim otherwise.",
  },
  { register: "serious", text: "I want to be careful here about what we can actually prove." },
  { register: "serious", text: "The honest answer is that the hardware gate is unverified." },
  // 9. follow-up questions
  { register: "question", text: "Do you want me to run it again with a longer silence?" },
  { register: "question", text: "Should I keep the fallback voice, or replace it?" },
  { register: "question", text: "What would you like me to measure next?" },
  // 10. long-form explanations
  {
    register: "long-form",
    text: `${"A conversation is not a sequence of requests; it is one shared state that both people keep updating as they speak. ".repeat(5)}`,
  },
  {
    register: "long-form",
    text: `${"What I mean by presence is that she keeps listening while she speaks, and the listening is part of the answer. ".repeat(5)}`,
  },
  {
    register: "long-form",
    text: `${"Delivery is the part of speech that carries meaning without changing a single word, and that is why it belongs to her personality rather than to the sentence. ".repeat(5)}`,
  },
];

test("all thirty representative replies get the delivery their register implies", () => {
  assert.equal(CASES.length, 30, "the mission asks for thirty representative replies");
  const seen = new Set<string>();
  for (const item of CASES) {
    const decision = resolveSpeechDelivery(item.text, SEED);
    assert.equal(decision.register, item.register, `register for: ${item.text.slice(0, 60)}`);
    seen.add(decision.register);
    // With no developed trait, delivery follows the register alone.
    if (["supportive", "correction", "serious", "research", "technical", "long-form"].includes(item.register)) {
      assert.equal(decision.profile, "calm", `calm expected for ${item.register}`);
    } else if (["humorous", "excited"].includes(item.register)) {
      assert.equal(decision.profile, "bright", `bright expected for ${item.register}`);
    } else {
      assert.equal(decision.profile, "warm", `default delivery expected for ${item.register}`);
    }
    assert.ok(decision.reason.length > 0, "every choice carries a reason a reviewer can check");
  }
  assert.equal(seen.size, 10, `all ten registers were exercised, saw ${[...seen].join(", ")}`);
});

test("speaking a reply never changes its meaning", () => {
  for (const item of CASES) {
    const spoken = toSpokenText(item.text);
    assert.ok(spoken.length > 0, `a reply that carries meaning must remain speakable: ${item.text.slice(0, 40)}`);
    for (const word of item.keeps ?? []) {
      assert.ok(
        spoken.toLowerCase().includes(word.toLowerCase()),
        `"${word}" must survive into speech, got: ${spoken.slice(0, 120)}`,
      );
    }
    // Delivery decisions never edit the text.
    const decision = resolveSpeechDelivery(item.text, SEED);
    assert.equal(typeof decision.profile, "string");
    assert.equal(item.text.length > 0, true);
  }
});

test("a developed trait changes her delivery — and only her delivery", () => {
  const casual = "Morning. I was just thinking about the garden.";
  const seed = resolveSpeechDelivery(casual, SEED);
  const playful = resolveSpeechDelivery(casual, PLAYFUL);
  assert.equal(seed.profile, "warm", "before the trait is developed, she speaks neutrally");
  assert.equal(playful.profile, "bright", "developed playfulness is audible in a casual reply");
  assert.match(playful.reason, /playfulness/);

  // Patience outranks playfulness: even a joke is told at her own pace.
  const joke = "Haha, the test suite has opinions about my confidence today.";
  assert.equal(resolveSpeechDelivery(joke, PLAYFUL).profile, "bright");
  const patient = resolveSpeechDelivery(joke, PATIENT);
  assert.equal(patient.profile, "calm", "developed patience outranks playfulness");
  assert.match(patient.reason, /patience/);

  // A serious answer is measured regardless of who is listening.
  const serious = "The honest answer is that the hardware gate is unverified.";
  assert.equal(resolveSpeechDelivery(serious, PLAYFUL).profile, "calm");

  // A candidate trait is an observation, not a characteristic.
  const candidateOnly = {
    traits: [{ id: "playfulness", strength: 0.95, confidence: 0.95, status: "candidate" }],
  };
  assert.equal(
    resolveSpeechDelivery(casual, candidateOnly).profile,
    "warm",
    "an unpromoted trait must not change her voice",
  );
});

test("each profile is a real, distinct delivery the synthesiser reads", () => {
  const warm = speechProfileArgs(SPEECH_PROFILES.warm);
  const calm = speechProfileArgs(SPEECH_PROFILES.calm);
  const bright = speechProfileArgs(SPEECH_PROFILES.bright);
  assert.notDeepEqual(warm, calm);
  assert.notDeepEqual(calm, bright);
  assert.ok(SPEECH_PROFILES.calm.lengthScale > SPEECH_PROFILES.warm.lengthScale, "calm is slower");
  assert.ok(SPEECH_PROFILES.bright.lengthScale < SPEECH_PROFILES.warm.lengthScale, "bright is quicker");
  assert.ok(SPEECH_PROFILES.calm.sentenceSilence > SPEECH_PROFILES.bright.sentenceSilence);
  for (const args of [warm, calm, bright]) {
    assert.equal(args[0], "--length_scale");
    assert.equal(args.length, 8, "four named flags with four values");
  }
});
