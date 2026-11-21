import { Sandbox } from "@vercel/sandbox";
import { createAgentBrowserSandbox, type VercelSandboxConstructor } from "@agent-browser/sandbox/vercel";
import { aiPlaytest } from "./playtester";
import type { TestReport } from "./types";

const PORT = 3000;

// Workflow steps run in separate function calls, so they can't share a live
// Sandbox object. Instead they share this small handle and reconnect by name.
export type ArenaHandle = { name: string; baseUrl: string; root: string; browserPath?: string };

// A tiny static file server. It answers /favicon.ico with "no content" so the
// browser test doesn't report a missing icon as a bug in the game.
const server = (root: string) => `
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (path === "/favicon.ico") return res.writeHead(204).end();
  try {
    if (path.includes("..")) throw new Error("no");
    const body = await readFile(${JSON.stringify(root)} + (path.endsWith("/") ? path + "index.html" : path));
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }).end(body);
  } catch {
    res.writeHead(404).end("not found");
  }
}).listen(${PORT});
`;

const WAITING = `<body style="background:#0b0b0c;color:#888;font:14px monospace;display:grid;place-items:center;height:100vh">warming up…</body>`;

// One sandbox per battle, holding every gladiator's game and a headless browser
// (agent-browser) to play them. The browser comes preinstalled from a snapshot
// when AGENT_BROWSER_SNAPSHOT_ID is set (boots in about a second); otherwise it
// installs Chromium on the spot, which takes 30 seconds or so.
export async function openArena(gladiatorIds: string[]): Promise<ArenaHandle> {
  const timeout = 15 * 60 * 1000; // long enough to watch the games afterwards (Hobby max is 45)
  const create = (fresh: boolean) =>
    createAgentBrowserSandbox({
      Sandbox: Sandbox as unknown as VercelSandboxConstructor,
      timeout,
      createOptions: {
        ports: [PORT],
        timeout,
        resources: { vcpus: 2 }, // Chromium needs more room than a file server
        persistent: false, // throwaway: nothing to store afterwards
        tags: { app: "code-gladiators" },
      },
      ...(fresh ? { snapshotId: null } : {}),
    });

  let session;
  try {
    session = await create(false);
  } catch (err) {
    if (!process.env.AGENT_BROWSER_SNAPSHOT_ID) throw err;
    console.warn("The browser snapshot didn't boot, so installing the browser from scratch", err);
    session = await create(true);
  }

  const sandbox = session as unknown as Sandbox;
  // Chrome's lighter "headless shell" draws games at a steady 60 frames a second.
  // The full Chrome that agent-browser installs sometimes gets stuck at about 4,
  // which makes a working game look like it ignores the keys.
  const browserPath = await installHeadlessShell(sandbox);
  // Installing the browser needed the internet. The AI-written games must not have it.
  await sandbox.update({ networkPolicy: "deny-all" });

  const root = `${sandbox.cwd}/arena`;
  await sandbox.writeFiles([
    { path: `${root}/server.mjs`, content: server(root) },
    ...gladiatorIds.map((id) => ({ path: `${root}/${id}/index.html`, content: WAITING })),
  ]);
  await sandbox.runCommand({ cmd: "node", args: [`${root}/server.mjs`], detached: true });

  return { name: sandbox.name, baseUrl: sandbox.domain(PORT), root, browserPath };
}

const PLAYWRIGHT_VERSION = "1.65.1"; // only used to download the headless shell
async function installHeadlessShell(sandbox: Sandbox): Promise<string | undefined> {
  try {
    const run = await sandbox.runCommand({
      cmd: "bash",
      args: [
        "-lc",
        `npx -y playwright@${PLAYWRIGHT_VERSION} install chromium-headless-shell > /tmp/headless-shell.log 2>&1; ` +
          "ls -d $HOME/.cache/ms-playwright/chromium_headless_shell-*/chrome-headless-shell-linux64/chrome-headless-shell 2>/dev/null | head -1",
      ],
    });
    const path = (await run.stdout()).trim();
    return path || undefined; // without it, agent-browser's own Chrome is used
  } catch (err) {
    console.warn("Couldn't install the headless shell; using agent-browser's Chrome", err);
    return undefined;
  }
}

export async function deploy(arena: ArenaHandle, gladiatorId: string, html: string) {
  const sandbox = await Sandbox.get({ name: arena.name });
  await sandbox.writeFiles([{ path: `${arena.root}/${gladiatorId}/index.html`, content: html }]);
  return `${arena.baseUrl}/${gladiatorId}/`;
}

export async function playtest(arena: ArenaHandle, gladiatorId: string, round: number, challenge?: string): Promise<TestReport> {
  const sandbox = await Sandbox.get({ name: arena.name });
  const url = `http://localhost:${PORT}/${gladiatorId}/`;
  return playtestWith(sandbox as unknown as CommandRunner, url, gladiatorId, round, challenge, arena.browserPath);
}

// ---------------------------------------------------------------------------
// The playtest itself. It only needs something that can run a command, so the
// same code runs against a real sandbox or, when testing, your own machine.

export type CommandRunner = {
  runCommand(cmd: string, args: string[]): Promise<{ exitCode?: number | null; stdout(): Promise<string> }>;
};

type BatchItem = { success?: boolean; error?: string | null; result?: Record<string, unknown> | null };

// One headless browser per gladiator, driven by agent-browser commands. It stays
// open between commands (same session), so the AI playtester can carry on where
// the scripted test left off.
export type BrowserSession = {
  batch(commands: string[]): Promise<BatchItem[]>;
  screenshot(): Promise<string | undefined>;
  close(): Promise<void>;
};

const SCREENSHOT_FLAGS = ["--screenshot-format", "jpeg", "--screenshot-quality", "60"];
const MAX_SCREENSHOT_CHARS = 300_000; // about 220 KB of JPEG; game screenshots are usually far smaller

function browserSession(runner: CommandRunner, session: string, browserPath?: string): BrowserSession {
  const base = ["--session", `cg-${session}`, ...SCREENSHOT_FLAGS, ...(browserPath ? ["--executable-path", browserPath] : [])];
  const shot = `/tmp/cg-shot-${session}.jpg`;
  const batch = async (commands: string[]) => {
    const cmd = await runner.runCommand("agent-browser", [...base, "batch", ...commands, "--json"]);
    const stdout = await cmd.stdout();
    try {
      const items = JSON.parse(stdout);
      if (Array.isArray(items)) return items as BatchItem[];
    } catch {}
    // No report at all means the browser itself didn't run: our problem, not the game's.
    throw new Error(`agent-browser gave no report (exit ${cmd.exitCode}): ${stdout.slice(0, 300)}`);
  };
  return {
    batch,
    // Read the picture back as base64 with a plain shell command, so this works the
    // same on a real sandbox and on your own machine.
    async screenshot() {
      try {
        const [taken] = await batch([`screenshot ${shot}`]);
        if (!taken?.success) return undefined;
        const data = (await (await runner.runCommand("base64", ["-w0", shot])).stdout()).trim();
        return data && data.length <= MAX_SCREENSHOT_CHARS ? `data:image/jpeg;base64,${data}` : undefined;
      } catch {
        return undefined; // a missing picture never fails a test
      }
    },
    async close() {
      await runner.runCommand("agent-browser", [...base, "close"]).catch(() => {});
    },
  };
}

// Runs inside the page: is anything on screen, is the canvas a real size,
// plus a fingerprint that tells us whether the page changed while we played.
const PROBE = `(() => {
  const cs = [...document.querySelectorAll("canvas")];
  let painted = 0, shown = 0, biggest = 0, sig = "";
  for (const c of cs) {
    const r = c.getBoundingClientRect();
    if (r.width >= 4 && r.height >= 4) shown++;
    biggest = Math.max(biggest, (r.width * r.height) / (innerWidth * innerHeight));
    let url = ""; try { url = c.toDataURL("image/png"); } catch {}
    sig += url.length + url.slice(-40);
    try {
      const g = c.getContext("2d");
      if (g && c.width && c.height) {
        const d = g.getImageData(0, 0, c.width, c.height).data;
        const first = d.slice(0, 4).join();
        let diff = 0;
        for (let i = 0; i < d.length && diff < 2; i += 4 * 13) if (d.slice(i, i + 4).join() !== first) diff++;
        if (diff >= 2) painted++;
      } else if (url.length > 3000) painted++; // a WebGL canvas with something on it
    } catch {}
  }
  const els = [...(document.body?.querySelectorAll("*") ?? [])];
  const visible = els.filter((e) => { const r = e.getBoundingClientRect(); return r.width > 4 && r.height > 4; }).length;
  const text = (document.body?.innerText ?? "").trim().length;
  return { canvases: cs.length, shown, biggest, painted, visible, text, sig: sig + "|" + (document.body?.innerHTML.length ?? 0) + "|" + text };
})()`;

// Runs inside the page: press its own Start / Play button, if it has one.
const CLICK_START = `(() => {
  const ok = (e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 4 && r.height > 4 && s.visibility !== "hidden" && s.display !== "none"; };
  const label = (e) => ((e.textContent || e.value || "") + " " + (e.id || "")).trim();
  const words = /start|play|begin|insert coin|new game|race|launch|\\bgo\\b/i;
  const el = [...document.querySelectorAll("button, [role=button], input[type=button], input[type=submit], a")].find((e) => ok(e) && words.test(label(e)));
  if (!el) return "";
  el.click();
  return label(el).slice(0, 40);
})()`;

// Runs inside the page: how many animation frames a second the browser draws.
const FPS = `new Promise((done) => { let n = 0; const t = performance.now(); (function f() { n++; if (performance.now() - t < 500) requestAnimationFrame(f); else done(n * 2); })(); })`;

const b64 = (js: string) => `eval -b ${Buffer.from(js).toString("base64")}`;
const FPS_CMD = b64(FPS);
const MIN_FPS = 20;
const PROBE_CMD = b64(PROBE);
const CLICK_START_CMD = b64(CLICK_START);

type Probe = { canvases: number; shown: number; biggest: number; painted: number; visible: number; text: number; sig: string };

// Use the page like an impatient player would: load it, look, press any Start button,
// mash and hold keys, move the mouse, look again, then collect every error it threw.
// Harmless for a tool or a toy; it's how most games get going.
const steps = (url: string) => [
  "set viewport 960 600", // a laptop-ish screen, the same size the cards show
  "errors --clear",
  `open ${url}`,
  "wait 1500",
  PROBE_CMD, // what's on screen before we touch it
  CLICK_START_CMD, // its own Start button, if it has one
  "wait 400",
  "click body",
  "press Space",
  "press Enter",
  "keydown ArrowRight",
  "wait 600",
  "keyup ArrowRight",
  PROBE_CMD, // part-way through (a player that goes right then back left can end where it started)
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
  PROBE_CMD, // and at the end
  "errors", // uncaught exceptions
  "console", // console.error messages
];

// Is the challenge a game? Only games are expected to react to arrow keys and Space.
const GAME_WORDS =
  /\b(game|arcade|platformer|shooter|puzzle|racing|race|runner|score|level|lives|snake|tetris|pong|breakout|asteroids|invaders|centipede|pac-?man|kong|flappy|maze|frogger|sokoban|minesweeper|chess|solitaire)\b/i;
export const looksLikeGame = (challenge?: string) => Boolean(challenge && GAME_WORDS.test(challenge));

export async function playtestWith(
  runner: CommandRunner,
  url: string,
  session: string,
  round: number,
  challenge?: string,
  browserPath?: string,
): Promise<TestReport> {
  const t0 = Date.now();
  // Warm up: a headless browser now and then gets stuck drawing about 4 frames a
  // second, and anything animated crawling at that speed looks like it ignores input. If
  // that happens, start a fresh browser (up to three tries).
  let browser = browserSession(runner, `${session}-${round}-1`, browserPath);
  let fps = 0;
  for (let attempt = 1; attempt <= 3; attempt++) {
    if (attempt > 1) browser = browserSession(runner, `${session}-${round}-${attempt}`, browserPath);
    const warm = await browser.batch(["set viewport 960 600", `open ${url}`, "wait 300", FPS_CMD]);
    fps = Number(warm[3]?.result?.result ?? 0);
    if (fps >= MIN_FPS || attempt === 3) break;
    await browser.close();
  }
  const slowBrowser = fps < MIN_FPS;
  try {
    const list = steps(url);
    const items = await browser.batch(list);
    const at = (cmd: string) => items[list.indexOf(cmd)];
    const opened = items[list.findIndex((s) => s.startsWith("open "))];
    if (!opened?.success) throw new Error(`The browser couldn't open the page: ${opened?.error ?? "no reason given"}`);

    const errors: string[] = [];
    const pageErrors = (at("errors")?.result?.errors ?? []) as { text: string; line?: number }[];
    for (const e of pageErrors) errors.push(e.line ? `${e.text} (line ${e.line})` : e.text);
    const messages = (at("console")?.result?.messages ?? []) as { type: string; text: string }[];
    for (const m of messages) if (m.type === "error" && !/favicon/i.test(m.text)) errors.push(m.text);

    // A command that got no answer once the game was running means the page froze.
    const frozen = items
      .slice(list.indexOf(PROBE_CMD), list.lastIndexOf(PROBE_CMD) + 1)
      .some((i) => i?.success === false && /no response|timed? ?out/i.test(i?.error ?? ""));
    if (frozen) errors.push("The page froze while being played: an endless loop, or far too much work per frame?");

    const probe = (item?: BatchItem) => (item?.success ? (item.result?.result as Probe | undefined) : undefined);
    const probes = list.flatMap((cmd, i) => (cmd === PROBE_CMD ? [probe(items[i])] : []));
    const before = probes[0];
    const after = (!frozen && probes.at(-1)) || before;
    const blank = !after || (after.painted === 0 && after.text < 5 && after.visible < 3);
    const responsive = Boolean(before && probes.slice(1).some((p) => p && p.sig !== before.sig));
    const startedWith = (at(CLICK_START_CMD)?.result?.result as string | undefined) || "";

    // Problems a player would hit straight away, even though nothing threw an error.
    // These only make sense for a game, or a page whose main content is a canvas: a
    // calculator rightly ignores arrow keys, and a sketch pad starts as a blank canvas.
    // Whether anything else does its job is left to the AI tester, which uses it.
    // (Also skipped if the browser itself was too slow to judge fairly.)
    const canvasIsTheEntry = after ? after.canvases > 0 && after.text < 80 : false;
    if (!frozen && after && !blank && !slowBrowser && (looksLikeGame(challenge) || canvasIsTheEntry)) {
      if (after.canvases > 0 && after.shown === 0) {
        errors.push("The <canvas> takes up no space on the page (0 pixels wide or tall), so nothing can be seen. Give it an explicit width and height.");
      } else if (after.shown > 0 && after.biggest >= 0.15 && after.painted === 0) {
        errors.push(`The <canvas> stayed one flat colour after the browser ${startedWith ? `clicked "${startedWith}" and ` : ""}played for several seconds: nothing was drawn.`);
      } else if (!responsive) {
        errors.push(
          `Nothing on the page changed while the browser ${startedWith ? `clicked "${startedWith}", then ` : ""}pressed and held Space, Enter, the arrow keys and letters, and moved the mouse, for several seconds. The game must start and react to input.`,
        );
      }
    }
    const unique = [...new Set(errors.map((e) => e.trim().slice(0, 300)))].slice(0, 6);
    const scriptedPass = unique.length === 0 && !blank;

    // The scripted test only proves the page runs (and, for a game, reacts). If it got
    // that far, an AI tester uses it for its purpose: does it do what it should?
    let ai: TestReport["ai"];
    if (scriptedPass && challenge && !frozen && !slowBrowser) {
      ai = await aiPlaytest(browser, url, challenge).catch((err) => {
        console.warn("AI playtester couldn't finish; using the scripted test alone", err);
        return undefined;
      });
    }
    const screenshot = frozen ? undefined : await browser.screenshot();

    return {
      round,
      passed: scriptedPass && !(ai && ai.bugs.length > 0),
      errors: unique,
      blank,
      responsive,
      ms: Date.now() - t0,
      screenshot,
      ...(ai ? { ai } : {}),
      ...(slowBrowser ? { slowBrowser: true } : {}),
    };
  } finally {
    await browser.close(); // shut the browser so it stops using CPU
  }
}
