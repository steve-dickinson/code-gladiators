// Run with: npm run check-models              checks your gladiators, judges and tester
//      or:  npm run check-models -- --scan    finds every cheap text model your account can call
//      or:  npm run check-models -- --vision  finds every cheap model that can see images
// Each check is a tiny request (a few tokens), so even a full scan costs a fraction of a cent.
import { gateway, generateText } from "ai";
import { crc32, deflateSync } from "node:zlib";
import { GLADIATORS, JUDGE_MODEL, PLAYTESTER_MODEL, QUICK_JUDGE_MODEL, VISION_JUDGE_MODEL } from "../src/lib/gladiators.ts";

const scan = process.argv.includes("--scan");
const visionScan = process.argv.includes("--vision");
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

// A 128x128 blue square, built here so there's no file to ship. Small enough to cost
// almost nothing, big enough that every model can make it out (a 16x16 one confused some).
function square(r: number, g: number, b: number, size = 128) {
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(size * 3).fill(Buffer.from([r, g, b]))]);
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
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
const BLUE_SQUARE = square(30, 80, 220);

async function probeVision(model: string) {
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
      // Some models are served by several providers, not all of which take images.
      // This asks AI Gateway for one that does.
      providerOptions: { gateway: { has: ["vision"] } },
    });
    return { model, ok: /blue/i.test(text), message: `said "${text.trim().slice(0, 30)}"` };
  } catch (err) {
    return { model, ok: false, message: (err as Error).message.slice(0, 120) };
  }
}

// The four gladiators' labs: a tester or judge from one of them might favour its own side.
const COMPETING_LABS = [...new Set(GLADIATORS.map((g) => g.model.split("/")[0]))];

if (visionScan) {
  const candidates = catalog.models
    .filter((m) => (m.modelType ?? "language") === "language")
    .filter((m) => !/-(batch|fast)$|tts|transcribe|realtime|live|image|embed|video|audio/.test(m.id))
    .filter((m) => perMillion(m.pricing?.output) <= MAX_OUTPUT_PRICE);
  console.log(`Showing a picture to ${candidates.length} models costing up to $${MAX_OUTPUT_PRICE} per 1M output tokens…\n`);
  const results: Awaited<ReturnType<typeof probeVision>>[] = [];
  for (let i = 0; i < candidates.length; i += 6) {
    results.push(...(await Promise.all(candidates.slice(i, i + 6).map((m) => probeVision(m.id)))));
    process.stdout.write(`\r${Math.min(i + 6, candidates.length)}/${candidates.length} checked`);
  }
  const seeing = results.filter((r) => r.ok).map((r) => r.model).sort((a, b) => outputPrice(a) - outputPrice(b));
  console.log(`\n\n${seeing.length} models that can see images (cheapest first):\n`);
  for (const id of seeing) {
    const lab = id.split("/")[0];
    console.log(`  ${id.padEnd(42)} ${priceOf(id)}${COMPETING_LABS.includes(lab) ? "   (a gladiator's lab)" : ""}`);
  }
  console.log("\nPick one not from a gladiator's lab for PLAYTESTER_MODEL in src/lib/gladiators.ts.");
} else if (!scan) {
  const models = [...new Set([...GLADIATORS.map((g) => g.model), JUDGE_MODEL, QUICK_JUDGE_MODEL])];
  for (const model of models) {
    const r = await probe(model);
    console.log(`${r.ok ? "OK  " : "FAIL"}  ${model.padEnd(36)} ${r.ok ? priceOf(model) : r.message}`);
  }
  console.log("\nCan they see images? (the AI tester works from screenshots, and the first judge looks at them)");
  for (const model of [...new Set([PLAYTESTER_MODEL, VISION_JUDGE_MODEL])]) {
    const r = await probeVision(model);
    console.log(`${r.ok ? "SEES" : "NO  "}  ${model.padEnd(36)} ${r.ok ? `${r.message} · ${priceOf(model)}` : r.message}`);
  }
  console.log("\nTips: `npm run check-models -- --scan` lists every cheap model your account can call;");
  console.log("      `npm run check-models -- --vision` lists the cheap ones that can see images.");
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
