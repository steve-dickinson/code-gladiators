import { GLADIATORS, LIMITS } from "@/lib/gladiators";
import type { JudgeEntry } from "@/lib/judge";
import type { RematchPlan } from "@/lib/rematch";
import type { StampedEvent, TestReport } from "@/lib/types";
import {
  announceStep,
  finishBattleStep,
  finishGladiatorStep,
  judgeStep,
  openArenaStep,
  testStep,
  writeStep,
} from "./steps";

export type BattleInput = { battleId: string; challenge: string; startedAt: number; rematch?: RematchPlan };

// One battle, as a durable workflow. Each gladiator writes its game, a real browser
// plays it, and if anything breaks the gladiator reads the errors and fixes its
// own code, up to LIMITS.maxRounds versions. Then the judge rules and the fight is saved.
//
// This function only orchestrates. It must be deterministic (it's replayed from
// its event log after every step), so all real work lives in the steps.
export async function battleWorkflow({ battleId, challenge, startedAt, rematch }: BattleInput) {
  "use workflow";

  const events: StampedEvent[] = [];
  const record = <T extends { events: StampedEvent[] }>(result: T) => {
    events.push(...result.events);
    return result;
  };

  let winner: string | undefined;
  try {
    record(await announceStep({ battleId, challenge, rematch }));

    // Boot the sandbox and its browser while the models start typing.
    const arenaPromise = openArenaStep(GLADIATORS.map((g) => g.id));

    const fight = async (id: string, name: string): Promise<JudgeEntry> => {
      let html = "";
      let rounds = 0;
      let test: TestReport | undefined;
      let error: string | undefined;
      let outputTokens = 0;
      let costUsd = 0;

      for (let round = 1; round <= LIMITS.maxRounds; round++) {
        const previous = html && test ? { html, report: test } : undefined;
        // In a rematch, coached gladiators read last time's feedback; the control group doesn't.
        const feedback = rematch?.feedback[id];
        const written = record(await writeStep({ gladiatorId: id, challenge, round, previous, feedback }));
        outputTokens += written.outputTokens;
        costUsd += written.costUsd;
        if (!written.html) {
          error = written.error; // a failed fix keeps the last good version
          break;
        }
        html = written.html;
        rounds = round;

        const arena = await arenaPromise;
        if (!arena) break;
        try {
          test = record(await testStep({ arena, gladiatorId: id, html, round, challenge })).report;
        } catch {
          test = undefined; // the browser broke, not the game: stop testing this one
          break;
        }
        if (test.passed) break;
      }

      record(
        await finishGladiatorStep({
          arena: await arenaPromise,
          gladiatorId: id,
          html,
          round: rounds,
          outputTokens,
          costUsd,
          error,
          startedAt,
        }),
      );
      return { id, name, html, rounds, test };
    };

    const entries = await Promise.all(GLADIATORS.map((g) => fight(g.id, g.name)));

    try {
      winner = record(await judgeStep({ challenge, entries })).winner;
    } catch {
      // No verdict this time; the replay is still worth keeping.
    }
  } finally {
    await finishBattleStep({ battleId, challenge, startedAt, winner, events, rematchOf: rematch?.of });
  }
  return { battleId, winner };
}
