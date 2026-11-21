import { generateText, Output, type UserContent } from "ai";
import { z } from "zod";
import { GATEWAY_TAGS, JUDGE_FALLBACKS, JUDGE_MODEL, LIMITS, QUICK_JUDGE_MODEL, VISION_JUDGE_MODEL } from "./gladiators";
import type { BattleData, Score, TestReport } from "./types";
import { base64Of, roundTo, shuffle } from "./utils";

// The judge scores every entry for creativity, polish and fidelity to the challenge.
// It judges blind: entries are shown as "Entry A" to "Entry D" in a random order, so it
// can favour neither a model's name nor a position in the list.

export type JudgeEntry = { id: string; name: string; html: string; rounds?: number; test?: TestReport };
type LabelledEntry = JudgeEntry & { label: string };
type Verdict = BattleData["verdict"];

/** About 10,000 tokens of each entry. */
const MAX_CODE_CHARS = 40_000;
const LETTERS = "ABCDEFGH";

const JUDGE_SYSTEM =
  "You are the stern but entertaining judge of Code Gladiators. Score each single-file HTML entry from its source code. " +
  "Each entry's header says whether its file is complete: trust it. A long entry may be cut short for you, but that does not make it unfinished. " +
  "Entries can be games, tools, toys or visuals: judge each against what its challenge asked for. " +
  "Each header also reports what a headless browser and an AI tester found when they used the final version: " +
  "errors and broken features they found are real bugs, and needing fixes is fine if the final version works. " +
  "Where a screenshot follows an entry, it shows the page right after it was tested. Use it to judge how it looks and " +
  "whether it appears to work: an entry that looks broken or empty has a real flaw however good its code reads. It is " +
  "one moment, so a start screen, an empty state or a game-over screen is fine. " +
  "Only files marked UNFINISHED, or with clear bugs, score low on polish and fidelity. Be specific in roasts. " +
  "The entries are anonymous and in a random order: refer to them only as Entry A, Entry B and so on, never guess " +
  "which model wrote one, and judge each on its own merits.";

/** Requires exactly one score per entry, by letter, so no entry can be skipped. */
const verdictSchema = (labels: [string, ...string[]]) =>
  z.object({
    scores: z
      .array(
        z.object({
          gladiator: z.enum(labels).describe("the entry's letter exactly as given, e.g. A"),
          creativity: z.number().min(0).max(10),
          polish: z.number().min(0).max(10),
          fidelity: z.number().min(0).max(10).describe("how faithfully it met the challenge"),
          roast: z.string().describe("one witty sentence, max 20 words, fair but funny"),
        }),
      )
      .length(labels.length)
      .describe("exactly one score for every entry, including any that failed")
      .refine((scores) => new Set(scores.map((s) => s.gladiator)).size === labels.length, "score every entry once"),
    headline: z.string().describe("a sports-commentator headline for the battle, max 12 words"),
  });
type RawVerdict = z.infer<ReturnType<typeof verdictSchema>>;

export async function judgeBattle(challenge: string, gladiators: JudgeEntry[]): Promise<Verdict> {
  const entries = labelEntries(gladiators);
  const hasScreenshots = entries.some((e) => e.html && e.test?.screenshot);
  // With screenshots, a judge that can see them goes first. If a judge fails or is too
  // slow, the next one rules on the code alone, so there's always a verdict.
  const attempts = [
    ...(hasScreenshots ? [{ model: VISION_JUDGE_MODEL, timeoutMs: LIMITS.judgeTimeoutMs, withScreenshots: true }] : []),
    { model: JUDGE_MODEL, timeoutMs: LIMITS.judgeTimeoutMs, withScreenshots: false },
    { model: QUICK_JUDGE_MODEL, timeoutMs: LIMITS.quickJudgeTimeoutMs, withScreenshots: false },
  ];

  let lastError: unknown;
  for (const attempt of attempts) {
    try {
      const verdict = await askJudge(challenge, entries, attempt);
      return { ...relabel(verdict, entries), sawScreenshots: attempt.withScreenshots, blind: true };
    } catch (err) {
      lastError = err;
      console.warn(`${attempt.model} (${attempt.withScreenshots ? "with" : "without"} screenshots) failed`, err);
    }
  }
  throw lastError;
}

/** Shuffles the entries and gives each a letter. */
export function labelEntries(entries: JudgeEntry[]): LabelledEntry[] {
  return shuffle(entries).map((entry, i) => ({ ...entry, label: LETTERS[i] }));
}

/** Maps letters back to gladiators, and "Entry B" in the text to the gladiator's name. Scores come back best first. */
export function relabel(verdict: RawVerdict, entries: LabelledEntry[]): Pick<Verdict, "winner" | "headline" | "scores"> {
  const byLabel = new Map(entries.map((e) => [e.label, e]));
  const named = (text: string) => text.replace(/\bEntry ([A-H])\b/g, (match, label: string) => byLabel.get(label)?.name ?? match);
  const scores: Score[] = verdict.scores
    .map((s) => ({
      ...s,
      gladiator: byLabel.get(s.gladiator)?.id ?? s.gladiator,
      roast: named(s.roast),
      total: roundTo(s.creativity + s.polish + s.fidelity),
    }))
    .sort((a, b) => b.total - a.total);
  return { winner: scores[0]?.gladiator ?? "", headline: named(verdict.headline), scores };
}

async function askJudge(
  challenge: string,
  entries: LabelledEntry[],
  { model, timeoutMs, withScreenshots }: { model: string; timeoutMs: number; withScreenshots: boolean },
): Promise<RawVerdict> {
  const { output } = await generateText({
    model,
    output: Output.object({ schema: verdictSchema(entries.map((e) => e.label) as [string, ...string[]]) }),
    system: JUDGE_SYSTEM,
    messages: [{ role: "user", content: judgeContent(challenge, entries, withScreenshots) }],
    abortSignal: AbortSignal.timeout(timeoutMs),
    maxRetries: 1,
    providerOptions: {
      gateway: withScreenshots ? { has: ["vision"], tags: GATEWAY_TAGS } : { models: JUDGE_FALLBACKS, tags: GATEWAY_TAGS },
    },
  });
  return output;
}

/** The challenge, then each entry's code, each followed by its screenshot when there is one. */
function judgeContent(challenge: string, entries: LabelledEntry[], withScreenshots: boolean): UserContent {
  return [
    { type: "text", text: `Challenge: ${challenge}` },
    ...entries.flatMap((entry): Exclude<UserContent, string> => {
      const screenshot = withScreenshots && entry.html ? entry.test?.screenshot : undefined;
      return [
        { type: "text", text: `\n\n${exhibit(entry)}` },
        ...(screenshot
          ? ([
              { type: "text", text: `\nScreenshot of entry ${entry.label} after it was tested:` },
              { type: "file", data: base64Of(screenshot), mediaType: "image/jpeg" },
            ] as const)
          : []),
      ];
    }),
  ];
}

/** An entry's header (size, whether it's complete, how testing went) and its code. */
function exhibit(entry: LabelledEntry): string {
  if (!entry.html) return `### Entry ${entry.label}\n(no entry: it failed)`;
  const complete = /<\/html>\s*$/i.test(entry.html);
  const header =
    `### Entry ${entry.label} · ${entry.html.length.toLocaleString("en-GB")} characters · ` +
    (complete ? "the file is complete" : "the file is UNFINISHED: it stops before </html>") +
    describeTesting(entry);
  const code =
    entry.html.length > MAX_CODE_CHARS
      ? `${entry.html.slice(0, MAX_CODE_CHARS)}\n… (${(entry.html.length - MAX_CODE_CHARS).toLocaleString("en-GB")} more characters not shown)`
      : entry.html;
  return `${header}\n${code}`;
}

/** e.g. " · browser test: passed after 1 fix · AI tester (tested it as a game): it worked". */
export function describeTesting({ test, rounds = 1 }: Pick<JudgeEntry, "test" | "rounds">): string {
  if (!test) return " · not browser-tested";
  const fixes = rounds - 1;
  const afterFixes = fixes ? ` after ${fixes} fix${fixes > 1 ? "es" : ""}` : "";
  const slow = test.slowBrowser ? " (the test browser ran too slowly to check it properly)" : "";
  const ai = describeAiTest(test);
  if (test.passed) return ` · browser test: passed${afterFixes || " first time"}${slow}${ai}`;
  const problems = [...test.errors, ...(test.blank ? ["the screen stayed empty"] : [])];
  const found = problems.length ? `: ${problems.join(" | ").slice(0, 400)}` : "";
  return ` · browser test: ${fixes ? `still failing${afterFixes}` : "failed"}${found}${slow}${ai}`;
}

function describeAiTest(test: TestReport): string {
  if (!test.ai) return test.aiError ? " · the AI tester couldn't run" : "";
  const as = test.ai.kind ? ` (tested it as a ${test.ai.kind})` : "";
  if (test.ai.bugs.length) return ` · AI tester${as} found: ${test.ai.bugs.join(" | ").slice(0, 300)}`;
  return ` · AI tester${as}: it worked${test.ai.summary ? ` (${test.ai.summary.slice(0, 160)})` : ""}`;
}
