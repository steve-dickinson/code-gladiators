import { streamText, type ModelMessage } from "ai";
import { revalidateTag } from "next/cache";
import { getWritable } from "workflow";
import { deployEntry, openArena, testEntry, type ArenaHandle } from "@/lib/arena";
import { GATEWAY_TAGS, GLADIATORS, LIMITS, type Gladiator } from "@/lib/gladiators";
import { judgeBattle, type JudgeEntry } from "@/lib/judge";
import { extractHtml, fixPrompt, GLADIATOR_SYSTEM, gladiatorPrompt } from "@/lib/prompt";
import { REPLAYS_TAG, saveReplay } from "@/lib/replays";
import type { BattleData, BattleEvent, RecordedEvent, RematchPlan, StampedEvent, TestReport } from "@/lib/types";
import { errorMessage, sleep } from "@/lib/utils";

// The battle's steps. Each runs in its own function call, so each has its own time
// limit and the workflow can resume after a crash. Steps stream events to viewers and
// also return them, so the last step can save the whole battle as a replay.

type Emit = <K extends keyof BattleData>(type: K, data: BattleData[K]) => Promise<void>;

/** Streams events to the run's viewers and keeps a timestamped copy. */
function eventRecorder() {
  const writer = getWritable<BattleEvent>().getWriter();
  const events: StampedEvent[] = [];
  const emit: Emit = async (type, data) => {
    const event = { type, data } as BattleEvent;
    events.push({ ...event, at: Date.now() });
    await writer.write(event);
  };
  return { emit, events, release: () => writer.releaseLock() };
}

export async function announceStep(input: { battleId: string; challenge: string; rematch?: RematchPlan }) {
  "use step";
  const { emit, events, release } = eventRecorder();
  try {
    await emit("battle", {
      id: input.battleId,
      challenge: input.challenge,
      maxRounds: LIMITS.maxRounds,
      gladiators: GLADIATORS.map(({ id, name, model, colour }) => ({ id, name, model, colour })),
      ...(input.rematch && { rematch: input.rematch }),
    });
    for (const g of GLADIATORS) await emit("status", { gladiator: g.id, status: "writing", round: 1 });
    return { events };
  } finally {
    release();
  }
}

/** Returns null if the sandbox can't start: the battle carries on with untested entries. */
export async function openArenaStep(gladiatorIds: string[]): Promise<ArenaHandle | null> {
  "use step";
  try {
    return await openArena(gladiatorIds);
  } catch (err) {
    console.error("No sandbox, so no browser tests this battle", err);
    return null;
  }
}

type WriteInput = {
  gladiatorId: string;
  challenge: string;
  round: number;
  /** The last version and its test report, when this round is a fix. */
  previous?: { html: string; report: TestReport };
  /** A rematch's feedback, for coached gladiators. */
  feedback?: string;
};
type WriteResult = { html: string; error?: string; outputTokens: number; costUsd: number; events: StampedEvent[] };

/** Time left in the step after which an empty answer isn't retried. */
const RETRY_WINDOW_MS = 120_000;
const STREAM_FLUSH_MS = 150;

export async function writeStep(input: WriteInput): Promise<WriteResult> {
  "use step";
  const gladiator = GLADIATORS.find((g) => g.id === input.gladiatorId)!;
  const { emit, events, release } = eventRecorder();
  try {
    if (input.round > 1) await emit("status", { gladiator: gladiator.id, status: "fixing", round: input.round });
    const messages = writeMessages(input);
    const startedAt = Date.now();
    let lastError: unknown;

    // A completely empty answer is a provider hiccup, and nothing has been shown yet,
    // so it gets one more try. Anything that streamed is final: viewers have seen it.
    for (let attempt = 1; attempt <= 2; attempt++) {
      const result = await streamEntry(gladiator, messages, emit);
      if (result.html) return { html: result.html, outputTokens: result.outputTokens, costUsd: result.costUsd, events };
      lastError = result.error;
      if (result.streamed || attempt === 2 || Date.now() - startedAt > RETRY_WINDOW_MS) break;
      console.warn(`${gladiator.name} sent back nothing; asking once more`, lastError);
      await sleep(3000);
    }
    return { html: "", error: errorMessage(lastError), outputTokens: 0, costUsd: 0, events };
  } finally {
    release();
  }
}
// A retry would re-stream code viewers have already watched, and cost tokens again.
writeStep.maxRetries = 0;

function writeMessages({ challenge, feedback, previous }: WriteInput): ModelMessage[] {
  const brief: ModelMessage = { role: "user", content: gladiatorPrompt(challenge, feedback) };
  if (!previous) return [brief];
  return [brief, { role: "assistant", content: previous.html }, { role: "user", content: fixPrompt(previous.report) }];
}

/** Streams one answer to viewers in small batches and extracts the HTML from it. */
async function streamEntry(gladiator: Gladiator, messages: ModelMessage[], emit: Emit) {
  let streamError: unknown;
  let streamed = 0;
  try {
    const result = streamText({
      model: gladiator.model,
      system: GLADIATOR_SYSTEM,
      messages,
      maxOutputTokens: LIMITS.maxOutputTokens,
      abortSignal: AbortSignal.timeout(LIMITS.writeTimeoutMs),
      providerOptions: { ...gladiator.providerOptions, gateway: { tags: GATEWAY_TAGS } },
      onError: ({ error }) => {
        streamError = error;
      },
    });

    let buffer = "";
    let lastFlush = Date.now();
    for await (const text of result.textStream) {
      buffer += text;
      streamed += text.length;
      if (Date.now() - lastFlush > STREAM_FLUSH_MS) {
        await emit("delta", { gladiator: gladiator.id, text: buffer });
        buffer = "";
        lastFlush = Date.now();
      }
    }
    if (buffer) await emit("delta", { gladiator: gladiator.id, text: buffer });
    if (streamError) throw streamError;

    const html = extractHtml(await result.text);
    if (!html) throw new Error("The model didn't write any HTML");
    const usage = await result.usage;
    const gatewayMeta = (await result.providerMetadata)?.gateway as { cost?: string | number } | undefined;
    return { html, outputTokens: usage.outputTokens ?? 0, costUsd: Number(gatewayMeta?.cost ?? 0), streamed };
  } catch (err) {
    return { html: "", error: streamError ?? err, outputTokens: 0, costUsd: 0, streamed };
  }
}

export async function testStep(input: { arena: ArenaHandle; gladiatorId: string; html: string; round: number; challenge: string }) {
  "use step";
  const { emit, events, release } = eventRecorder();
  try {
    await emit("status", { gladiator: input.gladiatorId, status: "testing", round: input.round });
    await deployEntry(input.arena, input.gladiatorId, input.html);
    const report = await testEntry(input.arena, input.gladiatorId, input.round, input.challenge);
    await emit("test", { gladiator: input.gladiatorId, ...report });
    return { report, events };
  } finally {
    release();
  }
}
// One retry covers a browser hiccup.
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
  const { emit, events, release } = eventRecorder();
  try {
    const { gladiatorId: gladiator, round, outputTokens, costUsd } = input;
    const ms = Date.now() - input.startedAt;
    if (!input.html) {
      await emit("status", { gladiator, status: "failed", error: input.error ?? "No entry", outputTokens, costUsd, ms });
      return { events };
    }
    // Serve the last version that was written successfully.
    const previewUrl = input.arena ? await deployEntry(input.arena, gladiator, input.html).catch(() => undefined) : undefined;
    await emit("status", { gladiator, status: "live", round, previewUrl, outputTokens, costUsd, ms });
    return { events };
  } finally {
    release();
  }
}

export async function judgeStep(input: { challenge: string; entries: JudgeEntry[] }) {
  "use step";
  const verdict = await judgeBattle(input.challenge, input.entries);
  const { emit, events, release } = eventRecorder();
  try {
    await emit("verdict", verdict);
    return { winner: verdict.winner, events };
  } finally {
    release();
  }
}
// judgeBattle already falls back through several judges.
judgeStep.maxRetries = 1;

export async function finishBattleStep(input: {
  battleId: string;
  challenge: string;
  startedAt: number;
  winner?: string;
  events: StampedEvent[];
  rematchOf?: string;
}) {
  "use step";
  const { emit, release } = eventRecorder();
  try {
    await saveReplay({
      id: input.battleId,
      createdAt: new Date(input.startedAt).toISOString(),
      challenge: input.challenge,
      winner: input.winner,
      ...(input.rematchOf && { rematchOf: input.rematchOf }),
      events: toRecordedEvents(input.events, input.startedAt),
    });
    refreshReplayPages();
    await emit("replay", { id: input.battleId });
    await emit("done", { ok: true });
  } catch (err) {
    console.error("Could not save the replay", err);
    await emit("done", { ok: false });
  } finally {
    release();
  }
  await getWritable().close(); // ends every viewer's stream
}

/** Steps ran side by side, so events are put back in the order they happened. */
function toRecordedEvents(events: StampedEvent[], startedAt: number): RecordedEvent[] {
  return events.toSorted((a, b) => a.at - b.at).map(({ at, ...event }) => ({ ...event, t: Math.max(0, at - startedAt) }) as RecordedEvent);
}

function refreshReplayPages() {
  try {
    revalidateTag(REPLAYS_TAG, "max");
  } catch (err) {
    // Not always available inside a workflow step; the stream route revalidates too.
    console.warn("Couldn't revalidate the replay pages from the workflow", err);
  }
}
