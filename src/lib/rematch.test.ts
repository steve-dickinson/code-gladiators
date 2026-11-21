import { describe, expect, it } from "vitest";
import { makeReplay } from "@/test/replay-fixtures";
import { groupChange, planRematch } from "./rematch";

const ids = ["alpha", "beta", "gamma", "delta"];
const battle = makeReplay({
  id: "original",
  gladiators: [
    { id: "alpha", total: 27 },
    { id: "beta", total: 24, tests: [{ passed: false, errors: ["TypeError: x is null"] }] },
    { id: "gamma", total: 20 },
    { id: "delta", total: 15 },
  ],
});

describe("planRematch", () => {
  it("coaches a random half and records everyone's previous score", () => {
    const plan = planRematch(battle, ids)!;
    expect(plan.of).toBe("original");
    expect(plan.coached).toHaveLength(2);
    expect(Object.keys(plan.previous).sort()).toEqual([...ids].sort());
    expect(plan.previous.alpha).toEqual({ total: 27, rank: 1 });
    expect(Object.keys(plan.feedback).sort()).toEqual([...plan.coached].sort());
  });

  it("tells a coached gladiator its place, the winning score and what was still broken", () => {
    let plan = planRematch(battle, ids)!;
    while (!plan.coached.includes("beta")) plan = planRematch(battle, ids)!;
    expect(plan.feedback.beta).toContain("You came 2nd of 4, scoring 24/30");
    expect(plan.feedback.beta).toContain("The winning entry scored 27/30.");
    expect(plan.feedback.beta).toContain("- TypeError: x is null");
  });

  it("refuses a battle with nothing to learn from", () => {
    expect(planRematch(makeReplay({ gladiators: [{ id: "alpha", total: 20 }], judged: false }), ids)).toBeNull();
    expect(planRematch(makeReplay({ gladiators: [{ id: "alpha" }, { id: "beta" }] }), ids)).toBeNull();
  });
});

describe("groupChange", () => {
  it("averages each group's change in score", () => {
    const plan = {
      of: "original",
      coached: ["alpha", "beta"],
      previous: { alpha: { total: 20, rank: 2 }, beta: { total: 10, rank: 4 }, gamma: { total: 25, rank: 1 }, delta: { total: 15, rank: 3 } },
      feedback: {},
    };
    const now = [
      { gladiator: "alpha", total: 26 },
      { gladiator: "beta", total: 13 },
      { gladiator: "gamma", total: 24 },
      { gladiator: "delta", total: 15 },
    ].map((s) => ({ ...s, creativity: 0, polish: 0, fidelity: 0, roast: "" }));
    expect(groupChange(plan, now)).toEqual({ coached: 4.5, control: -0.5 });
  });
});
