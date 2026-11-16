/**
 * ==========================================================
 * LÉLU — A PARTIAL PROFILE MUST NOT COST THE TURN
 *
 * CATEGORY: unit. The real `normalizeUserProfile` and the real failure
 * classifier; nothing is stood in for.
 *
 * Why this exists: the owner reported that chatting produced
 * "undefined is not an object (evaluating '…')" and never used the facts in
 * Supabase. Reproduced against a real account: `user_preferences.value` was
 * `{ name, preferences: {}, updatedAt }`, hydration assigned it straight
 * onto the live profile, and `UserManager.context()` threw on
 * `preferences.favoriteColors.join(…)` before any provider was called.
 * AIService then returned the exception text as her reply.
 * ==========================================================
 */

import assert from "node:assert/strict";
import test from "node:test";

import { normalizeUserProfile } from "../src/core/user/UserManager";
import {
  INTERNAL_FAILURE_NOTICE,
  isInternalEngineError,
} from "../src/core/errors/InternalFailure";

/** The row shape an older build wrote to `user_preferences`. */
const PARTIAL = {
  id: "primary-user",
  name: "Aurelia Quill",
  preferences: {},
  updatedAt: 1_800_000_000_000,
};

test("a partial stored profile is filled, and keeps what it does carry", () => {
  const profile = normalizeUserProfile(PARTIAL);

  assert.equal(profile.name, "Aurelia Quill");
  assert.equal(profile.updatedAt, 1_800_000_000_000);
  // Every array `context()` dereferences is an array.
  assert.deepEqual(profile.preferences.favoriteColors, []);
  assert.deepEqual(profile.preferences.interests, []);
  assert.deepEqual(profile.preferences.responsePreferences, []);
  assert.deepEqual(profile.goals, []);
  assert.deepEqual(profile.skills, []);
  assert.deepEqual(profile.projects, []);
  assert.deepEqual(profile.relationships, []);
  assert.deepEqual(profile.values, []);
  assert.deepEqual(profile.currentFocus, []);
  assert.deepEqual(profile.experiences, []);
});

test("context()-style reads cannot throw on a partial profile", () => {
  const profile = normalizeUserProfile(PARTIAL);
  // Exactly the expressions that used to throw.
  assert.doesNotThrow(() => {
    profile.preferences.favoriteColors.join(", ");
    profile.preferences.interests.join(", ");
    profile.goals.join(", ");
    profile.skills.join(", ");
    profile.projects.join(", ");
  });
});

test("a partial remote write cannot erase facts this device already knew", () => {
  const local = normalizeUserProfile({
    ...PARTIAL,
    name: "Aurelia Quill",
    preferences: { favoriteColors: ["indigo"], interests: ["orbital mechanics"] },
    goals: ["finish the Tidal Loom"],
  });

  // The remote row omits those fields entirely.
  const merged = normalizeUserProfile({ name: "", preferences: {}, updatedAt: 1_800_000_100_000 }, local);

  assert.deepEqual(merged.preferences.favoriteColors, ["indigo"]);
  assert.deepEqual(merged.preferences.interests, ["orbital mechanics"]);
  assert.deepEqual(merged.goals, ["finish the Tidal Loom"]);
  // The name that WAS present is kept; the blank one does not overwrite it.
  assert.equal(merged.name, "Aurelia Quill");
  assert.equal(merged.updatedAt, 1_800_000_100_000);
});

test("wrong types are coerced instead of trusted", () => {
  const profile = normalizeUserProfile({
    id: 7,
    name: null,
    preferences: "not an object",
    goals: "a string, not a list",
    skills: [1, "welding", null],
    updatedAt: "yesterday",
    createdAt: undefined,
  });

  assert.equal(profile.id, "primary-user");
  assert.equal(profile.name, "");
  assert.deepEqual(profile.goals, []);
  assert.deepEqual(profile.skills, ["welding"]);
  assert.equal(typeof profile.updatedAt, "number");
  assert.equal(typeof profile.createdAt, "number");
});

test("an engine failure is classified as a bug, not as her answer", () => {
  assert.equal(isInternalEngineError(new TypeError("x is not a function")), true);
  assert.equal(isInternalEngineError(new ReferenceError("nope")), true);
  // The WebKit wording, which is what the owner actually saw.
  assert.equal(
    isInternalEngineError(
      "TypeError: undefined is not an object (evaluating 'this.profile.preferences.favoriteColors.join')",
    ),
    true,
  );
  assert.equal(
    isInternalEngineError("Cannot read properties of undefined (reading 'join')"),
    true,
  );
  // A provider or transport failure is NOT an engine bug: its message is
  // actionable and may be shown.
  assert.equal(isInternalEngineError("429 Too Many Requests"), false);
  assert.equal(isInternalEngineError("Provider key rejected (401)"), false);

  assert.match(INTERNAL_FAILURE_NOTICE, /your message is safe/i);
  assert.doesNotMatch(INTERNAL_FAILURE_NOTICE, /undefined|TypeError|evaluating|join/i);
});
