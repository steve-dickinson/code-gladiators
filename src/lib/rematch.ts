import type { BattleData, Replay } from "./types";

// Rematches with memory. A rematch runs the same challenge again. Half the gladiators,
// picked at random, are "coached": before they write, they read the judge's verdict on
// their last entry and anything the testers found. The other half are the control
// group and get no feedback at all. If the coached half improves more than the control
// half, the feedback made the difference; if everyone moves about the same, it was a
// fresh roll of the dice.
//
// To be clear about what "memory" means here: the models don't learn anything. They
// read last time's feedback in their prompt, which is exactly how people use AI at work.
// The judge isn't told who was coached, so it judges blind.

export type RematchPlan = NonNullable<BattleData["battle"]["rematch"]>;

const ordinal = (n: number) =>
  `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : n % 10 === 1 ? "st" : n % 10 === 2 ? "nd" : n % 10 === 3 ? "rd" : "th"}`;

export function planRematch(replay: Replay, gladiatorIds: string[]): RematchPlan | null {
  const verdict = replay.events.findLast((e) => e.type === "verdict")?.data as BattleData["verdict"] | undefined;
  if (!verdict) return null; // nothing to learn from

  const lastTest = (id: string) =>
    replay.events.findLast((e) => e.type === "test" && e.data.gladiator === id)?.data as BattleData["test"] | undefined;

  const previous: RematchPlan["previous"] = {};
  const feedback: RematchPlan["feedback"] = {};
  const ranked = verdict.scores; // already sorted, best first
  for (const [i, s] of ranked.entries()) {
    if (!gladiatorIds.includes(s.gladiator)) continue; // the lineup has changed since
    previous[s.gladiator] = { total: s.total, rank: i + 1 };
    const test = lastTest(s.gladiator);
    const problems = test && !test.passed ? [...test.errors, ...(test.ai?.bugs ?? [])].slice(0, 3) : [];
    feedback[s.gladiator] = [
      `You have taken on this exact challenge before. You came ${ordinal(i + 1)} of ${ranked.length}, scoring ${s.total}/30 ` +
        `(creativity ${s.creativity}, polish ${s.polish}, fidelity to the challenge ${s.fidelity}).`,
      `The judge's verdict on your entry: "${s.roast}"`,
      ...(i > 0 ? [`The winning entry scored ${ranked[0].total}/30.`] : []),
      ...(problems.length ? [`When your final version was tested, these problems were still there:\n${problems.map((p) => `- ${p}`).join("\n")}`] : []),
      "Use this feedback to build a better entry this time.",
    ].join("\n");
  }

  // Coach a random half of those with a previous score; the rest are the control group.
  const eligible = Object.keys(previous);
  if (eligible.length < 2) return null;
  const shuffled = eligible
    .map((id) => ({ id, key: crypto.getRandomValues(new Uint32Array(1))[0] }))
    .sort((a, b) => a.key - b.key)
    .map((x) => x.id);
  const coached = shuffled.slice(0, Math.floor(eligible.length / 2));

  return {
    of: replay.id,
    coached,
    previous,
    feedback: Object.fromEntries(coached.map((id) => [id, feedback[id]])),
  };
}

// For the verdict: how much each group moved, on average.
export function groupChange(plan: RematchPlan, scores: BattleData["verdict"]["scores"]) {
  const change = (ids: string[]) => {
    const deltas = ids.flatMap((id) => {
      const now = scores.find((s) => s.gladiator === id);
      const before = plan.previous[id];
      return now && before ? [now.total - before.total] : [];
    });
    return deltas.length ? Math.round((deltas.reduce((a, b) => a + b, 0) / deltas.length) * 10) / 10 : undefined;
  };
  const control = Object.keys(plan.previous).filter((id) => !plan.coached.includes(id));
  return { coached: change(plan.coached), control: change(control) };
}
