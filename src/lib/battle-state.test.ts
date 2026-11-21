import { describe, expect, it } from "vitest";
import { testReport } from "@/test/replay-fixtures";
import { battleReducer, emptyBattle, type BattleAction, type BattleState } from "./battle-state";

const play = (actions: BattleAction[]): BattleState => actions.reduce(battleReducer, emptyBattle);

const start: BattleAction = {
  type: "battle",
  data: { id: "b1", challenge: "Snake", gladiators: [{ id: "alpha", name: "Alpha", model: "lab/alpha", colour: "#888" }] },
};

describe("battleReducer", () => {
  it("streams code into the current version", () => {
    const state = play([start, { type: "delta", data: { gladiator: "alpha", text: "<html>" } }, { type: "delta", data: { gladiator: "alpha", text: "</html>" } }]);
    expect(state.gladiators[0].code).toBe("<html></html>");
    expect(state.gladiators[0].status).toBe("waiting");
  });

  it("starts a new version for a fix round, keeping the old one", () => {
    const state = play([
      start,
      { type: "delta", data: { gladiator: "alpha", text: "v1" } },
      { type: "test", data: { gladiator: "alpha", ...testReport({ passed: false }) } },
      { type: "status", data: { gladiator: "alpha", status: "fixing", round: 2 } },
      { type: "delta", data: { gladiator: "alpha", text: "v2" } },
    ]);
    const alpha = state.gladiators[0];
    expect(alpha.versions).toEqual(["v1", "v2"]);
    expect(alpha.round).toBe(2);
    expect(alpha.code).toBe("v2");
    expect(alpha.tests).toHaveLength(1);
  });

  it("records the verdict, the replay and the end", () => {
    const state = play([
      start,
      { type: "verdict", data: { winner: "alpha", headline: "Win", scores: [] } },
      { type: "replay", data: { id: "b1" } },
      { type: "done", data: { ok: true } },
    ]);
    expect(state.verdict?.winner).toBe("alpha");
    expect(state.replayId).toBe("b1");
    expect(state.done).toBe(true);
  });
});
