import { generateText, type UserContent } from "ai";
import { z } from "zod";
import type { BrowserSession } from "./arena";
import { GATEWAY_TAGS, LIMITS, PLAYTESTER_MODEL } from "./gladiators";
import type { TestReport } from "./types";

// The AI tester. A small model that can see images uses the entry for a few moves,
// the way you would when you first open it, and checks it does what the challenge
// asked for. An entry might be a game, a tool (a calculator, a to-do list, a form),
// a toy or a visual, so the tester first works out what it is and what it's for,
// then tests that: a game's controls, a calculator's sums, a to-do list's adding
// and ticking off. It reports a bug only with evidence: what it did, what it
// expected, and what actually happened.
//
// Why bother, when the scripted test already uses the page? The scripted test only
// knows the page *changed*. In one centipede battle, Left shot the player across
// the screen and Right did nothing at all: the page changed, nothing threw an
// error, and the game passed. You only find that by using it with a goal.

const KEYS = [
  "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Space", "Enter", "Backspace", "Tab", "Escape", "Shift",
  "w", "a", "s", "d", "z", "x",
] as const;
const SIZE = { width: 960, height: 600 }; // matches the scripted test's viewport

const SYSTEM = `You are a QA tester. A web page was built for a challenge, and you check that it works and does what the challenge asked for.
It might be a game, a tool (a calculator, a converter, a to-do list, a form), a toy or a visual. First work out which, and what a person would do with it. Then test exactly that:
- a game: start it, then try each control it uses, one at a time;
- a tool: use it with a realistic example and check the result is correct (for a calculator, do a sum you can check);
- a toy or a visual: interact the way its on-screen instructions say, and check it responds as described.
The page fills a ${SIZE.width}x${SIZE.height} window; x and y are measured from the top-left corner. Each turn you get the page's text, a list of its controls with their positions, a screenshot of it now and (after your first move) a screenshot from just before your last move. Choose ONE move:
- "click": click a control by its label ("target"), or at x,y.
- "type": type text, into the field named by "target" if you give one.
- "press": tap a key once. "hold": hold a key for ms milliseconds (300 to 1500), best for checking movement.
- "scroll": scroll "down" or "up".
- "finish": stop and report.
Keys you can use: ${KEYS.join(", ")}.
Report a bug ONLY when you have clear evidence that something the challenge needs doesn't work: say what you did, what you expected and what happened. For example "held ArrowRight for 1000 ms and the ship did not move", or "clicked 7, +, 6, = and the display showed 76, not 13". Do not report missing extras, difficulty, looks, or anything you are unsure about. Most entries work: finishing with no bugs is a good result.
Reply with ONLY a JSON object, nothing else, in one of these shapes:
{"move":"click","target":"Start","reason":"start the game"}
{"move":"type","target":"New task","text":"Buy milk","reason":"add a task"}
{"move":"hold","key":"ArrowRight","ms":800,"reason":"check the player moves right"}
{"move":"finish","kind":"game","summary":"one sentence on what you checked and how it behaved","bugs":[{"what":"Right does nothing","evidence":"held ArrowRight 1000 ms, the ship stayed at the far left"}]}`;

const Move = z.object({
  move: z.enum(["click", "type", "press", "hold", "scroll", "finish"]),
  target: z.string().optional(),
  text: z.string().optional(),
  key: z.string().optional(),
  x: z.number().optional(),
  y: z.number().optional(),
  ms: z.number().optional(),
  direction: z.string().optional(),
  reason: z.string().optional(),
  kind: z.string().optional(),
  summary: z.string().optional(),
  bugs: z.array(z.object({ what: z.string(), evidence: z.string().optional() })).optional(),
});
type Move = z.infer<typeof Move>;

// Small models sometimes wrap their JSON in prose or a code fence: take the first object.
function parseMove(text: string): Move | undefined {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return undefined;
  try {
    const parsed = Move.safeParse(JSON.parse(text.slice(start, end + 1)));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

// Runs inside the page: its text, and every visible control with a label and the
// centre of where it sits, so the tester can click "=" instead of guessing pixels.
const LOOK = `(() => {
  const ok = (e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 2 && r.height > 2 && r.bottom > 0 && r.top < innerHeight && s.visibility !== "hidden"; };
  const label = (e) => (e.getAttribute("aria-label") || e.innerText || e.value || e.placeholder || e.title || e.name || e.id || "").replace(/\\s+/g, " ").trim().slice(0, 40);
  const els = [...document.querySelectorAll("button, a[href], input, textarea, select, [role=button], [onclick], [contenteditable=true]")].filter(ok).slice(0, 30);
  return {
    text: (document.body?.innerText ?? "").replace(/\\s+/g, " ").trim().slice(0, 500),
    controls: els.map((e) => { const r = e.getBoundingClientRect(); return { kind: e.tagName.toLowerCase() + (e.type ? ":" + e.type : ""), label: label(e), x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; }),
  };
})()`;
const LOOK_CMD = `eval -b ${Buffer.from(LOOK).toString("base64")}`;
type Look = { text: string; controls: { kind: string; label: string; x: number; y: number }[] };

const clamp = (n: number | undefined, lo: number, hi: number, fallback: number) =>
  Math.round(Math.min(hi, Math.max(lo, Number.isFinite(n) ? (n as number) : fallback)));
const keyOf = (k?: string) => KEYS.find((key) => key.toLowerCase() === (k ?? "").toLowerCase());
const image = (dataUrl: string) => ({ type: "file" as const, data: dataUrl.replace(/^data:[^,]+,/, ""), mediaType: "image/jpeg" });
const clickAt = (x: number, y: number) => [`mouse move ${x} ${y}`, "mouse down", "mouse up"];

// Find a control by its label: an exact match first, then one that contains it.
function findControl(look: Look, target?: string) {
  const t = (target ?? "").trim().toLowerCase();
  if (!t) return undefined;
  return (
    look.controls.find((c) => c.label.toLowerCase() === t) ??
    look.controls.find((c) => c.label.toLowerCase().includes(t) || (c.label && t.includes(c.label.toLowerCase())))
  );
}

export async function aiPlaytest(browser: BrowserSession, url: string, challenge: string): Promise<NonNullable<TestReport["ai"]>> {
  const t0 = Date.now();
  // A fresh start: the scripted test may have left the page in an odd state.
  await browser.batch([`open ${url}`, "wait 1200"]);
  const look = async (): Promise<Look> => {
    const [item] = await browser.batch([LOOK_CMD]);
    return (item?.result?.result as Look | undefined) ?? { text: "", controls: [] };
  };
  let page = await look();
  let now = await browser.screenshot();
  if (!now) throw new Error("no screenshot to test from");
  let before: string | undefined;
  const moves: string[] = [];
  let acted = 0; // moves actually carried out
  let costUsd = 0;

  for (let turn = 0; turn <= LIMITS.playtesterActions; turn++) {
    const last = turn === LIMITS.playtesterActions || Date.now() - t0 > 150_000;
    const controls = page.controls.length
      ? page.controls.map((c) => `- ${c.kind} "${c.label || "(no label)"}" at (${c.x}, ${c.y})`).join("\n")
      : "(none: it may be drawn on a canvas, or used with the keyboard or mouse)";
    const content: UserContent = [
      {
        type: "text",
        text:
          `The challenge was: "${challenge}".\n` +
          `Text on the page now: "${page.text || "(none)"}".\n` +
          `Controls on the page now:\n${controls}\n` +
          `Your moves so far:\n${moves.length ? moves.map((m, i) => `${i + 1}. ${m}`).join("\n") : "(none yet)"}\n` +
          (last ? "This is your last turn: you must finish now." : `You have ${LIMITS.playtesterActions - turn} moves left.`),
      },
      ...(before ? [{ type: "text" as const, text: "Before your last move:" }, image(before)] : []),
      { type: "text", text: "Now:" },
      image(now),
    ];
    const result = await generateText({
      model: PLAYTESTER_MODEL,
      system: SYSTEM,
      messages: [{ role: "user", content }],
      maxOutputTokens: 300,
      abortSignal: AbortSignal.timeout(LIMITS.playtesterTimeoutMs),
      maxRetries: 1,
      providerOptions: { gateway: { has: ["vision"], tags: GATEWAY_TAGS } }, // a provider that takes images
    });
    costUsd += Number((result.providerMetadata?.gateway as { cost?: string | number } | undefined)?.cost ?? 0);
    const move = parseMove(result.text);
    if (!move) {
      moves.push("(gave an answer that wasn't a valid move)");
      if (last) break;
      continue;
    }

    if (move.move === "finish" || last) {
      // A tester that never managed a single move didn't test anything: say so, rather
      // than letting the entry pass on a test that didn't happen.
      if (move.move !== "finish" && acted === 0) throw new Error("the AI tester gave no usable moves");
      const bugs = move.move === "finish" ? (move.bugs ?? []) : [];
      return {
        moves,
        kind: move.kind?.slice(0, 20),
        bugs: bugs.slice(0, 3).map((b) => (b.evidence ? `${b.what} (${b.evidence})` : b.what).slice(0, 240)),
        summary: (move.summary ?? (move.move === "finish" ? "" : "Ran out of moves without finding a problem.")).slice(0, 240),
        costUsd,
      };
    }

    // Carry out the move, give the page a moment, then look again.
    let commands: string[] = [];
    let described = "";
    if (move.move === "click") {
      const control = findControl(page, move.target);
      if (control) {
        commands = clickAt(control.x, control.y);
        described = `clicked "${control.label}"`;
      } else if (move.x !== undefined && move.y !== undefined) {
        const x = clamp(move.x, 0, SIZE.width - 1, SIZE.width / 2);
        const y = clamp(move.y, 0, SIZE.height - 1, SIZE.height / 2);
        commands = clickAt(x, y);
        described = `clicked at (${x}, ${y})`;
      } else {
        moves.push(`(tried to click "${move.target ?? ""}", which isn't on the page)`);
        continue;
      }
    } else if (move.move === "type") {
      const text = (move.text ?? "").replace(/\s+/g, " ").slice(0, 60);
      if (!text) {
        moves.push("(tried to type nothing)");
        continue;
      }
      const field = findControl(page, move.target);
      commands = [...(field ? clickAt(field.x, field.y) : []), `keyboard type ${text}`];
      described = field ? `typed "${text}" into "${field.label}"` : `typed "${text}"`;
    } else if (move.move === "scroll") {
      const dir = /up/i.test(move.direction ?? "") ? "up" : "down";
      commands = [`scroll ${dir} 400`];
      described = `scrolled ${dir}`;
    } else {
      const key = keyOf(move.key);
      if (!key) {
        moves.push(`(asked for a key it can't use: ${move.key ?? "none"})`);
        continue;
      }
      const ms = clamp(move.ms, 300, 1500, 800);
      commands = move.move === "hold" ? [`keydown ${key}`, `wait ${ms}`, `keyup ${key}`] : [`press ${key}`];
      described = move.move === "hold" ? `held ${key} for ${ms} ms` : `pressed ${key}`;
    }
    await browser.batch([...commands, "wait 400"]);
    before = now;
    now = (await browser.screenshot()) ?? now;
    page = await look();
    acted++;
    moves.push(move.reason ? `${described}: ${move.reason}` : described);
  }
  if (acted === 0) throw new Error("the AI tester gave no usable moves");
  return { moves, bugs: [], summary: "Couldn't finish its check.", costUsd };
}
