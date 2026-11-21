import { aiTest } from "./ai-tester";
import { openBrowserSession, VIEWPORT, type BatchItem, type BrowserSession, type CommandRunner } from "./browser";
import { CLICK_START, evalCommand, FRAME_RATE, PROBE, type PageProbe } from "./page-scripts";
import type { TestReport } from "./types";
import { errorMessage } from "./utils";

// The browser test: load the entry, use it like an impatient person would, and collect
// everything that went wrong. If that passes, the AI tester uses it for its purpose.

const PROBE_CMD = evalCommand(PROBE);
const CLICK_START_CMD = evalCommand(CLICK_START);
const FRAME_RATE_CMD = evalCommand(FRAME_RATE);

/** Below this, animation is too slow to tell a broken control from a slow browser. */
const MIN_FRAME_RATE = 20;
const BROWSER_ATTEMPTS = 3;
const MAX_ERRORS = 6;

const GAME_WORDS =
  /\b(game|arcade|platformer|shooter|puzzle|racing|race|runner|score|level|lives|snake|tetris|pong|breakout|asteroids|invaders|centipede|pac-?man|kong|flappy|maze|frogger|sokoban|minesweeper|chess|solitaire)\b/i;

/** Only games are expected to react to arrow keys and Space. */
export const looksLikeGame = (challenge?: string) => Boolean(challenge && GAME_WORDS.test(challenge));

/** Load, look, press Start, hold and tap keys, move the mouse, look again, collect errors. */
function interactionScript(url: string): string[] {
  return [
    `set viewport ${VIEWPORT.width} ${VIEWPORT.height}`,
    "errors --clear",
    `open ${url}`,
    "wait 1500",
    PROBE_CMD,
    CLICK_START_CMD,
    "wait 400",
    "click body",
    "press Space",
    "press Enter",
    "keydown ArrowRight",
    "wait 600",
    "keyup ArrowRight",
    // Probe mid-way too: holding Right then Left for equal times can end where it started.
    PROBE_CMD,
    "keydown ArrowLeft",
    "wait 300",
    "keyup ArrowLeft",
    "press ArrowUp",
    "press ArrowDown",
    "press w",
    "press a",
    "press d",
    "press z",
    "press x",
    "mouse move 480 450",
    "mouse move 300 400",
    "wait 1000",
    PROBE_CMD,
    "errors",
    "console",
  ];
}

export type BrowserTestOptions = {
  runner: CommandRunner;
  url: string;
  /** Names the browser session; unique per gladiator. */
  sessionName: string;
  round: number;
  /** Lets the test tell games from tools, and gives the AI tester its goal. */
  challenge?: string;
  /** A Chrome binary to use instead of agent-browser's own. */
  browserPath?: string;
};

export async function runBrowserTest(options: BrowserTestOptions): Promise<TestReport> {
  const { url, round, challenge } = options;
  const startedAt = Date.now();
  const { browser, slowBrowser } = await openFastBrowser(options);
  try {
    const script = interactionScript(url);
    const results = await browser.batch(script);
    const resultOf = (command: string) => results[script.indexOf(command)];

    const opened = results[script.findIndex((c) => c.startsWith("open "))];
    if (!opened?.success) throw new Error(`The browser couldn't open the page: ${opened?.error ?? "no reason given"}`);

    const errors = pageErrors(resultOf("errors"), resultOf("console"));
    const frozen = froze(script, results);
    if (frozen) errors.push("The page froze while being played: an endless loop, or far too much work per frame?");

    const probes = script.flatMap((command, i) => (command === PROBE_CMD ? [probeResult(results[i])] : []));
    const before = probes[0];
    const after = (!frozen && probes.at(-1)) || before;
    const blank = !after || (after.painted === 0 && after.text < 5 && after.visible < 3);
    const responsive = Boolean(before && probes.slice(1).some((p) => p && p.signature !== before.signature));
    const startButton = (resultOf(CLICK_START_CMD)?.result?.result as string | undefined) || "";

    const checkInteraction = !frozen && !blank && !slowBrowser && after && (looksLikeGame(challenge) || canvasIsTheEntry(after));
    if (checkInteraction) {
      const problem = interactionProblem(after, responsive, startButton);
      if (problem) errors.push(problem);
    }

    const uniqueErrors = [...new Set(errors.map((e) => e.trim().slice(0, 300)))].slice(0, MAX_ERRORS);
    const scriptedPass = uniqueErrors.length === 0 && !blank;

    let ai: TestReport["ai"];
    let aiError: string | undefined;
    if (scriptedPass && challenge && !frozen && !slowBrowser) {
      try {
        ai = await aiTest(browser, url, challenge);
      } catch (err) {
        console.warn("The AI tester couldn't finish; using the browser test alone", err);
        aiError = errorMessage(err);
      }
    }
    const screenshot = frozen ? undefined : await browser.screenshot();

    return {
      round,
      passed: scriptedPass && !ai?.bugs.length,
      errors: uniqueErrors,
      blank,
      responsive,
      ms: Date.now() - startedAt,
      screenshot,
      ...(ai && { ai }),
      ...(aiError && { aiError }),
      ...(slowBrowser && { slowBrowser }),
    };
  } finally {
    await browser.close();
  }
}

/**
 * Headless Chrome occasionally gets stuck drawing a few frames a second, which makes
 * working controls look broken. Measure the frame rate and start a fresh browser if it's slow.
 */
async function openFastBrowser({ runner, url, sessionName, round, browserPath }: BrowserTestOptions) {
  let browser: BrowserSession | undefined;
  let frameRate = 0;
  for (let attempt = 1; attempt <= BROWSER_ATTEMPTS; attempt++) {
    browser = openBrowserSession(runner, `${sessionName}-${round}-${attempt}`, browserPath);
    const results = await browser.batch([`set viewport ${VIEWPORT.width} ${VIEWPORT.height}`, `open ${url}`, "wait 300", FRAME_RATE_CMD]);
    frameRate = Number(results[3]?.result?.result ?? 0);
    if (frameRate >= MIN_FRAME_RATE || attempt === BROWSER_ATTEMPTS) break;
    await browser.close();
  }
  return { browser: browser!, slowBrowser: frameRate < MIN_FRAME_RATE };
}

function pageErrors(errorsResult?: BatchItem, consoleResult?: BatchItem): string[] {
  const exceptions = (errorsResult?.result?.errors ?? []) as { text: string; line?: number }[];
  const messages = (consoleResult?.result?.messages ?? []) as { type: string; text: string }[];
  return [
    ...exceptions.map((e) => (e.line ? `${e.text} (line ${e.line})` : e.text)),
    ...messages.filter((m) => m.type === "error" && !/favicon/i.test(m.text)).map((m) => m.text),
  ];
}

/** A command that timed out between the first and last probe means the page stopped responding. */
function froze(script: string[], results: BatchItem[]): boolean {
  return results
    .slice(script.indexOf(PROBE_CMD), script.lastIndexOf(PROBE_CMD) + 1)
    .some((r) => r?.success === false && /no response|timed? ?out/i.test(r?.error ?? ""));
}

const probeResult = (item?: BatchItem) => (item?.success ? (item.result?.result as PageProbe | undefined) : undefined);

/** A page that is little more than a canvas: probably a game or a visual. */
const canvasIsTheEntry = (probe: PageProbe) => probe.canvases > 0 && probe.text < 80;

/** Problems a player would hit straight away, even though nothing threw an error. */
function interactionProblem(after: PageProbe, responsive: boolean, startButton: string): string | undefined {
  if (after.canvases > 0 && after.shown === 0) {
    return "The <canvas> takes up no space on the page (0 pixels wide or tall), so nothing can be seen. Give it an explicit width and height.";
  }
  const clicked = startButton ? `clicked "${startButton}" and ` : "";
  if (after.shown > 0 && after.biggest >= 0.15 && after.painted === 0) {
    return `The <canvas> stayed one flat colour after the browser ${clicked}played for several seconds: nothing was drawn.`;
  }
  if (!responsive) {
    const clickedThen = startButton ? `clicked "${startButton}", then ` : "";
    return `Nothing on the page changed while the browser ${clickedThen}pressed and held Space, Enter, the arrow keys and letters, and moved the mouse, for several seconds. The game must start and react to input.`;
  }
  return undefined;
}
