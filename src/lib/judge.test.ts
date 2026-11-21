import { describe, expect, it } from "vitest";
import { testReport } from "@/test/replay-fixtures";
import { describeTesting, labelEntries, relabel, type JudgeEntry } from "./judge";

const entries: JudgeEntry[] = [
  { id: "alpha", name: "Alpha 1", html: "<html></html>" },
  { id: "beta", name: "Beta 2", html: "<html></html>" },
  { id: "gamma", name: "Gamma 3", html: "" },
];

describe("labelEntries", () => {
  it("gives every entry a distinct letter, in a shuffled order", () => {
    const labelled = labelEntries(entries);
    expect(labelled.map((e) => e.label)).toEqual(["A", "B", "C"]);
    expect(labelled.map((e) => e.id).sort()).toEqual(["alpha", "beta", "gamma"]);
  });
});

describe("relabel", () => {
  it("maps letters back to gladiators, names them in the text, and ranks best first", () => {
    const labelled = [
      { ...entries[0], label: "A" },
      { ...entries[1], label: "B" },
      { ...entries[2], label: "C" },
    ];
    const verdict = relabel(
      {
        headline: "Entry B crushes Entry A",
        scores: [
          { gladiator: "A", creativity: 5, polish: 5, fidelity: 5, roast: "Entry A tried." },
          { gladiator: "B", creativity: 9, polish: 9, fidelity: 9, roast: "Lovely." },
          { gladiator: "C", creativity: 0, polish: 0, fidelity: 0, roast: "Nothing." },
        ],
      },
      labelled,
    );
    expect(verdict.winner).toBe("beta");
    expect(verdict.headline).toBe("Beta 2 crushes Alpha 1");
    expect(verdict.scores.map((s) => [s.gladiator, s.total])).toEqual([
      ["beta", 27],
      ["alpha", 15],
      ["gamma", 0],
    ]);
    expect(verdict.scores[1].roast).toBe("Alpha 1 tried.");
  });
});

describe("describeTesting", () => {
  it("summarises how testing went for the judge", () => {
    expect(describeTesting({})).toBe(" · not browser-tested");
    expect(describeTesting({ test: testReport() })).toBe(" · browser test: passed first time");
    expect(describeTesting({ test: testReport(), rounds: 2 })).toBe(" · browser test: passed after 1 fix");
    expect(describeTesting({ test: testReport({ passed: false, errors: ["TypeError"] }), rounds: 3 })).toBe(
      " · browser test: still failing after 2 fixes: TypeError",
    );
    expect(describeTesting({ test: testReport({ aiError: "rate limited" }) })).toBe(
      " · browser test: passed first time · the AI tester couldn't run",
    );
  });
});
