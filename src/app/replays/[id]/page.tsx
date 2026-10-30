import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ReplayPlayer } from "@/components/replay-player";
import { getReplay } from "@/lib/replays";

export async function generateMetadata({ params }: PageProps<"/replays/[id]">): Promise<Metadata> {
  const replay = await getReplay((await params).id);
  return { title: replay ? `Code Gladiators: ${replay.challenge}` : "Replay not found" };
}

export default function ReplayPage({ params }: PageProps<"/replays/[id]">) {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-10">
      <Link href="/replays" className="font-mono text-xs uppercase tracking-[0.3em] text-amber-400">← All replays</Link>
      <h1 className="mt-2 mb-6 text-3xl font-bold text-stone-50">Code Gladiators replay</h1>
      <Suspense fallback={<p className="font-mono text-stone-500">Loading the battle…</p>}>
        <LoadedReplay params={params} />
      </Suspense>
    </main>
  );
}

async function LoadedReplay({ params }: { params: Promise<{ id: string }> }) {
  const replay = await getReplay((await params).id);
  if (!replay) notFound();
  return <ReplayPlayer replay={replay} />;
}
