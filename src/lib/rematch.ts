import { hasEntries, testsOf, verdictOf } from "./replay-events";
import type { Replay, RematchPlan, Score } from "./types";
import { mean, ordinal, roundTo, shuffle } from "./utils";

// A rematch runs a saved battle's challenge again. A random half of the gladiators are
// "coached": they read the judge's verdict on their last entry before writing. The rest
// are the control group. The judge isn't told which is which. Comparing the two groups'
// change in score shows whether the feedback helped, rather than chance.

/** Plans a rematch of `replay`, or returns null if it has nothing to learn from. */
export function planRematch(replay: Replay, gladiatorIds: string[]): RematchPlan | null {
  const verdict = verdictOf(replay);
  if (!verdict || !hasEntries(replay)) return null;

  const ranked = verdict.scores; // best first
  const previous: RematchPlan["previous"] = {};
  const feedback: RematchPlan["feedback"] = {};
  for (const [i, score] of ranked.entries()) {
    if (!gladiatorIds.includes(score.gladiator)) continue;
    previous[score.gladiator] = { total: score.total, rank: i + 1 };
    feedback[score.gladiator] = feedbackFor(replay, score, i + 1, ranked);
  }

  const eligible = Object.keys(previous);
  if (eligible.length < 2) return null;
  const coached = shuffle(eligible).slice(0, Math.floor(eligible.length / 2));

  return {
    of: replay.id,
    coached,
    previous,
    feedback: Object.fromEntries(coached.map((id) => [id, feedback[id]])),
  };
}

function feedbackFor(replay: Replay, score: Score, rank: number, ranked: Score[]): string {
  const finalTest = testsOf(replay, score.gladiator).at(-1);
  const problems = finalTest && !finalTest.passed ? [...finalTest.errors, ...(finalTest.ai?.bugs ?? [])].slice(0, 3) : [];
  return [
    `You have taken on this exact challenge before. You came ${ordinal(rank)} of ${ranked.length}, scoring ${score.total}/30 ` +
      `(creativity ${score.creativity}, polish ${score.polish}, fidelity to the challenge ${score.fidelity}).`,
    `The judge's verdict on your entry: "${score.roast}"`,
    ...(rank > 1 ? [`The winning entry scored ${ranked[0].total}/30.`] : []),
    ...(problems.length
      ? [`When your final version was tested, these problems were still there:\n${problems.map((p) => `- ${p}`).join("\n")}`]
      : []),
    "Use this feedback to build a better entry this time.",
  ].join("\n");
}

/** The average change in score since last time, for the coached and control groups. */
export function groupChange(plan: RematchPlan, scores: Score[]): { coached?: number; control?: number } {
  const averageChange = (ids: string[]) => {
    const changes = ids.flatMap((id) => {
      const now = scores.find((s) => s.gladiator === id);
      const before = plan.previous[id];
      return now && before ? [now.total - before.total] : [];
    });
    const average = mean(changes);
    return average === undefined ? undefined : roundTo(average);
  };
  const control = Object.keys(plan.previous).filter((id) => !plan.coached.includes(id));
  return { coached: averageChange(plan.coached), control: averageChange(control) };
}
