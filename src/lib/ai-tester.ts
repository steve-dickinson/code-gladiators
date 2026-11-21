import { generateText, type UserContent } from "ai";
import { z } from "zod";
import { VIEWPORT, type BrowserSession } from "./browser";
import { AI_TESTER_FALLBACKS, AI_TESTER_MODEL, GATEWAY_TAGS, LIMITS } from "./gladiators";
import { CONTROLS, evalCommand, type PageControls } from "./page-scripts";
import type { AiTestResult } from "./types";
import { base64Of } from "./utils";

// The AI tester: a small vision model uses the entry for a few moves, with the goal of
// checking it does what the challenge asked. The browser test can only tell that the
// page changed; this checks that it changed in the right way (Right moves the ship
// right, 7 + 6 shows 13). It reports a bug only with evidence.

const KEYS = [
  "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Space", "Enter", "Backspace", "Tab", "Escape", "Shift",
  "w", "a", "s", "d", "z", "x",
] as const;

const MAX_TEST_MS = 150_000;
const MAX_BUGS = 3;

const TESTER_SYSTEM = `You are a QA tester. A web page was built for a challenge, and you check that it works and does what the challenge asked for.
It might be a game, a tool (a calculator, a converter, a to-do list, a form), a toy or a visual. First work out which, and what a person would do with it. Then test exactly that:
- a game: start it, then try each control it uses, one at a time;
- a tool: use it with a realistic example and check the result is correct (for a calculator, do a sum you can check);
- a toy or a visual: interact the way its on-screen instructions say, and check it responds as described.
The page fills a ${VIEWPORT.width}x${VIEWPORT.height} window; x and y are measured from the top-left corner. Each turn you get the page's text, a list of its controls with their positions, a screenshot of it now and (after your first move) a screenshot from just before your last move. Choose ONE move:
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

const MoveSchema = z.object({
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
  bugs: z.array(z.object({ what: z.string(), evidence: z.string().nullish() })).optional(),
});
export type Move = z.infer<typeof MoveSchema>;

/**
 * Reads a move from a model's reply. Small models often wrap the JSON in prose, set
 * unused fields to null, write numbers as strings or bugs as plain sentences, so those
 * are tidied before the reply is checked against the schema.
 */
export function parseMove(reply: string): Move | undefined {
  const start = reply.indexOf("{");
  const end = reply.lastIndexOf("}");
  if (start < 0 || end <= start) return undefined;
  try {
    const raw = JSON.parse(reply.slice(start, end + 1)) as Record<string, unknown>;
    const tidy = Object.fromEntries(Object.entries(raw).filter(([, value]) => value !== null && value !== ""));
    if (typeof tidy.move === "string") tidy.move = tidy.move.toLowerCase().trim();
    for (const field of ["x", "y", "ms"]) if (typeof tidy[field] === "string") tidy[field] = Number(tidy[field]);
    for (const field of ["target", "text", "key"]) if (typeof tidy[field] === "number") tidy[field] = String(tidy[field]);
    if (Array.isArray(tidy.bugs)) tidy.bugs = tidy.bugs.map((bug) => (typeof bug === "string" ? { what: bug } : bug));
    const parsed = MoveSchema.safeParse(tidy);
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

/** A control by its label: an exact match first, then one that contains it. */
export function findControl(page: PageControls, target?: string) {
  const wanted = (target ?? "").trim().toLowerCase();
  if (!wanted) return undefined;
  const labelOf = (c: PageControls["controls"][number]) => c.label.toLowerCase();
  return (
    page.controls.find((c) => labelOf(c) === wanted) ??
    page.controls.find((c) => labelOf(c).includes(wanted) || (c.label && wanted.includes(labelOf(c))))
  );
}

/** The browser commands for a move, or why it can't be carried out. */
export type PlannedMove = { commands: string[]; description: string } | { skipped: string };

export function planMove(move: Move, page: PageControls): PlannedMove {
  switch (move.move) {
    case "click": {
      const control = findControl(page, move.target);
      if (control) return { commands: clickAt(control.x, control.y), description: `clicked "${control.label}"` };
      if (move.x === undefined || move.y === undefined) return { skipped: `(tried to click "${move.target ?? ""}", which isn't on the page)` };
      const x = clamp(move.x, 0, VIEWPORT.width - 1, VIEWPORT.width / 2);
      const y = clamp(move.y, 0, VIEWPORT.height - 1, VIEWPORT.height / 2);
      return { commands: clickAt(x, y), description: `clicked at (${x}, ${y})` };
    }
    case "type": {
      const text = (move.text ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
      if (!text) return { skipped: "(tried to type nothing)" };
      const field = findControl(page, move.target);
      return {
        commands: [...(field ? clickAt(field.x, field.y) : []), `keyboard type ${text}`],
        description: field ? `typed "${text}" into "${field.label}"` : `typed "${text}"`,
      };
    }
    case "scroll": {
      const direction = /up/i.test(move.direction ?? "") ? "up" : "down";
      return { commands: [`scroll ${direction} 400`], description: `scrolled ${direction}` };
    }
    case "press":
    case "hold": {
      const key = KEYS.find((k) => k.toLowerCase() === (move.key ?? "").toLowerCase());
      if (!key) return { skipped: `(asked for a key it can't use: ${move.key ?? "none"})` };
      if (move.move === "press") return { commands: [`press ${key}`], description: `pressed ${key}` };
      const ms = clamp(move.ms, 300, 1500, 800);
      return { commands: [`keydown ${key}`, `wait ${ms}`, `keyup ${key}`], description: `held ${key} for ${ms} ms` };
    }
    case "finish":
      return { skipped: "(finished)" };
  }
}

/** Uses the page for a few moves and reports what it found. Throws if it never managed a move. */
export async function aiTest(browser: BrowserSession, url: string, challenge: string): Promise<AiTestResult> {
  const startedAt = Date.now();
  // Start from a fresh load: the browser test may have left the page mid-game.
  await browser.batch([`open ${url}`, "wait 1200"]);
  const readPage = async (): Promise<PageControls> => {
    const [item] = await browser.batch([evalCommand(CONTROLS)]);
    return (item?.result?.result as PageControls | undefined) ?? { text: "", controls: [] };
  };

  let page = await readPage();
  let screenshot = await browser.screenshot();
  if (!screenshot) throw new Error("no screenshot to test from");
  let previousScreenshot: string | undefined;
  const moves: string[] = [];
  let movesMade = 0;
  let costUsd = 0;
  let model: string | undefined;

  for (let turn = 0; turn <= LIMITS.aiTesterMoves; turn++) {
    const lastTurn = turn === LIMITS.aiTesterMoves || Date.now() - startedAt > MAX_TEST_MS;
    const movesLeft = LIMITS.aiTesterMoves - turn;
    const answer = await askForMove(turnPrompt({ challenge, page, moves, lastTurn, movesLeft, screenshot, previousScreenshot }));
    costUsd += answer.costUsd;
    model = answer.model ?? model;
    const { move } = answer;

    if (!move) {
      moves.push("(gave an answer that wasn't a valid move)");
      if (lastTurn) break;
      continue;
    }
    if (move.move === "finish" && movesMade === 0 && !lastTurn) {
      moves.push("(tried to finish before testing anything: make at least one move first)");
      continue;
    }
    if (move.move === "finish" || lastTurn) {
      const sawBugWithoutMoving = move.move === "finish" && Boolean(move.bugs?.length);
      if (movesMade === 0 && !sawBugWithoutMoving) throw new Error("the AI tester gave no usable moves");
      return report(move, moves, costUsd, model);
    }

    const planned = planMove(move, page);
    if ("skipped" in planned) {
      moves.push(planned.skipped);
      continue;
    }
    await browser.batch([...planned.commands, "wait 400"]);
    previousScreenshot = screenshot;
    screenshot = (await browser.screenshot()) ?? screenshot;
    page = await readPage();
    movesMade++;
    moves.push(move.reason ? `${planned.description}: ${move.reason}` : planned.description);
  }

  if (movesMade === 0) throw new Error("the AI tester gave no usable moves");
  return { moves, bugs: [], summary: "Couldn't finish its check.", costUsd, model };
}

type TurnContext = {
  challenge: string;
  page: PageControls;
  moves: string[];
  lastTurn: boolean;
  movesLeft: number;
  screenshot: string;
  previousScreenshot?: string;
};

function turnPrompt({ challenge, page, moves, lastTurn, movesLeft, screenshot, previousScreenshot }: TurnContext): UserContent {
  const controls = page.controls.length
    ? page.controls.map((c) => `- ${c.kind} "${c.label || "(no label)"}" at (${c.x}, ${c.y})`).join("\n")
    : "(none: it may be drawn on a canvas, or used with the keyboard or mouse)";
  const history = moves.length ? moves.map((m, i) => `${i + 1}. ${m}`).join("\n") : "(none yet)";
  const text =
    `The challenge was: "${challenge}".\n` +
    `Text on the page now: "${page.text || "(none)"}".\n` +
    `Controls on the page now:\n${controls}\n` +
    `Your moves so far:\n${history}\n` +
    (lastTurn ? "This is your last turn: you must finish now." : `You have ${movesLeft} moves left.`);
  return [
    { type: "text", text },
    ...(previousScreenshot ? [{ type: "text" as const, text: "Before your last move:" }, image(previousScreenshot)] : []),
    { type: "text", text: "Now:" },
    image(screenshot),
  ];
}

async function askForMove(content: UserContent) {
  const result = await generateText({
    model: AI_TESTER_MODEL,
    system: TESTER_SYSTEM,
    messages: [{ role: "user", content }],
    maxOutputTokens: 300,
    abortSignal: AbortSignal.timeout(LIMITS.aiTesterTimeoutMs),
    maxRetries: 1,
    providerOptions: { gateway: { has: ["vision"], models: AI_TESTER_FALLBACKS, tags: GATEWAY_TAGS } },
  });
  const cost = (result.providerMetadata?.gateway as { cost?: string | number } | undefined)?.cost;
  return { move: parseMove(result.text), costUsd: Number(cost ?? 0), model: result.response.modelId || undefined };
}

function report(move: Move, moves: string[], costUsd: number, model?: string): AiTestResult {
  const finished = move.move === "finish";
  const bugs = finished ? (move.bugs ?? []) : [];
  return {
    moves,
    kind: move.kind?.slice(0, 20),
    bugs: bugs.slice(0, MAX_BUGS).map((b) => (b.evidence ? `${b.what} (${b.evidence})` : b.what).slice(0, 240)),
    summary: (move.summary ?? (finished ? "" : "Ran out of moves without finding a problem.")).slice(0, 240),
    costUsd,
    model,
  };
}

const image = (dataUrl: string) => ({ type: "file" as const, data: base64Of(dataUrl), mediaType: "image/jpeg" });
const clickAt = (x: number, y: number) => [`mouse move ${x} ${y}`, "mouse down", "mouse up"];
const clamp = (n: number | undefined, min: number, max: number, fallback: number) =>
  Math.round(Math.min(max, Math.max(min, Number.isFinite(n) ? (n as number) : fallback)));
