import { get, list, put } from "@vercel/blob";
import { cacheLife, cacheTag } from "next/cache";
import { benchmarkOf } from "./benchmark";
import { computeBenchmark, computeLeaderboard } from "./leaderboard";
import type { Replay } from "./types";

// Replays live in Vercel Blob:
//   replays/<id>.json   one file per battle, with every event
//   replays/index.json  a short summary of each battle, newest first
// Pages read the index rather than calling list(), because list() and uploads are
// "advanced operations" with a monthly allowance on the Hobby plan.

export type ReplaySummary = { id: string; challenge: string; winner?: string; createdAt: string; rematchOf?: string };

/** Revalidate this tag to refresh every page that reads replays. */
export const REPLAYS_TAG = "replays";
const INDEX_PATH = "replays/index.json";
const MAX_INDEXED = 200;

/** Reads straight from storage, bypassing the CDN, so the index is never a stale copy. */
async function readJson<T>(pathname: string): Promise<T | null> {
  try {
    const res = await get(pathname, { access: "public", useCache: false });
    if (!res || res.statusCode !== 200) return null;
    return (await new Response(res.stream).json()) as T;
  } catch {
    return null; // not saved yet, or Blob isn't connected
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
  ...(rematchOf && { rematchOf }),
});

/** Saves a replay and adds it to the index, restoring any saved replay the index is missing. */
export async function saveReplay(replay: Replay) {
  await writeJson(`replays/${replay.id}.json`, replay);

  const index = (await readJson<ReplaySummary[]>(INDEX_PATH)) ?? [];
  const summaries = [summarise(replay), ...index.filter((r) => r.id !== replay.id)];
  summaries.push(...(await missingFromIndex(new Set(summaries.map((r) => r.id)))));

  summaries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  await writeJson(INDEX_PATH, summaries.slice(0, MAX_INDEXED));
}

async function missingFromIndex(known: Set<string>): Promise<ReplaySummary[]> {
  const { blobs } = await list({ prefix: "replays/", limit: 1000 });
  const missing = blobs.filter((blob) => blob.pathname !== INDEX_PATH && !known.has(replayIdOf(blob.pathname)));
  const replays = await Promise.all(missing.map((blob) => readJson<Replay>(blob.pathname)));
  return replays.filter((r): r is Replay => r !== null).map(summarise);
}

const replayIdOf = (pathname: string) => pathname.replace(/^replays\/|\.json$/g, "");

export async function listReplays(): Promise<ReplaySummary[]> {
  "use cache";
  cacheTag(REPLAYS_TAG);
  cacheLife("days");
  return (await readJson<ReplaySummary[]>(INDEX_PATH)) ?? [];
}

export async function getReplay(id: string): Promise<Replay | null> {
  "use cache";
  cacheLife("max"); // a replay never changes once saved
  if (!/^[\w-]+$/.test(id)) return null;
  return readJson<Replay>(`replays/${id}.json`);
}

async function getReplays(summaries: ReplaySummary[]): Promise<Replay[]> {
  const replays = await Promise.all(summaries.map((r) => getReplay(r.id)));
  return replays.filter((r): r is Replay => r !== null);
}

export async function getLeaderboard() {
  "use cache";
  cacheTag(REPLAYS_TAG);
  cacheLife("days");
  const replays = await getReplays(await listReplays());
  return {
    all: computeLeaderboard(replays),
    tested: computeLeaderboard(replays, "tested"),
    benchmark: computeBenchmark(replays),
  };
}

/** Runs per benchmark challenge, read fresh: the benchmark runner picks the next battle from this. */
export async function getBenchmarkRuns() {
  const index = (await readJson<ReplaySummary[]>(INDEX_PATH)) ?? [];
  const candidates = index.filter((r) => benchmarkOf(r.challenge) && !r.rematchOf);
  return computeBenchmark(await getReplays(candidates)).runs.map(({ id, title, challenge, runs }) => ({ id, title, challenge, runs }));
}
