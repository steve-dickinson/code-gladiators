import { createUIMessageStream, createUIMessageStreamResponse, streamText, type InferUIMessageChunk } from "ai";
import { checkBotId } from "botid/server";
import { openArena, type Arena } from "@/lib/arena";
import { GATEWAY_TAGS, GLADIATORS, LIMITS } from "@/lib/gladiators";
import { judgeBattle } from "@/lib/judge";
import { extractHtml, GLADIATOR_SYSTEM, gladiatorPrompt } from "@/lib/prompt";
import { revalidateTag } from "next/cache";
import { REPLAYS_TAG, saveReplay } from "@/lib/replays";
import type { BattleData, BattleMessage, RecordedEvent } from "@/lib/types";

// Fluid compute keeps this function alive while four models stream at once.
export const maxDuration = 300;

export async function POST(req: Request) {
  // 1. Only you can start a live battle: everyone else watches replays.
  if (!process.env.ARENA_KEY || req.headers.get("x-arena-key") !== process.env.ARENA_KEY) {
    return Response.json({ error: "The arena is closed. Watch the replays instead." }, { status: 401 });
  }
  // 2. Bots can't burn your credit even if the key leaks.
  const { isBot } = await checkBotId();
  if (isBot) return Response.json({ error: "Bots are not allowed in the arena." }, { status: 403 });

  const { messages }: { messages: BattleMessage[] } = await req.json();
  const last = messages.at(-1);
  const challenge = (last?.parts.find((p) => p.type === "text")?.text ?? "").trim().slice(0, LIMITS.maxChallengeLength);
  if (!challenge) return Response.json({ error: "Give the gladiators a challenge." }, { status: 400 });

  const battleId = `${new Date().toISOString().slice(0, 10)}-${crypto.randomUUID().slice(0, 8)}`;
  const startedAt = Date.now();
  const events: RecordedEvent[] = [];

  const stream = createUIMessageStream<BattleMessage>({
    execute: async ({ writer }) => {
      writer.write({ type: "start" });
      // Every event goes to the browser AND into the replay recording.
      const emit = <K extends keyof BattleData>(type: K, data: BattleData[K]) => {
        events.push({ t: Date.now() - startedAt, type, data } as RecordedEvent);
        writer.write({ type: `data-${type}`, data, transient: true } as InferUIMessageChunk<BattleMessage>);
      };

      emit("battle", {
        id: battleId,
        challenge,
        gladiators: GLADIATORS.map(({ id, name, model, colour }) => ({ id, name, model, colour })),
      });

      // Open the sandbox while the models start typing.
      const arenaPromise: Promise<Arena | null> = openArena(GLADIATORS.map((g) => g.id)).catch((err) => {
        console.error("Sandbox failed, falling back to in-browser previews", err);
        return null;
      });

      const results = await Promise.all(
        GLADIATORS.map(async (g) => {
          const t0 = Date.now();
          emit("status", { gladiator: g.id, status: "writing" });
          let streamError: unknown; // the real reason a model failed (rate limit, free tier, outage…)
          try {
            const result = streamText({
              model: g.model,
              system: GLADIATOR_SYSTEM,
              prompt: gladiatorPrompt(challenge),
              maxOutputTokens: LIMITS.maxOutputTokens,
              abortSignal: AbortSignal.timeout(LIMITS.battleTimeoutMs),
              providerOptions: { gateway: { tags: GATEWAY_TAGS } },
              onError: ({ error }) => {
                streamError = error;
              },
            });

            // Batch tokens into ~100ms chunks: smoother UI, much smaller replay files.
            let buffer = "";
            let lastFlush = Date.now();
            for await (const text of result.textStream) {
              buffer += text;
              if (Date.now() - lastFlush > 100) {
                emit("delta", { gladiator: g.id, text: buffer });
                buffer = "";
                lastFlush = Date.now();
              }
            }
            if (buffer) emit("delta", { gladiator: g.id, text: buffer });
            if (streamError) throw streamError;

            const html = extractHtml(await result.text);
            const usage = await result.usage;
            const meta = (await result.providerMetadata)?.gateway as { cost?: string | number } | undefined;

            emit("status", { gladiator: g.id, status: "deploying" });
            const arena = await arenaPromise;
            const previewUrl = arena ? await arena.deploy(g.id, html) : undefined;

            emit("status", {
              gladiator: g.id,
              status: "live",
              previewUrl,
              outputTokens: usage.outputTokens,
              costUsd: meta?.cost !== undefined ? Number(meta.cost) : undefined,
              ms: Date.now() - t0,
            });
            return { id: g.id, name: g.name, html };
          } catch (err) {
            const reason = streamError ?? err;
            const message = reason instanceof Error ? reason.message : String(reason);
            emit("status", { gladiator: g.id, status: "failed", error: message.slice(0, 200), ms: Date.now() - t0 });
            return { id: g.id, name: g.name, html: "" };
          }
        }),
      );

      // The judge reads every entry and returns a typed verdict.
      try {
        emit("verdict", await judgeBattle(challenge, results));
      } catch (err) {
        console.error("Judge failed", err);
      }

      // Save the whole fight so anyone can replay it for free.
      try {
        const winner = (events.findLast((e) => e.type === "verdict")?.data as BattleData["verdict"] | undefined)?.winner;
        await saveReplay({ id: battleId, createdAt: new Date(startedAt).toISOString(), challenge, winner, events });
        revalidateTag(REPLAYS_TAG, "max"); // the gallery picks up the new battle on its next visit
        emit("replay", { id: battleId });
      } catch (err) {
        console.error("Could not save replay", err);
      }
    },
  });

  return createUIMessageStreamResponse({ stream });
}
