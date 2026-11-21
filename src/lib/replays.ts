import { get, list, put } from "@vercel/blob";
import { cacheLife, cacheTag } from "next/cache";
import { computeBenchmark, computeLeaderboard } from "./leaderboard";
import type { Replay } from "./types";

// Replays live in Vercel Blob:
//   replays/<id>.json   one file per battle (every event, token by token)
//   replays/index.json  a small list the gallery reads, newest first
//
// Why an index instead of calling list() for every visitor? On Hobby, uploads and
// list() calls are "advanced operations", and only 2,000 are included each month.
// This design costs 3 per battle (save, check, update the index) and 0 per page view.

export type ReplaySummary = { id: string; challenge: string; winner?: string; createdAt: string; rematchOf?: string };

export const REPLAYS_TAG = "replays";
const INDEX = "replays/index.json";

// Read straight from storage, skipping the CDN. An early version read through the
// CDN, got a cached copy of the index that was minutes old, and saved over it,
// quietly dropping a battle from the gallery.
async function readJson<T>(pathname: string): Promise<T | null> {
  try {
    const res = await get(pathname, { access: "public", useCache: false });
    if (!res || res.statusCode !== 200) return null;
    return (await new Response(res.stream).json()) as T;
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

const summarise = ({ id, challenge, winner, createdAt, rematchOf }: Replay): ReplaySummary => ({
  id,
  challenge,
  winner,
  createdAt,
  ...(rematchOf ? { rematchOf } : {}),
});

export async function saveReplay(replay: Replay) {
  await writeJson(`replays/${replay.id}.json`, replay);

  const index = (await readJson<ReplaySummary[]>(INDEX)) ?? [];
  const summaries = [summarise(replay), ...index.filter((r) => r.id !== replay.id)];

  // Self-repair: add back any saved battle the index is missing.
  const known = new Set(summaries.map((r) => r.id));
  const { blobs } = await list({ prefix: "replays/", limit: 1000 });
  for (const blob of blobs) {
    const id = blob.pathname.replace(/^replays\/|\.json$/g, "");
    if (blob.pathname === INDEX || known.has(id)) continue;
    const missing = await readJson<Replay>(blob.pathname);
    if (missing) summaries.push(summarise(missing));
  }

  summaries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  await writeJson(INDEX, summaries.slice(0, 200));
}

export async function listReplays(): Promise<ReplaySummary[]> {
  "use cache";
  cacheTag(REPLAYS_TAG); // refreshed straight after each battle
  cacheLife("days"); // otherwise, no Blob reads at all for most visitors
  return (await readJson<ReplaySummary[]>(INDEX)) ?? [];
}

export async function getReplay(id: string): Promise<Replay | null> {
  "use cache";
  cacheLife("max"); // a replay never changes once it's saved
  if (!/^[\w-]+$/.test(id)) return null;
  return readJson<Replay>(`replays/${id}.json`);
}

// The leaderboard reads every saved battle. Each replay is cached for good once read,
// and the result is refreshed straight after each battle, like the gallery.
export async function getLeaderboard() {
  "use cache";
  cacheTag(REPLAYS_TAG);
  cacheLife("days");
  const summaries = await listReplays();
  const replays = (await Promise.all(summaries.map((r) => getReplay(r.id)))).filter((r): r is Replay => r !== null);
  return { all: computeLeaderboard(replays), tested: computeLeaderboard(replays, "tested"), benchmark: computeBenchmark(replays) };
}
