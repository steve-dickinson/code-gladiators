import { list, put } from "@vercel/blob";
import { cacheLife } from "next/cache";
import type { Replay } from "./types";

// Replays live in Vercel Blob as one JSON file each: replays/<id>.json
// Anyone can watch a replay for free: no model calls, no sandbox.

export async function saveReplay(replay: Replay) {
  await put(`replays/${replay.id}.json`, JSON.stringify(replay), {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
  });
}

export async function listReplays() {
  "use cache";
  cacheLife("minutes"); // new battles show up in the gallery within a few minutes
  // Before Blob is connected (e.g. your first build) there's simply nothing to list.
  const blobs = await list({ prefix: "replays/", limit: 100 }).then((r) => r.blobs, () => []);
  return blobs
    .sort((a, b) => b.uploadedAt.getTime() - a.uploadedAt.getTime())
    .map((b) => ({ id: b.pathname.replace(/^replays\/|\.json$/g, ""), url: b.url, uploadedAt: b.uploadedAt }));
}

export async function getReplay(id: string): Promise<Replay | null> {
  "use cache";
  cacheLife("max"); // a replay never changes once it's saved
  const blobs = await list({ prefix: `replays/${id}.json`, limit: 1 }).then((r) => r.blobs, () => []);
  if (!blobs[0]) return null;
  const res = await fetch(blobs[0].url);
  return res.ok ? ((await res.json()) as Replay) : null;
}
