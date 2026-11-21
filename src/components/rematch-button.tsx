"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { errorMessage } from "@/lib/utils";

/** Starts a rematch of a saved battle (see src/lib/rematch.ts), then opens it in the arena. */
export function RematchButton({ replayId }: { replayId: string }) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const router = useRouter();

  async function start(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const res = await fetch("/api/battle", {
        method: "POST",
        headers: { "content-type": "application/json", "x-arena-key": key },
        body: JSON.stringify({ rematchOf: replayId }),
      });
      const body = (await res.json().catch(() => ({}))) as { runId?: string; error?: string };
      if (!res.ok || !body.runId) throw new Error(body.error ?? `The arena said no (${res.status})`);
      router.push(`/?run=${body.runId}`);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-lg border border-sky-700 px-4 py-2 text-sm text-sky-200 hover:border-sky-400 hover:text-sky-100"
      >
        Rematch with memory
      </button>
    );
  }
  return (
    <form onSubmit={start} className="space-y-2 rounded-xl border border-sky-900 bg-sky-950/30 p-4">
      <p className="text-sm text-stone-300">
        Same challenge again. Half the gladiators, picked at random, read the judge&apos;s verdict on their last entry
        first; the other half get nothing, as a control. The judge isn&apos;t told which is which.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="Arena key"
          className="rounded-lg border border-stone-700 bg-stone-900 px-3 py-2 font-mono text-sm text-stone-100 focus:border-sky-500 focus:outline-none"
        />
        <button disabled={busy || !key} className="rounded-lg bg-sky-500 px-4 py-2 font-semibold text-stone-950 disabled:opacity-40">
          {busy ? "Starting…" : "Start the rematch"}
        </button>
      </div>
      {error && <p className="font-mono text-sm text-red-400">{error}</p>}
    </form>
  );
}
