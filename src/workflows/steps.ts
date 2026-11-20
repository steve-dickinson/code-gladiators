import { streamText } from "ai";
import { revalidateTag } from "next/cache";
import { getWritable } from "workflow";
import { deploy, openArena, playtest, type ArenaHandle } from "@/lib/arena";
import { GATEWAY_TAGS, GLADIATORS, LIMITS } from "@/lib/gladiators";
import { judgeBattle, type JudgeEntry } from "@/lib/judge";
import { extractHtml, fixPrompt, GLADIATOR_SYSTEM, gladiatorPrompt } from "@/lib/prompt";
import { REPLAYS_TAG, saveReplay } from "@/lib/replays";
import type { BattleData, BattleEvent, RecordedEvent, StampedEvent, TestReport } from "@/lib/types";

// Every step does real work (call a model, drive a browser, save a file) and runs
// in its own function call, with its own 300 seconds. The workflow in battle.ts
// strings them together and remembers each result, so a battle can run as long
// as it needs and survive a crash part-way through.
//
// Steps stream events to the browser through the run's stream (getWritable), and
// also return them, so the last step can save the whole fight as a replay.

type Emit = <K extends keyof BattleData>(type: K, data: BattleData[K]) => Promise<void>;

function recorder() {
  const writer = getWritable<BattleEvent>().getWriter();
  const events: StampedEvent[] = [];
  const emit: Emit = async (type, data) => {
    const event = { type, data } as BattleEvent;
    events.push({ ...event, at: Date.now() });
    await writer.write(event);
  };
  return { emit, events, release: () => writer.releaseLock() };
}

export async function announceStep(input: { battleId: string; challenge: string }) {
  "use step";
  const { emit, events, release } = recorder();
  await emit("battle", {
    id: input.battleId,
    challenge: input.challenge,
    maxRounds: LIMITS.maxRounds,
    gladiators: GLADIATORS.map(({ id, name, model, colour }) => ({ id, name, model, colour })),
  });
  for (const g of GLADIATORS) await emit("status", { gladiator: g.id, status: "writing", round: 1 });
  release();
  return { events };
}

// Without a sandbox the battle still runs: games preview in the viewer's browser, untested.
export async function openArenaStep(gladiatorIds: string[]): Promise<ArenaHandle | null> {
  "use step";
  try {
    return await openArena(gladiatorIds);
  } catch (err) {
    console.error("No sandbox, so no browser tests this battle", err);
    return null;
  }
}

export async function writeStep(input: {
  gladiatorId: string;
  challenge: string;
  round: number;
  previous?: { html: string; report: TestReport };
}) {
  "use step";
  const g = GLADIATORS.find((x) => x.id === input.gladiatorId)!;
  const { emit, events, release } = recorder();
  if (input.round > 1) await emit("status", { gladiator: g.id, status: "fixing", round: input.round });

  let streamError: unknown; // the real reason a model failed (rate limit, free tier, outage…)
  try {
    const result = streamText({
      model: g.model,
      system: GLADIATOR_SYSTEM,
      messages: input.previous
        ? [
            { role: "user", content: gladiatorPrompt(input.challenge) },
            { role: "assistant", content: input.previous.html },
            { role: "user", content: fixPrompt(input.previous.report) },
          ]
        : [{ role: "user", content: gladiatorPrompt(input.challenge) }],
      maxOutputTokens: LIMITS.maxOutputTokens,
      abortSignal: AbortSignal.timeout(LIMITS.writeTimeoutMs),
      providerOptions: { ...g.providerOptions, gateway: { tags: GATEWAY_TAGS } },
      onError: ({ error }) => {
        streamError = error;
      },
    });

    // Batch tokens into ~150ms chunks: smoother UI, far fewer stream writes.
    let buffer = "";
    let lastFlush = Date.now();
    for await (const text of result.textStream) {
      buffer += text;
      if (Date.now() - lastFlush > 150) {
        await emit("delta", { gladiator: g.id, text: buffer });
        buffer = "";
        lastFlush = Date.now();
      }
    }
    if (buffer) await emit("delta", { gladiator: g.id, text: buffer });
    if (streamError) throw streamError;

    const usage = await result.usage;
    const meta = (await result.providerMetadata)?.gateway as { cost?: string | number } | undefined;
    const html = extractHtml(await result.text);
    if (!html) throw new Error("The model didn't write any HTML");
    return { html, outputTokens: usage.outputTokens ?? 0, costUsd: Number(meta?.cost ?? 0), events };
  } catch (err) {
    const reason = streamError ?? err;
    const message = (reason instanceof Error ? reason.message : String(reason)).slice(0, 200);
    return { html: "", error: message, outputTokens: 0, costUsd: 0, events };
  } finally {
    release();
  }
}
// Never retry a write: the viewer has already watched it stream, and it costs tokens.
writeStep.maxRetries = 0;

export async function testStep(input: { arena: ArenaHandle; gladiatorId: string; html: string; round: number }) {
  "use step";
  const { emit, events, release } = recorder();
  try {
    await emit("status", { gladiator: input.gladiatorId, status: "testing", round: input.round });
    await deploy(input.arena, input.gladiatorId, input.html);
    const report = await playtest(input.arena, input.gladiatorId, input.round);
    await emit("test", { gladiator: input.gladiatorId, ...report });
    return { report, events };
  } finally {
    release();
  }
}
// If the browser itself hiccups, try once more before giving up on testing.
testStep.maxRetries = 1;

export async function finishGladiatorStep(input: {
  arena: ArenaHandle | null;
  gladiatorId: string;
  html: string;
  round: number;
  outputTokens: number;
  costUsd: number;
  error?: string;
  startedAt: number;
}) {
  "use step";
  const { emit, events, release } = recorder();
  try {
    const { gladiatorId: gladiator, round, outputTokens, costUsd } = input;
    const ms = Date.now() - input.startedAt;
    if (!input.html) {
      await emit("status", { gladiator, status: "failed", error: input.error ?? "No entry", outputTokens, costUsd, ms });
      return { events };
    }
    // Serve the final version (the last one to be written successfully).
    const previewUrl = input.arena ? await deploy(input.arena, gladiator, input.html).catch(() => undefined) : undefined;
    await emit("status", { gladiator, status: "live", round, previewUrl, outputTokens, costUsd, ms });
    return { events };
  } finally {
    release();
  }
}

export async function judgeStep(input: { challenge: string; entries: JudgeEntry[] }) {
  "use step";
  const verdict = await judgeBattle(input.challenge, input.entries);
  const { emit, events, release } = recorder();
  await emit("verdict", verdict);
  release();
  return { winner: verdict.winner, events };
}
// Each judging already falls back to a quicker judge, so one retry is plenty.
judgeStep.maxRetries = 1;

export async function finishBattleStep(input: {
  battleId: string;
  challenge: string;
  startedAt: number;
  winner?: string;
  events: StampedEvent[];
}) {
  "use step";
  const { emit, release } = recorder();
  try {
    // Steps ran side by side, so put their events back in the order they happened.
    const recorded = input.events
      .toSorted((a, b) => a.at - b.at)
      .map(({ at, ...e }) => ({ ...e, t: Math.max(0, at - input.startedAt) }) as RecordedEvent);
    await saveReplay({
      id: input.battleId,
      createdAt: new Date(input.startedAt).toISOString(),
      challenge: input.challenge,
      winner: input.winner,
      events: recorded,
    });
    try {
      revalidateTag(REPLAYS_TAG, "max"); // the gallery picks up the new battle on its next visit
    } catch (err) {
      console.warn("Couldn't refresh the gallery from the workflow; the stream route will", err);
    }
    await emit("replay", { id: input.battleId });
    await emit("done", { ok: true });
  } catch (err) {
    console.error("Could not save replay", err);
    await emit("done", { ok: false });
  } finally {
    release();
  }
  await getWritable().close(); // tells every viewer the battle is over
}
