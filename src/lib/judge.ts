import { generateText, Output, type UserContent } from "ai";
import { z } from "zod";
import { GATEWAY_TAGS, JUDGE_FALLBACKS, JUDGE_MODEL, LIMITS, QUICK_JUDGE_MODEL, VISION_JUDGE_MODEL } from "./gladiators";
import type { Score, TestReport } from "./types";

export type JudgeEntry = { id: string; name: string; html: string; rounds?: number; test?: TestReport };

const JUDGE_CHARS = 40_000;

const JUDGE_SYSTEM =
  "You are the stern but entertaining judge of Code Gladiators. Score each single-file HTML entry from its source code. " +
  "Each entry's header says whether its file is complete: trust it. A long entry may be cut short for you, but that does not make it unfinished. " +
  "Entries can be games, tools, toys or visuals: judge each against what its challenge asked for. " +
  "Each header also reports what a headless browser and an AI tester found when they used the final version: " +
  "errors and broken features they found are real bugs, and needing fixes is fine if the final version works. " +
  "Where a screenshot follows an entry, it shows the page right after it was tested. Use it to judge how it looks and " +
  "whether it appears to work: an entry that looks broken or empty has a real flaw however good its code reads. It is " +
  "one moment, so a start screen, an empty state or a game-over screen is fine. " +
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
  const ai = e.test.ai
    ? e.test.ai.bugs.length
      ? ` · AI tester${e.test.ai.kind ? ` (tested it as a ${e.test.ai.kind})` : ""} found: ${e.test.ai.bugs.join(" | ").slice(0, 300)}`
      : ` · AI tester${e.test.ai.kind ? ` (tested it as a ${e.test.ai.kind})` : ""}: it worked${e.test.ai.summary ? ` (${e.test.ai.summary.slice(0, 160)})` : ""}`
    : "";
  const slow = e.test.slowBrowser ? " (the test browser ran too slowly to check it properly)" : "";
  if (e.test.passed) return ` · browser test: passed${after || " first time"}${slow}${ai}`;
  const problems = [...e.test.errors, ...(e.test.blank ? ["the screen stayed empty"] : [])];
  return ` · browser test: ${fixes ? `still failing${after}` : "failed"}${problems.length ? `: ${problems.join(" | ").slice(0, 400)}` : ""}${slow}${ai}`;
}

export async function judgeBattle(
  challenge: string,
  entries: JudgeEntry[],
) {
  // Show the judge up to 40,000 characters of each entry (about 10,000 tokens), and
  // tell it in code whether the file is finished. In the first battle the judge saw
  // only 12,000 characters, mistook two complete games for unfinished ones, and
  // crowned the shortest entry.
  const exhibit = (e: JudgeEntry) => {
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
  };

  // Each entry's code, then (when we have one, and the judge can take pictures) a
  // screenshot of the entry straight after it was tested.
  const contentFor = (withScreenshots: boolean): UserContent => [
    { type: "text", text: `Challenge: ${challenge}` },
    ...entries.flatMap((e): Exclude<UserContent, string> => {
      const shot = withScreenshots && e.html ? e.test?.screenshot : undefined;
      return [
        { type: "text", text: `\n\n${exhibit(e)}` },
        ...(shot
          ? ([
              { type: "text", text: `\nScreenshot of gladiator "${e.id}"'s entry after it was tested:` },
              { type: "file", data: shot.replace(/^data:[^,]+,/, ""), mediaType: "image/jpeg" },
            ] as const)
          : []),
      ];
    }),
  ];

  const verdictSchema = verdictSchemaFor(entries.map((e) => e.id) as [string, ...string[]]);
  const ask = async (model: string, timeoutMs: number, withScreenshots: boolean) =>
    (
      await generateText({
        model,
        output: Output.object({ schema: verdictSchema }),
        system: JUDGE_SYSTEM,
        messages: [{ role: "user", content: contentFor(withScreenshots) }],
        abortSignal: AbortSignal.timeout(timeoutMs),
        maxRetries: 1,
        // With screenshots, ask AI Gateway for a provider that takes images (and skip
        // the text-only fallback model).
        providerOptions: {
          gateway: withScreenshots
            ? { has: ["vision"], tags: GATEWAY_TAGS }
            : { models: JUDGE_FALLBACKS, tags: GATEWAY_TAGS },
        },
      })
    ).output;

  // With screenshots, a judge that can see them rules first. If that fails, the main
  // judge rules on the code alone, then the quick judge: there's always a verdict.
  // Without screenshots, it's the main judge, then the quick judge if it's too slow.
  // At worst that's 80 + 80 + 40 seconds, inside the judging step's 300.
  const hasScreenshots = entries.some((e) => e.html && e.test?.screenshot);
  const attempts: [model: string, timeoutMs: number, withScreenshots: boolean][] = [
    ...(hasScreenshots ? [[VISION_JUDGE_MODEL, LIMITS.judgeTimeoutMs, true] as [string, number, boolean]] : []),
    [JUDGE_MODEL, LIMITS.judgeTimeoutMs, false],
    [QUICK_JUDGE_MODEL, LIMITS.quickJudgeTimeoutMs, false],
  ];
  let output: Awaited<ReturnType<typeof ask>> | undefined;
  let sawScreenshots = false;
  let lastError: unknown;
  for (const [model, timeoutMs, withScreenshots] of attempts) {
    try {
      output = await ask(model, timeoutMs, withScreenshots);
      sawScreenshots = withScreenshots;
      break;
    } catch (err) {
      lastError = err;
      console.warn(`${model} (${withScreenshots ? "with" : "without"} screenshots) was too slow or failed`, err);
    }
  }
  if (!output) throw lastError;

  const scores: Score[] = output.scores
    .map((s) => ({ ...s, total: Math.round((s.creativity + s.polish + s.fidelity) * 10) / 10 }))
    .sort((a, b) => b.total - a.total);

  return { winner: scores[0]?.gladiator ?? "", headline: output.headline, scores, sawScreenshots };
}
