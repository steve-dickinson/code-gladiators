import { head, put } from "@vercel/blob";
import { cacheLife, cacheTag } from "next/cache";
import type { Replay } from "./types";

// Replays live in Vercel Blob:
//   replays/<id>.json   one file per battle (every event, token by token)
//   replays/index.json  a small list the gallery reads, newest first
//
// Why an index instead of list()? On Hobby, uploads and list() calls are
// "advanced operations" and only 2,000 are included each month. The gallery
// would call list() on every refresh; this design costs 2 per battle instead.

export type ReplaySummary = { id: string; challenge: string; winner?: string; createdAt: string };

export const REPLAYS_TAG = "replays";

async function readJson<T>(pathname: string): Promise<T | null> {
  try {
    const { url } = await head(pathname); // metadata lookup: a cheap "simple operation"
    const res = await fetch(`${url}?v=${Date.now()}`); // skip any stale CDN copy
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null; // not found yet, or Blob not connected (e.g. your first build)
  }
}

async function writeJson(pathname: string, data: unknown) {
  await put(pathname, JSON.stringify(data), {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 60,
  });
}

export async function saveReplay(replay: Replay) {
  await writeJson(`replays/${replay.id}.json`, replay);
  const index = (await readJson<ReplaySummary[]>("replays/index.json")) ?? [];
  const { id, challenge, winner, createdAt } = replay;
  await writeJson("replays/index.json", [{ id, challenge, winner, createdAt }, ...index].slice(0, 200));
}

export async function listReplays(): Promise<ReplaySummary[]> {
  "use cache";
  cacheTag(REPLAYS_TAG); // refreshed straight after each battle
  cacheLife("days"); // otherwise, no Blob reads at all for most visitors
  return (await readJson<ReplaySummary[]>("replays/index.json")) ?? [];
}

export async function getReplay(id: string): Promise<Replay | null> {
  "use cache";
  cacheLife("max"); // a replay never changes once it's saved
  if (!/^[\w-]+$/.test(id)) return null;
  return readJson<Replay>(`replays/${id}.json`);
}
