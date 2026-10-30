// Who fights, who judges, and how much they're allowed to spend.
// Swap any model for another AI Gateway slug: run `npm run check-models`
// to see which ones your account can call and what they cost.

export type Gladiator = {
  id: string; // short, URL-safe: used for sandbox folders and colours
  name: string; // arena name shown in the UI
  model: string; // AI Gateway model slug
  colour: string; // accent colour for the card
};

export const GLADIATORS: Gladiator[] = [
  { id: "haiku", name: "Claude Haiku 5.5", model: "anthropic/claude-haiku-5.5", colour: "#e8885a" },
  { id: "gemini", name: "Gemini 3.5 Flash", model: "google/gemini-3.5-flash", colour: "#5b8def" },
  { id: "deepseek", name: "DeepSeek V4.1 Flash", model: "deepseek/deepseek-v4.1-flash", colour: "#9b7bf0" },
  { id: "qwen", name: "Qwen3 Coder Next", model: "alibaba/qwen3-coder-next", colour: "#3fbf8f" },
];

// The judge watches every fight. If its model is down, AI Gateway
// falls back to the next one in JUDGE_FALLBACKS automatically.
export const JUDGE_MODEL = "google/gemini-3.5-flash";
export const JUDGE_FALLBACKS = ["anthropic/claude-haiku-5.5"];

// Cost guard rails.
export const LIMITS = {
  maxOutputTokens: 8000, // per gladiator per battle: caps the worst-case spend
  maxChallengeLength: 280, // a tweet-sized challenge keeps prompts cheap
  battleTimeoutMs: 150_000, // abandon a gladiator that takes longer than this
};

// Tag every request so AI Gateway's dashboard can report spend for this app alone.
export const GATEWAY_TAGS = ["code-gladiators"];
