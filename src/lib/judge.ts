import { generateText, Output } from "ai";
import { z } from "zod";
import { GATEWAY_TAGS, JUDGE_FALLBACKS, JUDGE_MODEL, LIMITS, QUICK_JUDGE_MODEL } from "./gladiators";
import type { Score, TestReport } from "./types";

export type JudgeEntry = { id: string; name: string; html: string; rounds?: number; test?: TestReport };

const JUDGE_CHARS = 40_000;

const JUDGE_SYSTEM =
  "You are the stern but entertaining judge of Code Gladiators. Score each single-file HTML entry from its source code. " +
  "Each entry's header says whether its file is complete: trust it. A long entry may be cut short for you, but that does not make it unfinished. " +
  "Each header also reports what a headless browser saw when it played the final version: errors it found are real bugs, " +
  "and needing fixes is fine if the final version works. " +
  "Only files marked UNFINISHED, or with clear bugs, score low on polish and fidelity. Be specific in roasts.";

// Built per battle so the judge must score every gladiator, by its exact id, once.
// In an early battle a looser schema let the judge skip a complete entry.
const verdictSchemaFor = (ids: [string, ...string[]]) =>
  z.object({
    scores: z
      .array(
        z.object({
          gladiator: z.enum(ids).describe("the gladiator id exactly as given"),
          creativity: z.number().min(0).max(10),
          polish: z.number().min(0).max(10),
          fidelity: z.number().min(0).max(10).describe("how faithfully it met the challenge"),
          roast: z.string().describe("one witty sentence, max 20 words, fair but funny"),
        }),
      )
      .length(ids.length)
      .describe("exactly one score for every gladiator, including any that failed")
      .refine((scores) => new Set(scores.map((s) => s.gladiator)).size === ids.length, "score every gladiator once"),
    headline: z.string().describe("a sports-commentator headline for the battle, max 12 words"),
  });

// e.g. " · browser test: passed after 1 fix" or " · browser test: failed: TypeError …"
function playtest(e: JudgeEntry) {
  if (!e.test) return " · not browser-tested";
  const fixes = (e.rounds ?? 1) - 1;
  const after = fixes ? ` after ${fixes} fix${fixes > 1 ? "es" : ""}` : "";
  if (e.test.passed) return ` · browser test: passed${after || " first time"}`;
  const problems = [...e.test.errors, ...(e.test.blank ? ["the screen stayed empty"] : [])];
  return ` · browser test: ${fixes ? `still failing${after}` : "failed"}: ${problems.join(" | ").slice(0, 400)}`;
}

export async function judgeBattle(
  challenge: string,
  entries: JudgeEntry[],
) {
  // Show the judge up to 40,000 characters of each entry (about 10,000 tokens), and
  // tell it in code whether the file is finished. In the first battle the judge saw
  // only 12,000 characters, mistook two complete games for unfinished ones, and
  // crowned the shortest entry.
  const exhibits = entries
    .map((e) => {
      if (!e.html) return `### Gladiator "${e.id}" (${e.name})\n(no entry: it failed)`;
      const complete = /<\/html>\s*$/i.test(e.html);
      const header = `### Gladiator "${e.id}" (${e.name}) · ${e.html.length.toLocaleString("en-GB")} characters · ${
        complete ? "the file is complete" : "the file is UNFINISHED: it stops before </html>"
      }${playtest(e)}`;
      const shown =
        e.html.length > JUDGE_CHARS
          ? `${e.html.slice(0, JUDGE_CHARS)}\n… (${(e.html.length - JUDGE_CHARS).toLocaleString("en-GB")} more characters not shown)`
          : e.html;
      return `${header}\n${shown}`;
    })
    .join("\n\n");

  const prompt = `Challenge: ${challenge}\n\n${exhibits}`;
  const verdictSchema = verdictSchemaFor(entries.map((e) => e.id) as [string, ...string[]]);
  const ask = async (model: string, timeoutMs: number) =>
    (
      await generateText({
        model,
        output: Output.object({ schema: verdictSchema }),
        system: JUDGE_SYSTEM,
        prompt,
        abortSignal: AbortSignal.timeout(timeoutMs),
        maxRetries: 1,
        providerOptions: { gateway: { models: JUDGE_FALLBACKS, tags: GATEWAY_TAGS } },
      })
    ).output;

  // Judging four long games can take the main judge well over a minute. If it runs
  // out of time, the quick judge rules instead, so the battle stays under Vercel's limit.
  let output: Awaited<ReturnType<typeof ask>>;
  try {
    output = await ask(JUDGE_MODEL, LIMITS.judgeTimeoutMs);
  } catch (err) {
    console.warn(`${JUDGE_MODEL} was too slow or failed; ${QUICK_JUDGE_MODEL} is judging instead.`, err);
    output = await ask(QUICK_JUDGE_MODEL, LIMITS.quickJudgeTimeoutMs);
  }

  const scores: Score[] = output.scores
    .map((s) => ({ ...s, total: Math.round((s.creativity + s.polish + s.fidelity) * 10) / 10 }))
    .sort((a, b) => b.total - a.total);

  return { winner: scores[0]?.gladiator ?? "", headline: output.headline, scores };
}
