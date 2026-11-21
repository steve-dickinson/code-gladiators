import type { streamText } from "ai";

type ProviderOptions = NonNullable<Parameters<typeof streamText>[0]["providerOptions"]>;

// Who fights, who judges, and how much they're allowed to spend.
// Swap any model for another AI Gateway slug: run `npm run check-models`
// to see which ones your account can call and what they cost.

export type Gladiator = {
  id: string; // short, URL-safe: used for sandbox folders and colours
  name: string; // arena name shown in the UI
  model: string; // AI Gateway model slug
  colour: string; // accent colour for the card
  providerOptions?: ProviderOptions; // extra settings passed to this model's provider
};

// Four labs, all callable on the AI Gateway free tier (checked with `npm run check-models -- --scan`).
export const GLADIATORS: Gladiator[] = [
  { id: "gptoss", name: "GPT-OSS 120B", model: "openai/gpt-oss-120b", colour: "#e8885a" },
  {
    id: "gemini",
    name: "Gemini 2.5 Flash",
    model: "google/gemini-2.5-flash",
    colour: "#5b8def",
    // Gemini thinks before it writes, and thinking counts against maxOutputTokens.
    // In the first battle it spent its whole budget thinking and wrote 917 characters.
    // A budget of 0 switches thinking off, so every token goes on the game.
    providerOptions: {
      google: { thinkingConfig: { thinkingBudget: 0 } },
      vertex: { thinkingConfig: { thinkingBudget: 0 } },
    },
  },
  { id: "deepseek", name: "DeepSeek V3.1", model: "deepseek/deepseek-v3.1", colour: "#9b7bf0" },
  { id: "qwen", name: "Qwen3 Coder Next", model: "alibaba/qwen3-coder-next", colour: "#3fbf8f" },
];

// The judge comes from a lab that isn't in the fight, so it has no favourite.
// If its model is down, AI Gateway falls back to the next one in JUDGE_FALLBACKS automatically.
export const JUDGE_MODEL = "mistral/mistral-large-3";
export const JUDGE_FALLBACKS = ["zai/glm-4.7"];
// If the main judge is too slow, a smaller, faster model from the same lab steps in.
export const QUICK_JUDGE_MODEL = "mistral/mistral-small";
// Mistral Large 3 can't see images (checked with `npm run check-models`), so when there
// are screenshots, a judge that can see them rules first, and Large 3 is the backup.
export const VISION_JUDGE_MODEL = "mistral/mistral-small";

// The AI tester: a cheap model that can see images. It uses each entry for a few moves
// and reports anything that doesn't work. From a lab that isn't competing, too.
// `npm run check-models -- --vision` lists the alternatives your account can call.
export const PLAYTESTER_MODEL = "mistral/mistral-small";

// Cost and time guard rails. Each battle is a Vercel Workflow, so the battle as a
// whole has no time limit, but every step (one write, one test, one judging) must
// finish inside a single function's 300 seconds on the free plan.
export const LIMITS = {
  maxRounds: 3, // write, then up to two rounds of test-and-fix
  playtesterActions: 6, // moves the AI playtester gets per game, per round
  playtesterTimeoutMs: 25_000, // per playtester decision
  maxOutputTokens: 8000, // per gladiator per round: caps the worst-case spend
  maxChallengeLength: 280, // a tweet-sized challenge keeps prompts cheap
  writeTimeoutMs: 150_000, // abandon one round of writing after this
  judgeTimeoutMs: 80_000, // give up on the main judge after this
  quickJudgeTimeoutMs: 40_000, // and on the quick judge after this
};

// Tag every request so AI Gateway's dashboard can report spend for this app alone.
export const GATEWAY_TAGS = ["code-gladiators"];
