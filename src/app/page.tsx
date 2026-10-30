import { LiveArena } from "@/components/live-arena";

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-10">
      <Header />
      <LiveArena />
    </main>
  );
}

function Header() {
  return (
    <header className="mb-8">
      <p className="font-mono text-xs uppercase tracking-[0.3em] text-amber-400">Vercel AI Gateway × Sandbox</p>
      <h1 className="mt-2 text-4xl font-bold tracking-tight text-stone-50 sm:text-5xl">Code Gladiators</h1>
      <p className="mt-2 max-w-2xl text-stone-400">
        One challenge. Four AI models. Each writes a game from scratch, live, and runs it in its own locked-down
        sandbox. Then an AI judge picks the winner.
      </p>
    </header>
  );
}
