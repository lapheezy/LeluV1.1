/**
 * Mission 44.9 — thread layouts and thread objects (pure rules).
 * In every variant, at every size the mission names, LÉLU's spot and the
 * conversation never overlap an object, objects never overlap each other,
 * and everything sits inside the frame's width.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { BUILT_IN_VARIANTS, createVariant, layoutThread, setVariantStorage, variants, type Rect } from "../src/core/thread/ThreadVariants";
import { group, objectsFor, remove, resetLayout, setThreadStorage, setTransform, summon, variantFor, setVariant } from "../src/core/thread/ThreadObjects";

const overlap = (a: Rect, b: Rect) => a.x < b.x + b.w - 1 && b.x < a.x + a.w - 1 && a.y < b.y + b.h - 1 && b.y < a.y + a.h - 1;
const SIZES: Array<[number, number]> = [[320, 740], [375, 812], [390, 844], [430, 932], [1440, 900], [1920, 1080]];

for (const v of BUILT_IN_VARIANTS)
  for (const [w, h] of SIZES)
    test(`${v.id} at ${w}×${h}: no overlaps, inside the width`, () => {
      const ids = ["a", "b", "c", "d", "e"];
      const l = layoutThread(v.base, w, h, ids, "b");
      const rects = Object.entries(l.objects);
      for (const [id, r] of rects) {
        assert.ok(r.x >= 0 && r.x + r.w <= w + 0.5, `${id} inside width`);
        assert.ok(!overlap(r, l.chat), `${id} clear of the conversation`);
        if (l.avatar) assert.ok(!overlap(r, l.avatar), `${id} clear of LÉLU`);
        if (l.activity) assert.ok(!overlap(r, l.activity), `${id} clear of her live panel`);
        for (const [id2, r2] of rects) if (id2 !== id) assert.ok(!overlap(r, r2), `${id} vs ${id2}`);
      }
      if (l.avatar) assert.ok(!overlap(l.avatar, l.chat), "LÉLU clear of the conversation");
      assert.equal(Object.keys(l.objects).length + l.tabs.length, ids.length, "every object is placed or a tab");
    });

function mem() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
}

test("summoning the same content twice keeps one object; deletion leaves no stale group", () => {
  setThreadStorage(mem());
  const a = summon({ conversationId: "c", kind: "neural-map", title: "V2", by: "lelu", map: { aspect: "v2", view: "connectome-tractography", dim: "3d", highlight: [], selected: null } });
  const b = summon({ conversationId: "c", kind: "neural-map", title: "V2 again", by: "lelu", map: { aspect: "v2", view: "connectome-tractography", dim: "3d", highlight: [], selected: null } });
  assert.equal(b.existing, true);
  assert.equal(b.object.id, a.object.id);
  const v = summon({ conversationId: "c", kind: "youtube", title: "video", by: "lelu", video: { id: "abc", title: "x" } });
  group([a.object.id, v.object.id]);
  remove(v.object.id);
  assert.equal(objectsFor("c").length, 1);
  assert.equal(objectsFor("c")[0].group, null, "a group of one is dissolved");
});

test("transforms persist per variant, survive a reload, and reset returns objects to automatic placement", () => {
  const store = mem();
  setThreadStorage(store);
  const o = summon({ conversationId: "c", kind: "web", title: "page", by: "user", web: { url: "https://example.org", title: "Example" } }).object;
  setTransform(o.id, "workspace", { dx: 40, dy: -10, rot: 12, manual: true });
  setVariant("c", "raindrop");
  setThreadStorage(store); // reload
  assert.equal(objectsFor("c")[0].transforms.workspace.rot, 12);
  assert.equal(variantFor("c"), "raindrop");
  assert.equal(resetLayout("c", "workspace"), 1);
  assert.equal(objectsFor("c")[0].transforms.workspace, undefined);
});

test("LÉLU can create a variant from a base, validated, and it lists beside the built-ins", () => {
  setVariantStorage(mem());
  const v = createVariant({ label: "Aurora drops", base: "raindrop", style: { hue: 190, shape: "orb", glow: 3 }, by: "lelu", sources: ["https://example.org/liquid-glass"] });
  assert.equal(v.style.glow, 1, "clamped");
  assert.equal(v.style.shape, "orb");
  assert.ok(variants().some((x) => x.id === v.id));
  assert.throws(() => createVariant({ label: "x", base: "nope" as never, by: "lelu" }), /Unknown base/);
});
