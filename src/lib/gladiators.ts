import type { streamText } from "ai";

// Who competes, who judges, who tests, and the limits that keep a battle cheap.
// Every model is an AI Gateway slug: `npm run check-models` shows which ones your
// account can call and what they cost.

type ProviderOptions = NonNullable<Parameters<typeof streamText>[0]["providerOptions"]>;

export type Gladiator = {
  /** Short and URL-safe: used in sandbox paths and as the key in every event. */
  id: string;
  name: string;
  /** AI Gateway model slug. */
  model: string;
  colour: string;
  providerOptions?: ProviderOptions;
};

export const GLADIATORS: Gladiator[] = [
  { id: "gptoss", name: "GPT-OSS 120B", model: "openai/gpt-oss-120b", colour: "#e8885a" },
  {
    id: "gemini",
    name: "Gemini 2.5 Flash",
    model: "google/gemini-2.5-flash",
    colour: "#5b8def",
    // Gemini's thinking tokens count against maxOutputTokens and can use up the whole
    // budget before any code is written, so thinking is switched off.
    providerOptions: {
      google: { thinkingConfig: { thinkingBudget: 0 } },
      vertex: { thinkingConfig: { thinkingBudget: 0 } },
    },
  },
  { id: "deepseek", name: "DeepSeek V3.1", model: "deepseek/deepseek-v3.1", colour: "#9b7bf0" },
  { id: "qwen", name: "Qwen3 Coder Next", model: "alibaba/qwen3-coder-next", colour: "#3fbf8f" },
];

// Judges and testers come from labs that aren't competing, so none marks its own lab's work.

/** Judges the code alone. AI Gateway falls back to JUDGE_FALLBACKS if it's unavailable. */
export const JUDGE_MODEL = "mistral/mistral-large-3";
export const JUDGE_FALLBACKS = ["zai/glm-4.7"];
/** Steps in when the main judge is too slow. */
export const QUICK_JUDGE_MODEL = "mistral/mistral-small";
/** Judges with screenshots (JUDGE_MODEL can't read images). */
export const VISION_JUDGE_MODEL = "mistral/mistral-small";

/**
 * Uses each entry with a goal and reports what doesn't work. Four testers run at once,
 * so the fallbacks take over when the first choice is rate-limited.
 */
export const AI_TESTER_MODEL = "meta/llama-4-scout";
export const AI_TESTER_FALLBACKS = ["amazon/nova-lite", "mistral/mistral-small"];

// A battle is a durable workflow with no overall time limit, but every step (one write,
// one test, one judging) must finish within a single function's 300 seconds.
export const LIMITS = {
  /** The first draft plus up to two test-and-fix rounds. */
  maxRounds: 3,
  /** Requests the AI tester may make per entry, per round. */
  aiTesterMoves: 4,
  aiTesterTimeoutMs: 25_000,
  /** Per gladiator per round: caps the worst-case spend. */
  maxOutputTokens: 8000,
  maxChallengeLength: 280,
  writeTimeoutMs: 150_000,
  judgeTimeoutMs: 80_000,
  quickJudgeTimeoutMs: 40_000,
};

/** Lets AI Gateway's dashboard report this app's spend on its own. */
export const GATEWAY_TAGS = ["code-gladiators"];
