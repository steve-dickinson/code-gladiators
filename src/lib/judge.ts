import { generateText, Output } from "ai";
import { z } from "zod";
import { GATEWAY_TAGS, JUDGE_FALLBACKS, JUDGE_MODEL } from "./gladiators";
import type { Score } from "./types";

const verdictSchema = z.object({
  scores: z.array(
    z.object({
      gladiator: z.string().describe("the gladiator id exactly as given"),
      creativity: z.number().min(0).max(10),
      polish: z.number().min(0).max(10),
      fidelity: z.number().min(0).max(10).describe("how faithfully it met the challenge"),
      roast: z.string().describe("one witty sentence, max 20 words, fair but funny"),
    }),
  ),
  headline: z.string().describe("a sports-commentator headline for the battle, max 12 words"),
});

export async function judgeBattle(
  challenge: string,
  entries: { id: string; name: string; html: string }[],
) {
  // Trim each entry so a runaway gladiator can't blow up the judge's bill.
  const exhibits = entries
    .map((e) => `### Gladiator "${e.id}" (${e.name})\n${e.html.slice(0, 12_000) || "(no entry: it failed)"}`)
    .join("\n\n");

  const { output } = await generateText({
    model: JUDGE_MODEL,
    output: Output.object({ schema: verdictSchema }),
    system:
      "You are the stern but entertaining judge of Code Gladiators. Score each single-file HTML entry from its source code. " +
      "Unfinished or broken files score low on polish and fidelity. Be specific in roasts.",
    prompt: `Challenge: ${challenge}\n\n${exhibits}`,
    providerOptions: { gateway: { models: JUDGE_FALLBACKS, tags: GATEWAY_TAGS } },
  });

  const scores: Score[] = output.scores
    .filter((s) => entries.some((e) => e.id === s.gladiator))
    .map((s) => ({ ...s, total: Math.round((s.creativity + s.polish + s.fidelity) * 10) / 10 }))
    .sort((a, b) => b.total - a.total);

  return { winner: scores[0]?.gladiator ?? "", headline: output.headline, scores };
}
