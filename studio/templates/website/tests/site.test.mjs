import assert from "node:assert/strict";
import test from "node:test";

import {
  FILTERS,
  PROJECTS,
  confirmationMessage,
  describeCount,
  filterProjects,
  nextTheme,
  themeLabel,
  validateContact,
} from "../src/logic.js";

test("filterProjects returns only matching projects", () => {
  assert.equal(filterProjects(PROJECTS, "product").length, 3);
  assert.equal(filterProjects(PROJECTS, "brand").length, 2);
  assert.deepEqual(
    filterProjects(PROJECTS, "systems").map((project) => project.id),
    ["pulse", "atlas"],
  );
});

test("filterProjects treats all and unknown filters as everything", () => {
  assert.equal(filterProjects(PROJECTS, "all").length, PROJECTS.length);
  assert.equal(filterProjects(PROJECTS, "nonsense").length, PROJECTS.length);
  assert.ok(FILTERS.includes("all"));
});

test("filterProjects does not mutate its input", () => {
  const before = JSON.stringify(PROJECTS);
  filterProjects(PROJECTS, "brand");
  assert.equal(JSON.stringify(PROJECTS), before);
});

test("describeCount reports singular and plural honestly", () => {
  assert.equal(describeCount(1, 5), "Showing 1 of 5 project.");
  assert.equal(describeCount(2, 5), "Showing 2 of 5 projects.");
  assert.equal(describeCount(0, 5), "Showing 0 of 5 projects.");
});

test("validateContact accepts a complete brief", () => {
  assert.deepEqual(
    validateContact({ name: "Ada", email: "ada@example.com", message: "A storefront with a basket." }),
    {},
  );
});

test("validateContact names every field that is wrong", () => {
  const errors = validateContact({ name: "A", email: "not-an-email", message: "hi" });
  assert.equal(Object.keys(errors).length, 3);
  assert.match(errors.name, /at least 2/);
  assert.match(errors.email, /email/);
  assert.match(errors.message, /10 characters/);
});

test("validateContact rejects a blank form and trims whitespace", () => {
  assert.equal(Object.keys(validateContact({})).length, 3);
  assert.deepEqual(
    validateContact({ name: "  Ada  ", email: " ada@example.com ", message: "  ten chars+  " }),
    {},
  );
});

test("theme toggles between two values and is labelled", () => {
  assert.equal(nextTheme("night"), "day");
  assert.equal(nextTheme("day"), "night");
  assert.equal(nextTheme("anything"), "day");
  assert.equal(themeLabel("day"), "Day");
  assert.equal(themeLabel("night"), "Night");
});

test("confirmation uses the person's name when there is one", () => {
  assert.match(confirmationMessage("Ada"), /Thanks, Ada/);
  assert.match(confirmationMessage("  "), /^Thanks —/);
});
