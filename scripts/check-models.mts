// Checks which AI Gateway models your account can call, and what they cost.
//
//   npm run check-models              the configured gladiators, judges and AI tester
//   npm run check-models -- --scan    every cheap text model
//   npm run check-models -- --vision  every cheap model that can read images
//
// Each check is a request of a few tokens, so even a full scan costs a fraction of a cent.
import { gateway, generateText } from "ai";
import { crc32, deflateSync } from "node:zlib";
import {
  AI_TESTER_MODEL,
  GLADIATORS,
  JUDGE_MODEL,
  QUICK_JUDGE_MODEL,
  VISION_JUDGE_MODEL,
} from "../src/lib/gladiators.ts";

/** US dollars per million output tokens: scans skip anything pricier. */
const MAX_OUTPUT_PRICE = 3;
const PARALLEL_CHECKS = 6;

type Check = { model: string; ok: boolean; message: string };

const catalog = await gateway.getAvailableModels().catch((err: Error) => {
  console.error(`Could not reach AI Gateway: ${err.message}\nRun \`vercel env pull\` to refresh your token, then try again.`);
  process.exit(1);
});
const credits = await gateway.getCredits().catch(() => null);
if (credits) console.log(`Credit balance: $${credits.balance} (used so far: $${credits.totalUsed})\n`);

if (process.argv.includes("--vision")) await scanVision();
else if (process.argv.includes("--scan")) await scanText();
else await checkConfigured();

async function checkConfigured() {
  const models = [...new Set([...GLADIATORS.map((g) => g.model), JUDGE_MODEL, QUICK_JUDGE_MODEL])];
  for (const model of models) {
    const check = await checkText(model);
    console.log(`${check.ok ? "OK  " : "FAIL"}  ${model.padEnd(36)} ${check.ok ? priceOf(model) : check.message}`);
  }
  console.log("\nCan they read images? (the AI tester and the first judge work from screenshots)");
  for (const model of [...new Set([AI_TESTER_MODEL, VISION_JUDGE_MODEL])]) {
    const check = await checkVision(model);
    console.log(`${check.ok ? "SEES" : "NO  "}  ${model.padEnd(36)} ${check.ok ? `${check.message} · ${priceOf(model)}` : check.message}`);
  }
  console.log("\nTips: `npm run check-models -- --scan` lists every cheap model your account can call;");
  console.log("      `npm run check-models -- --vision` lists the cheap ones that can read images.");
}

async function scanText() {
  const candidates = cheapLanguageModels();
  console.log(`Scanning ${candidates.length} text models costing up to $${MAX_OUTPUT_PRICE} per 1M output tokens…\n`);
  const usable = await runChecks(candidates, checkText);
  console.log(`\n\n${usable.length} models your account can call right now (cheapest first):\n`);
  for (const id of usable) console.log(`  ${id.padEnd(42)} ${priceOf(id)}`);
  console.log("\nPick four from different labs for GLADIATORS in src/lib/gladiators.ts, and a dependable one for JUDGE_MODEL.");
}

async function scanVision() {
  const candidates = cheapLanguageModels();
  console.log(`Showing a picture to ${candidates.length} models costing up to $${MAX_OUTPUT_PRICE} per 1M output tokens…\n`);
  const seeing = await runChecks(candidates, checkVision);
  const competingLabs = new Set(GLADIATORS.map((g) => labOf(g.model)));
  console.log(`\n\n${seeing.length} models that can read images (cheapest first):\n`);
  for (const id of seeing) {
    console.log(`  ${id.padEnd(42)} ${priceOf(id)}${competingLabs.has(labOf(id)) ? "   (a gladiator's lab)" : ""}`);
  }
  console.log("\nPick one not from a gladiator's lab for AI_TESTER_MODEL in src/lib/gladiators.ts.");
}

/** Runs `check` on every model, a few at a time, and returns the ones that passed, cheapest first. */
async function runChecks(models: string[], check: (model: string) => Promise<Check>): Promise<string[]> {
  const results: Check[] = [];
  for (let i = 0; i < models.length; i += PARALLEL_CHECKS) {
    results.push(...(await Promise.all(models.slice(i, i + PARALLEL_CHECKS).map(check))));
    process.stdout.write(`\r${Math.min(i + PARALLEL_CHECKS, models.length)}/${models.length} checked`);
  }
  return results
    .filter((r) => r.ok)
    .map((r) => r.model)
    .sort((a, b) => outputPrice(a) - outputPrice(b));
}

async function checkText(model: string): Promise<Check> {
  try {
    await generateText({ model, prompt: "Reply with the single word: ready", maxOutputTokens: 5, maxRetries: 0 });
    return { model, ok: true, message: "" };
  } catch (err) {
    return { model, ok: false, message: (err as Error).message.slice(0, 120) };
  }
}

const BLUE_SQUARE = solidPng(30, 80, 220);

async function checkVision(model: string): Promise<Check> {
  try {
    const { text } = await generateText({
      model,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "What colour is this square? Answer with one word." },
            { type: "file", data: BLUE_SQUARE, mediaType: "image/png" },
          ],
        },
      ],
      maxOutputTokens: 20,
      maxRetries: 0,
      // Some models have several providers, not all of which take images.
      providerOptions: { gateway: { has: ["vision"] } },
    });
    return { model, ok: /blue/i.test(text), message: `said "${text.trim().slice(0, 30)}"` };
  } catch (err) {
    return { model, ok: false, message: (err as Error).message.slice(0, 120) };
  }
}

function cheapLanguageModels(): string[] {
  return catalog.models
    .filter((m) => (m.modelType ?? "language") === "language")
    .filter((m) => !/-(batch|fast)$|tts|transcribe|realtime|live|image|embed|video|audio/.test(m.id))
    .filter((m) => perMillion(m.pricing?.output) <= MAX_OUTPUT_PRICE)
    .map((m) => m.id);
}

function perMillion(pricePerToken?: string): number {
  return pricePerToken === undefined ? NaN : Number(pricePerToken) * 1_000_000;
}

function outputPrice(id: string): number {
  return perMillion(catalog.models.find((m) => m.id === id)?.pricing?.output);
}

function priceOf(id: string): string {
  const pricing = catalog.models.find((m) => m.id === id)?.pricing;
  return pricing
    ? `$${perMillion(pricing.input).toFixed(2)} in / $${perMillion(pricing.output).toFixed(2)} out per 1M tokens`
    : "price not listed";
}

const labOf = (model: string) => model.split("/")[0];

/** A solid-colour 128×128 PNG as base64, built here so there's no image file to ship. */
function solidPng(r: number, g: number, b: number, size = 128): string {
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(size * 3).fill(Buffer.from([r, g, b]))]);
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const checksum = Buffer.alloc(4);
    checksum.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, checksum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 2, 0, 0, 0], 8); // 8-bit RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.concat(Array.from({ length: size }, () => row)))),
    chunk("IEND", Buffer.alloc(0)),
  ]).toString("base64");
}
