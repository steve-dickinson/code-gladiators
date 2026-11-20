import { checkBotId } from "botid/server";
import { start } from "workflow/api";
import { LIMITS } from "@/lib/gladiators";
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

  const body = (await req.json().catch(() => ({}))) as { challenge?: unknown };
  const challenge = String(body.challenge ?? "").trim().slice(0, LIMITS.maxChallengeLength);
  if (!challenge) return Response.json({ error: "Give the gladiators a challenge." }, { status: 400 });

  const battleId = `${new Date().toISOString().slice(0, 10)}-${crypto.randomUUID().slice(0, 8)}`;
  const run = await start(battleWorkflow, [{ battleId, challenge, startedAt: Date.now() }]);
  return Response.json({ runId: run.runId, battleId });
}
