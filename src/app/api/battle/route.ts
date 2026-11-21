import { checkBotId } from "botid/server";
import { start } from "workflow/api";
import { GLADIATORS, LIMITS } from "@/lib/gladiators";
import { planRematch } from "@/lib/rematch";
import { getReplay } from "@/lib/replays";
import { battleWorkflow } from "@/workflows/battle";

// This route hands the fight to Vercel Workflow and returns straight away with
// the run's id. The page then watches it at /api/battle/<runId>/stream.
export async function POST(req: Request) {
  // 1. Only you can start a live battle: everyone else watches replays.
  if (!process.env.ARENA_KEY || req.headers.get("x-arena-key") !== process.env.ARENA_KEY) {
    return Response.json({ error: "The arena is closed. Watch the replays instead." }, { status: 401 });
  }
  // 2. Bots can't burn your credit even if the key leaks.
  const { isBot } = await checkBotId();
  if (isBot) return Response.json({ error: "Bots are not allowed in the arena." }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as { challenge?: unknown; rematchOf?: unknown };

  // A rematch takes its challenge, and the feedback for half the gladiators, from a saved battle.
  let rematch;
  let challenge = String(body.challenge ?? "").trim().slice(0, LIMITS.maxChallengeLength);
  if (body.rematchOf) {
    const original = await getReplay(String(body.rematchOf));
    if (!original) return Response.json({ error: "That battle isn't in the replays." }, { status: 404 });
    rematch = planRematch(original, GLADIATORS.map((g) => g.id)) ?? undefined;
    if (!rematch) return Response.json({ error: "That battle has no judged entries to learn from." }, { status: 400 });
    challenge = original.challenge;
  }
  if (!challenge) return Response.json({ error: "Give the gladiators a challenge." }, { status: 400 });

  const battleId = `${new Date().toISOString().slice(0, 10)}-${crypto.randomUUID().slice(0, 8)}`;
  const run = await start(battleWorkflow, [{ battleId, challenge, startedAt: Date.now(), rematch }]);
  return Response.json({ runId: run.runId, battleId });
}
