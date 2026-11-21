import { revalidateTag } from "next/cache";
import { getRun } from "workflow/api";
import { REPLAYS_TAG } from "@/lib/replays";
import type { BattleEvent } from "@/lib/types";

export const maxDuration = 300;
/** Ends the response before the function's time limit; the page reconnects with ?from=. */
const STREAM_FOR_MS = 240_000;

/**
 * Streams a battle's events as NDJSON, starting from event number `?from=`. A battle can
 * outlast one request, so the page reconnects and carries on where it left off.
 */
export async function GET(req: Request, ctx: RouteContext<"/api/battle/[runId]/stream">) {
  const { runId } = await ctx.params;
  if (!/^[\w-]+$/.test(runId)) return new Response("Bad run id", { status: 400 });
  const from = Math.max(0, Number(new URL(req.url).searchParams.get("from")) || 0);

  let reader: ReadableStreamDefaultReader<BattleEvent>;
  try {
    reader = getRun(runId).getReadable<BattleEvent>({ startIndex: from }).getReader();
  } catch {
    return new Response("No such battle", { status: 404 });
  }

  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const stop = setTimeout(() => reader.cancel().catch(() => {}), STREAM_FOR_MS);
      try {
        for (let next = await reader.read(); !next.done; next = await reader.read()) {
          controller.enqueue(encoder.encode(JSON.stringify(next.value) + "\n"));
          if (next.value?.type === "replay") refreshReplayPages();
        }
      } catch (err) {
        console.error("Battle stream broke", err);
      } finally {
        clearTimeout(stop);
        controller.close();
      }
    },
    cancel() {
      reader.cancel().catch(() => {});
    },
  });

  return new Response(body, {
    headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" },
  });
}

function refreshReplayPages() {
  try {
    revalidateTag(REPLAYS_TAG, "max");
  } catch (err) {
    console.warn("Couldn't revalidate the replay pages", err);
  }
}
