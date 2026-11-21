"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { battleReducer, emptyBattle } from "@/lib/battle-state";
import type { BattleEvent } from "@/lib/types";
import { errorMessage, sleep } from "@/lib/utils";

const MAX_QUIET_RECONNECTS = 3;

/** Starts battles and follows their event streams into battle state. */
export function useBattleStream() {
  const [state, dispatch] = useReducer(battleReducer, emptyBattle);
  const [fighting, setFighting] = useState(false);
  const [error, setError] = useState<string>();
  const watching = useRef<AbortController>(null);

  /**
   * Follows a battle until its "done" event. The stream route ends after a few minutes,
   * so this reconnects from the number of events already seen. Resolves true if the
   * battle finished, false if the stream failed or went quiet.
   */
  const watch = useCallback(async (runId: string): Promise<boolean> => {
    watching.current?.abort();
    const controller = new AbortController();
    watching.current = controller;
    dispatch({ type: "reset" });
    setFighting(true);
    setError(undefined);

    let seen = 0;
    let quietReconnects = 0;
    let finished = false;
    try {
      while (!finished && !controller.signal.aborted) {
        const res = await fetch(`/api/battle/${runId}/stream?from=${seen}`, { signal: controller.signal });
        if (!res.ok || !res.body) throw new Error(`Couldn't watch the battle (${res.status})`);
        let received = 0;
        for await (const event of readEvents(res.body)) {
          seen++;
          received++;
          dispatch(event);
          if (event.type === "done") finished = true;
        }
        if (finished) break;
        quietReconnects = received ? 0 : quietReconnects + 1;
        if (quietReconnects >= MAX_QUIET_RECONNECTS) throw new Error("The battle stream went quiet. Refresh to try again.");
        await sleep(1000);
      }
    } catch (err) {
      if (!controller.signal.aborted) setError(errorMessage(err));
    } finally {
      if (watching.current === controller) setFighting(false);
    }
    return finished;
  }, []);

  /** Starts a battle and returns its run id, or undefined with the reason in `error`. */
  const launch = useCallback(async (challenge: string, arenaKey: string): Promise<string | undefined> => {
    setFighting(true);
    setError(undefined);
    try {
      const res = await fetch("/api/battle", {
        method: "POST",
        headers: { "content-type": "application/json", "x-arena-key": arenaKey },
        body: JSON.stringify({ challenge }),
      });
      const body = (await res.json().catch(() => ({}))) as { runId?: string; error?: string };
      if (!res.ok || !body.runId) throw new Error(body.error ?? `The arena said no (${res.status})`);
      window.history.replaceState(null, "", `?run=${body.runId}`);
      return body.runId;
    } catch (err) {
      setError(errorMessage(err));
      setFighting(false);
      return undefined;
    }
  }, []);

  // A ?run= link (or a refresh mid-battle) picks the battle up again.
  useEffect(() => {
    const runId = new URLSearchParams(window.location.search).get("run");
    const resume = runId ? setTimeout(() => watch(runId)) : undefined;
    return () => {
      clearTimeout(resume);
      watching.current?.abort();
    };
  }, [watch]);

  return { state, fighting, error, setError, watch, launch };
}

/** Parses an NDJSON response body into battle events. */
async function* readEvents(body: NonNullable<Response["body"]>): AsyncGenerator<BattleEvent> {
  const reader = body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (let next = await reader.read(); !next.done; next = await reader.read()) {
    buffer += next.value;
    let newline;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) yield JSON.parse(line) as BattleEvent;
    }
  }
}
