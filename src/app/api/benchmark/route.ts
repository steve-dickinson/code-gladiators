import { connection } from "next/server";
import { BENCHMARK_RUNS } from "@/lib/benchmark";
import { getBenchmarkRuns } from "@/lib/replays";

/** Each benchmark challenge and how many counted runs it has. Read by the benchmark runner. */
export async function GET() {
  await connection(); // render per request, never at build time
  return Response.json({ target: BENCHMARK_RUNS, runs: await getBenchmarkRuns() });
}
