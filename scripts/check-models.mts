// Run with: npm run check-models            checks your gladiators and judge
//      or:  npm run check-models -- --scan  finds every cheap text model your account can call
// Each check is a tiny request (a few tokens), so even a full scan costs a fraction of a cent.
import { gateway, generateText } from "ai";
import { GLADIATORS, JUDGE_MODEL } from "../src/lib/gladiators.ts";

const scan = process.argv.includes("--scan");
const MAX_OUTPUT_PRICE = 3; // $ per 1M output tokens: the scan skips anything pricier

const catalog = await gateway.getAvailableModels().catch((err: Error) => {
  console.error(`Could not reach AI Gateway: ${err.message}\nRun \`vercel env pull\` to refresh your token, then try again.`);
  process.exit(1);
});
const credits = await gateway.getCredits().catch(() => null);
if (credits) console.log(`Credit balance: $${credits.balance} (used so far: $${credits.totalUsed})\n`);

const perMillion = (v?: string) => (v === undefined ? NaN : Number(v) * 1_000_000);
const outputPrice = (id: string) => perMillion(catalog.models.find((m) => m.id === id)?.pricing?.output);
const priceOf = (id: string) => {
  const p = catalog.models.find((m) => m.id === id)?.pricing;
  return p ? `$${perMillion(p.input).toFixed(2)} in / $${perMillion(p.output).toFixed(2)} out per 1M tokens` : "price not listed";
};

async function probe(model: string) {
  try {
    await generateText({ model, prompt: "Reply with the single word: ready", maxOutputTokens: 5, maxRetries: 0 });
    return { model, ok: true, message: "" };
  } catch (err) {
    return { model, ok: false, message: (err as Error).message.slice(0, 120) };
  }
}

if (!scan) {
  const models = [...new Set([...GLADIATORS.map((g) => g.model), JUDGE_MODEL])];
  for (const model of models) {
    const r = await probe(model);
    console.log(`${r.ok ? "OK  " : "FAIL"}  ${model.padEnd(36)} ${r.ok ? priceOf(model) : r.message}`);
  }
  console.log("\nTip: `npm run check-models -- --scan` lists every cheap model your account can call.");
} else {
  const candidates = catalog.models
    .filter((m) => (m.modelType ?? "language") === "language")
    .filter((m) => !/-(batch|fast)$|tts|transcribe|realtime|live|image|embed|video/.test(m.id))
    .filter((m) => perMillion(m.pricing?.output) <= MAX_OUTPUT_PRICE);

  console.log(`Scanning ${candidates.length} text models costing up to $${MAX_OUTPUT_PRICE} per 1M output tokens…\n`);
  const results: Awaited<ReturnType<typeof probe>>[] = [];
  for (let i = 0; i < candidates.length; i += 6) {
    results.push(...(await Promise.all(candidates.slice(i, i + 6).map((m) => probe(m.id)))));
    process.stdout.write(`\r${Math.min(i + 6, candidates.length)}/${candidates.length} checked`);
  }

  const usable = results.filter((r) => r.ok).map((r) => r.model).sort((a, b) => outputPrice(a) - outputPrice(b));
  console.log(`\n\n${usable.length} models your account can call right now (cheapest first):\n`);
  for (const id of usable) console.log(`  ${id.padEnd(42)} ${priceOf(id)}`);
  console.log("\nPick four from different labs for GLADIATORS in src/lib/gladiators.ts, and a dependable one for JUDGE_MODEL.");
}
