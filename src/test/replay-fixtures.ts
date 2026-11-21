import type { BattleData, BattleEvent, Replay, Score, TestReport } from "@/lib/types";

// Builders for small, readable replays in tests.

export const GLADIATOR_IDS = ["alpha", "beta", "gamma", "delta"] as const;

type GladiatorOutcome = {
  id: string;
  /** Omit for a gladiator that produced no entry. */
  total?: number;
  tests?: Partial<TestReport>[];
  costUsd?: number;
  ms?: number;
};

type ReplayOptions = {
  id?: string;
  challenge?: string;
  createdAt?: string;
  gladiators: GladiatorOutcome[];
  blind?: boolean;
  judged?: boolean;
  rematch?: BattleData["battle"]["rematch"];
};

export function makeReplay({
  id = "2026-11-21-test0001",
  challenge = "A test challenge",
  createdAt = "2026-11-21T12:00:00.000Z",
  gladiators,
  blind = true,
  judged = true,
  rematch,
}: ReplayOptions): Replay {
  const events: BattleEvent[] = [
    {
      type: "battle",
      data: {
        id,
        challenge,
        maxRounds: 3,
        gladiators: gladiators.map((g) => ({ id: g.id, name: `Model ${g.id}`, model: `lab/${g.id}`, colour: "#888888" })),
        ...(rematch && { rematch }),
      },
    },
  ];
  for (const g of gladiators) {
    for (const [i, test] of (g.tests ?? []).entries()) {
      events.push({ type: "test", data: { gladiator: g.id, ...testReport({ round: i + 1, ...test }) } });
    }
    const built = g.total !== undefined;
    events.push({
      type: "status",
      data: { gladiator: g.id, status: built ? "live" : "failed", round: g.tests?.length || 1, costUsd: g.costUsd ?? 0.001, ms: g.ms ?? 60_000 },
    });
  }
  const scores = gladiators
    .filter((g) => g.total !== undefined)
    .map((g): Score => ({ gladiator: g.id, creativity: g.total! / 3, polish: g.total! / 3, fidelity: g.total! / 3, total: g.total!, roast: "ok" }))
    .sort((a, b) => b.total - a.total);
  if (judged && scores.length) {
    events.push({ type: "verdict", data: { winner: scores[0].gladiator, headline: "A battle", scores, blind } });
  }
  return { id, challenge, createdAt, events: events.map((e, t) => ({ ...e, t })) };
}

export function testReport(report: Partial<TestReport> = {}): TestReport {
  return { round: 1, passed: true, errors: [], blank: false, responsive: true, ms: 1000, ...report };
}
