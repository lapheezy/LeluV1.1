import test from "node:test";
import assert from "node:assert/strict";
import {
  SUPERVISOR_EXIT_CODE,
  createSupervisedRestart,
  describeSupervisor,
  supervisorEnabled,
} from "../plugins/updateSupervisor.ts";

/** The standalone runtime may only "restart" by ending, and only when
 *  something outside it is configured to bring it back. These tests pin
 *  that contract: no supervisor means no restart hook (apply refuses),
 *  and an enabled hook must close before it exits. */

test("no supervisor flag means no restart hook", () => {
  const restart = createSupervisedRestart({ enabled: false, close: async () => {}, exit: () => {} });
  assert.equal(restart, null);
});

test("the flag accepts the usual spellings and rejects everything else", () => {
  for (const value of ["1", "true", "YES", " on "]) {
    assert.equal(supervisorEnabled({ LELU_UPDATE_SUPERVISOR: value }), true, value);
  }
  for (const value of [undefined, "", "0", "false", "off", "maybe"]) {
    assert.equal(supervisorEnabled({ LELU_UPDATE_SUPERVISOR: value }), false, String(value));
  }
});

test("an enabled hook closes the listener before it exits", async () => {
  const order = [];
  const restart = createSupervisedRestart({
    enabled: true,
    close: async () => {
      order.push("close");
    },
    exit: (code) => order.push(`exit:${code}`),
  });
  assert.ok(restart, "an enabled runtime must return a hook");
  await restart();
  assert.deepEqual(order, ["close", `exit:${SUPERVISOR_EXIT_CODE}`]);
});

test("a close that throws still ends the process, so a stuck socket cannot wedge an update", async () => {
  let exited = 0;
  const restart = createSupervisedRestart({
    enabled: true,
    close: async () => {
      throw new Error("socket stuck");
    },
    exit: (code) => {
      exited = code;
    },
  });
  // The failure is still reported to the caller — nothing is swallowed —
  // but the process ends anyway so the supervisor can start the new version.
  await assert.rejects(() => restart(), /socket stuck/);
  assert.equal(exited, SUPERVISOR_EXIT_CODE);
});

test("the refusal names the exact missing arrangement", () => {
  const disabled = describeSupervisor(false);
  assert.match(disabled, /LELU_UPDATE_SUPERVISOR=1/);
  assert.match(describeSupervisor(true), new RegExp(String(SUPERVISOR_EXIT_CODE)));
});
