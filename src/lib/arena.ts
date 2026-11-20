import { Sandbox } from "@vercel/sandbox";
import { createAgentBrowserSandbox, type VercelSandboxConstructor } from "@agent-browser/sandbox/vercel";
import type { TestReport } from "./types";

const PORT = 3000;

// Workflow steps run in separate function calls, so they can't share a live
// Sandbox object. Instead they share this small handle and reconnect by name.
export type ArenaHandle = { name: string; baseUrl: string; root: string };

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
  // Installing the browser needed the internet. The AI-written games must not have it.
  await sandbox.update({ networkPolicy: "deny-all" });

  const root = `${sandbox.cwd}/arena`;
  await sandbox.writeFiles([
    { path: `${root}/server.mjs`, content: server(root) },
    ...gladiatorIds.map((id) => ({ path: `${root}/${id}/index.html`, content: WAITING })),
  ]);
  await sandbox.runCommand({ cmd: "node", args: [`${root}/server.mjs`], detached: true });

  return { name: sandbox.name, baseUrl: sandbox.domain(PORT), root };
}

export async function deploy(arena: ArenaHandle, gladiatorId: string, html: string) {
  const sandbox = await Sandbox.get({ name: arena.name });
  await sandbox.writeFiles([{ path: `${arena.root}/${gladiatorId}/index.html`, content: html }]);
  return `${arena.baseUrl}/${gladiatorId}/`;
}

export async function playtest(arena: ArenaHandle, gladiatorId: string, round: number): Promise<TestReport> {
  const sandbox = await Sandbox.get({ name: arena.name });
  return playtestWith(sandbox as unknown as CommandRunner, `http://localhost:${PORT}/${gladiatorId}/`, gladiatorId, round);
}

// ---------------------------------------------------------------------------
// The playtest itself. It only needs something that can run a command, so the
// same code runs against a real sandbox or, when testing, your own machine.

export type CommandRunner = {
  runCommand(cmd: string, args: string[]): Promise<{ exitCode?: number | null; stdout(): Promise<string> }>;
};

// Runs inside the game page: is anything on screen, plus a fingerprint that
// tells us whether the page changed when we played it.
const PROBE = `(() => {
  const cs = [...document.querySelectorAll("canvas")];
  let painted = 0, sig = "";
  for (const c of cs) {
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
  return { canvases: cs.length, painted, visible, text, sig: sig + "|" + (document.body?.innerHTML.length ?? 0) + "|" + text };
})()`;
const PROBE_B64 = Buffer.from(PROBE).toString("base64");

type Probe = { canvases: number; painted: number; visible: number; text: number; sig: string };
type BatchItem = { success?: boolean; error?: string | null; result?: Record<string, unknown> | null };

// Play the game like an impatient player: load it, look, click, mash the keys,
// move the mouse, look again, then collect every error the page threw.
const STEPS = (url: string) => [
  "errors --clear", // 0
  `open ${url}`, // 1
  "wait 1500", // 2
  `eval -b ${PROBE_B64}`, // 3: what's on screen before we touch it
  "click body",
  "press Space",
  "press Enter",
  "press ArrowRight",
  "press ArrowRight",
  "press ArrowLeft",
  "press ArrowUp",
  "keyboard type asdf",
  "hover body",
  "wait 1000", // 13
  `eval -b ${PROBE_B64}`, // 14: and after
  "errors", // 15: uncaught exceptions
  "console", // 16: console.error messages
  "close", // shut the browser so it stops using CPU
];

export async function playtestWith(runner: CommandRunner, url: string, session: string, round: number): Promise<TestReport> {
  const t0 = Date.now();
  const cmd = await runner.runCommand("agent-browser", ["--session", `cg-${session}`, "batch", ...STEPS(url), "--json"]);
  const stdout = await cmd.stdout();

  let items: BatchItem[];
  try {
    items = JSON.parse(stdout);
    if (!Array.isArray(items)) throw new Error("not a list");
  } catch {
    // No report at all means the browser itself didn't run: our problem, not the game's.
    throw new Error(`agent-browser gave no report (exit ${cmd.exitCode}): ${stdout.slice(0, 300)}`);
  }
  if (!items[1]?.success) throw new Error(`The browser couldn't open the game: ${items[1]?.error ?? "no reason given"}`);

  const errors: string[] = [];
  const pageErrors = (items[15]?.result?.errors ?? []) as { text: string; line?: number }[];
  for (const e of pageErrors) errors.push(e.line ? `${e.text} (line ${e.line})` : e.text);
  const messages = (items[16]?.result?.messages ?? []) as { type: string; text: string }[];
  for (const m of messages) if (m.type === "error" && !/favicon/i.test(m.text)) errors.push(m.text);
  // A command that got no answer once the game was running means the page froze.
  const frozen = items.slice(3, 15).some((i) => i?.success === false && /no response|timed? ?out/i.test(i?.error ?? ""));
  if (frozen) errors.push("The page froze while being played: an endless loop, or far too much work per frame?");

  const probe = (i: number) => (items[i]?.success ? (items[i]?.result?.result as Probe | undefined) : undefined);
  const before = probe(3);
  const after = (!frozen && probe(14)) || before;
  const blank = !after || (after.painted === 0 && after.text < 5 && after.visible < 3);
  const unique = [...new Set(errors.map((e) => e.trim().slice(0, 300)))].slice(0, 6);

  return {
    round,
    passed: unique.length === 0 && !blank,
    errors: unique,
    blank,
    responsive: Boolean(before && after && before.sig !== after.sig),
    ms: Date.now() - t0,
  };
}
