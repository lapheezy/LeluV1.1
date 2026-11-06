import { describe, expect, test, beforeEach } from "bun:test";

import SpatialRevealIntent from "../src/core/spatial/SpatialRevealIntent";

describe("spatial reveal intent", () => {
  beforeEach(() => {
    SpatialRevealIntent.getInstance().resetForTests();
  });

  test("a creation requests the world and carries identity", () => {
    const intent = SpatialRevealIntent.getInstance();
    const seen: string[][] = [];
    const unsubscribe = intent.subscribe((request) => seen.push(request.objectNames));

    intent.request(["spatial-1"], ["Nova"]);

    expect(seen).toEqual([["Nova"]]);
    expect(intent.latestRequest()?.objectIds).toEqual(["spatial-1"]);
    expect(intent.latestRequest()?.objectNames).toEqual(["Nova"]);
    unsubscribe();
  });

  test("only the most recent creation is the reveal target", () => {
    const intent = SpatialRevealIntent.getInstance();
    intent.request(["a"], ["Nova"]);
    intent.request(["b"], ["Comet"]);
    expect(intent.latestRequest()?.objectNames).toEqual(["Comet"]);
  });

  test("a request without an id or a name reveals nothing", () => {
    const intent = SpatialRevealIntent.getInstance();
    let calls = 0;
    intent.subscribe(() => {
      calls += 1;
    });
    intent.request([], ["Nova"]);
    intent.request(["a"], []);
    intent.request(["a"], [""]);
    expect(calls).toBe(0);
    expect(intent.latestRequest()).toBeNull();
  });

  test("duplicate ids and names are collapsed", () => {
    const intent = SpatialRevealIntent.getInstance();
    intent.request(["a", "a", "b"], ["Nova", "Nova"]);
    expect(intent.latestRequest()?.objectIds).toEqual(["a", "b"]);
    expect(intent.latestRequest()?.objectNames).toEqual(["Nova"]);
  });

  test("unsubscribing stops a reveal that is no longer wanted", () => {
    const intent = SpatialRevealIntent.getInstance();
    let calls = 0;
    const unsubscribe = intent.subscribe(() => {
      calls += 1;
    });
    unsubscribe();
    intent.request(["a"], ["Nova"]);
    expect(calls).toBe(0);
  });
});
