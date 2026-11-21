import { checkBotId } from "botid/server";
import { start } from "workflow/api";
import { GLADIATORS, LIMITS } from "@/lib/gladiators";
import { planRematch } from "@/lib/rematch";
import { getReplay } from "@/lib/replays";
import type { RematchPlan } from "@/lib/types";
import { battleWorkflow } from "@/workflows/battle";

type BattleRequest = { challenge?: unknown; rematchOf?: unknown };

/**
 * Starts a battle as a workflow and returns its run id straight away. The page then
 * follows it at /api/battle/<runId>/stream. Body: `{ challenge }` or `{ rematchOf }`.
 */
export async function POST(req: Request) {
  if (!process.env.ARENA_KEY || req.headers.get("x-arena-key") !== process.env.ARENA_KEY) {
    return Response.json({ error: "The arena is closed. Watch the replays instead." }, { status: 401 });
  }
  const { isBot } = await checkBotId();
  if (isBot) return Response.json({ error: "Bots are not allowed in the arena." }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as BattleRequest;
  const resolved = body.rematchOf ? await rematchOf(String(body.rematchOf)) : newChallenge(body.challenge);
  if ("error" in resolved) return Response.json({ error: resolved.error }, { status: resolved.status });

  const battleId = `${new Date().toISOString().slice(0, 10)}-${crypto.randomUUID().slice(0, 8)}`;
  const run = await start(battleWorkflow, [{ battleId, challenge: resolved.challenge, startedAt: Date.now(), rematch: resolved.rematch }]);
  return Response.json({ runId: run.runId, battleId });
}

type Resolved = { challenge: string; rematch?: RematchPlan } | { error: string; status: number };

function newChallenge(input: unknown): Resolved {
  const challenge = String(input ?? "").trim().slice(0, LIMITS.maxChallengeLength);
  return challenge ? { challenge } : { error: "Give the gladiators a challenge.", status: 400 };
}

/** Same challenge as a saved battle, with feedback for a random half of the gladiators. */
async function rematchOf(replayId: string): Promise<Resolved> {
  const original = await getReplay(replayId);
  if (!original) return { error: "That battle isn't in the replays.", status: 404 };
  const rematch = planRematch(original, GLADIATORS.map((g) => g.id));
  if (!rematch) return { error: "That battle has no judged entries to learn from.", status: 400 };
  return { challenge: original.challenge, rematch };
}
