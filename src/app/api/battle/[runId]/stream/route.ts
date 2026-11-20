import { revalidateTag } from "next/cache";
import { getRun } from "workflow/api";
import { REPLAYS_TAG } from "@/lib/replays";
import type { BattleEvent } from "@/lib/types";

// A battle can outlast one function call (300 seconds on the free plan), so this
// route streams for up to 4 minutes, then ends. The page reconnects with
// ?from=<events seen so far> and carries on exactly where it left off.
export const maxDuration = 300;
const STREAM_FOR_MS = 240_000;

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
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          // One JSON event per line (NDJSON).
          controller.enqueue(encoder.encode(JSON.stringify(value) + "\n"));
          if (value?.type === "replay") {
            try {
              revalidateTag(REPLAYS_TAG, "max"); // make sure the gallery shows the new battle
            } catch {}
          }
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
