// Run with: npm run check-models
// Pings every gladiator and the judge with a tiny request, so you know
// before a battle which models your AI Gateway account can actually call.
import { gateway, generateText } from "ai";
import { GLADIATORS, JUDGE_MODEL } from "../src/lib/gladiators.ts";

const models = [...new Set([...GLADIATORS.map((g) => g.model), JUDGE_MODEL])];
const catalog = await gateway.getAvailableModels().catch((err: Error) => {
  console.error(`Could not reach AI Gateway: ${err.message}\nRun \`vercel env pull\` to refresh your token, then try again.`);
  process.exit(1);
});
const credits = await gateway.getCredits().catch(() => null);

if (credits) console.log(`Credit balance: $${credits.balance} (used so far: $${credits.totalUsed})\n`);

for (const model of models) {
  const entry = catalog.models.find((m) => m.id === model);
  const perMillion = (v?: string) => (v ? `$${(Number(v) * 1_000_000).toFixed(2)}` : "?");
  const price = entry ? `${perMillion(entry.pricing?.input)} in / ${perMillion(entry.pricing?.output)} out per 1M tokens` : "not in catalog";
  try {
    await generateText({ model, prompt: "Reply with the single word: ready", maxOutputTokens: 5 });
    console.log(`OK    ${model.padEnd(36)} ${price}`);
  } catch (err) {
    console.log(`FAIL  ${model.padEnd(36)} ${(err as Error).message.slice(0, 120)}`);
  }
}
