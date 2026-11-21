import Link from "next/link";
import type { BattleState } from "@/lib/battle-state";
import { groupChange } from "@/lib/rematch";
import { roundTo } from "@/lib/utils";

/** A difference between the groups smaller than this is treated as noise. */
const MEANINGFUL_GAP = 1.5;

const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`);

/** Who was coached in a rematch, and exactly what they were told. */
export function RematchNote({ state }: { state: BattleState }) {
  const plan = state.rematch!;
  const nameOf = (id: string) => state.gladiators.find((g) => g.id === id)?.name ?? id;
  const control = Object.keys(plan.previous).filter((id) => !plan.coached.includes(id));
  return (
    <div className="mt-2 space-y-1 text-sm text-stone-400">
      <p>
        A rematch of{" "}
        <Link href={`/replays/${plan.of}`} className="text-amber-400 hover:underline">
          an earlier battle
        </Link>
        . <span className="text-sky-300">Coached</span> (shown the judge&apos;s verdict on their last entry):{" "}
        {plan.coached.map(nameOf).join(" and ")}. <span className="text-stone-300">Control</span> (no feedback):{" "}
        {control.map(nameOf).join(" and ")}. The judge doesn&apos;t know which is which.
      </p>
      <details>
        <summary className="cursor-pointer font-mono text-xs text-stone-500 hover:text-stone-300">What the coached gladiators were told</summary>
        <div className="mt-2 space-y-3">
          {plan.coached.map((id) => (
            <div key={id}>
              <p className="font-mono text-xs text-sky-300">{nameOf(id)}</p>
              <pre className="whitespace-pre-wrap font-mono text-xs text-stone-400">{plan.feedback[id]}</pre>
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}

/** A gladiator's change in score since the battle being rematched. */
export function ScoreChange({ before, now, coached }: { before: number; now: number; coached: boolean }) {
  const change = roundTo(now - before);
  const colour = change > 0 ? "text-emerald-400" : change < 0 ? "text-red-400" : "text-stone-400";
  return (
    <span className="font-mono text-xs text-stone-500">
      last time {before} → <span className={colour}>{signed(change)}</span>
      {coached ? " · coached" : " · control"}
    </span>
  );
}

/** Whether the coached gladiators improved more than the control group. */
export function RematchResult({ state }: { state: BattleState }) {
  if (!state.rematch || !state.verdict) return null;
  const { coached, control } = groupChange(state.rematch, state.verdict.scores);
  if (coached === undefined || control === undefined) return null;
  const gap = roundTo(coached - control);
  const reading =
    Math.abs(gap) < MEANINGFUL_GAP
      ? "About the same: no sign the feedback helped this time."
      : gap > 0
        ? "The coached gladiators improved more."
        : "The control group did better: the feedback didn't help this time.";
  return (
    <p className="mt-2 rounded-lg bg-stone-800/60 px-3 py-2 font-mono text-xs text-stone-300">
      Average change since last time: coached {signed(coached)}, control {signed(control)}. {reading}
    </p>
  );
}
