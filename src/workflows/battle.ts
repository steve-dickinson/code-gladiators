import { GLADIATORS, LIMITS } from "@/lib/gladiators";
import type { JudgeEntry } from "@/lib/judge";
import type { RematchPlan, StampedEvent, TestReport } from "@/lib/types";
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

/**
 * One battle as a durable workflow. Every gladiator writes an entry; a browser tests it;
 * if anything breaks, the gladiator reads the report and fixes its code, up to
 * LIMITS.maxRounds versions. Then the judge rules and the battle is saved.
 *
 * Workflow code is replayed from its event log after every step, so it must be
 * deterministic: all real work happens in the steps.
 */
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
    // The sandbox boots while the models write.
    const arenaReady = openArenaStep(GLADIATORS.map((g) => g.id));

    const fight = async (gladiatorId: string, name: string): Promise<JudgeEntry> => {
      let html = "";
      let rounds = 0;
      let test: TestReport | undefined;
      let error: string | undefined;
      let outputTokens = 0;
      let costUsd = 0;

      for (let round = 1; round <= LIMITS.maxRounds; round++) {
        const previous = html && test ? { html, report: test } : undefined;
        const feedback = rematch?.feedback[gladiatorId];
        const written = record(await writeStep({ gladiatorId, challenge, round, previous, feedback }));
        outputTokens += written.outputTokens;
        costUsd += written.costUsd;
        if (!written.html) {
          error = written.error; // a failed fix keeps the last good version
          break;
        }
        html = written.html;
        rounds = round;

        const arena = await arenaReady;
        if (!arena) break;
        try {
          test = record(await testStep({ arena, gladiatorId, html, round, challenge })).report;
        } catch {
          test = undefined; // the browser failed, not the entry
          break;
        }
        if (test.passed) break;
      }

      record(
        await finishGladiatorStep({ arena: await arenaReady, gladiatorId, html, round: rounds, outputTokens, costUsd, error, startedAt }),
      );
      return { id: gladiatorId, name, html, rounds, test };
    };

    const entries = await Promise.all(GLADIATORS.map((g) => fight(g.id, g.name)));

    if (entries.some((e) => e.html)) {
      try {
        winner = record(await judgeStep({ challenge, entries })).winner;
      } catch {
        // No verdict, but the replay is still worth saving.
      }
    }
  } finally {
    await finishBattleStep({ battleId, challenge, startedAt, winner, events, rematchOf: rematch?.of });
  }
  return { battleId, winner };
}
