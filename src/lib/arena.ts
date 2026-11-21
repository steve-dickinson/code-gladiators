import { createAgentBrowserSandbox, type VercelSandboxConstructor } from "@agent-browser/sandbox/vercel";
import { Sandbox } from "@vercel/sandbox";
import type { CommandRunner } from "./browser";
import { runBrowserTest } from "./browser-test";
import type { TestReport } from "./types";

// One Vercel Sandbox per battle: a static file server for every gladiator's entry and a
// headless browser to test them, with the internet switched off once set up.

const PORT = 3000;
/** Long enough to play the entries after the battle (the Hobby maximum is 45 minutes). */
const SANDBOX_TIMEOUT_MS = 15 * 60 * 1000;
/** Only used to download Chrome's headless shell. */
const PLAYWRIGHT_VERSION = "1.65.1";

/** Workflow steps run separately and can't share a Sandbox object, so they pass this and reconnect by name. */
export type ArenaHandle = { name: string; baseUrl: string; root: string; browserPath?: string };

const PLACEHOLDER_PAGE = `<body style="background:#0b0b0c;color:#888;font:14px monospace;display:grid;place-items:center;height:100vh">warming up…</body>`;

/** A minimal static server. /favicon.ico gets "no content" so a missing icon isn't reported as an error. */
const fileServer = (root: string) => `
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (path === "/favicon.ico") return res.writeHead(204).end();
  try {
    if (path.includes("..")) throw new Error("path traversal");
    const body = await readFile(${JSON.stringify(root)} + (path.endsWith("/") ? path + "index.html" : path));
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }).end(body);
  } catch {
    res.writeHead(404).end("not found");
  }
}).listen(${PORT});
`;

/**
 * Creates the battle's sandbox. With AGENT_BROWSER_SNAPSHOT_ID set, the browser comes
 * preinstalled and boots in about a second; otherwise it's installed on the spot.
 */
export async function openArena(gladiatorIds: string[]): Promise<ArenaHandle> {
  const sandbox = await createSandbox();
  const browserPath = await installHeadlessShell(sandbox);
  // Setup needed the internet; AI-written code must not have it.
  await sandbox.update({ networkPolicy: "deny-all" });

  const root = `${sandbox.cwd}/arena`;
  await sandbox.writeFiles([
    { path: `${root}/server.mjs`, content: fileServer(root) },
    ...gladiatorIds.map((id) => ({ path: `${root}/${id}/index.html`, content: PLACEHOLDER_PAGE })),
  ]);
  await sandbox.runCommand({ cmd: "node", args: [`${root}/server.mjs`], detached: true });

  return { name: sandbox.name, baseUrl: sandbox.domain(PORT), root, browserPath };
}

async function createSandbox(): Promise<Sandbox> {
  const create = (fromSnapshot: boolean) =>
    createAgentBrowserSandbox({
      Sandbox: Sandbox as unknown as VercelSandboxConstructor,
      timeout: SANDBOX_TIMEOUT_MS,
      createOptions: {
        ports: [PORT],
        timeout: SANDBOX_TIMEOUT_MS,
        resources: { vcpus: 2 },
        persistent: false,
        tags: { app: "code-gladiators" },
      },
      ...(fromSnapshot ? {} : { snapshotId: null }),
    });
  try {
    return (await create(true)) as unknown as Sandbox;
  } catch (err) {
    if (!process.env.AGENT_BROWSER_SNAPSHOT_ID) throw err;
    console.warn("The browser snapshot didn't boot; installing the browser instead", err);
    return (await create(false)) as unknown as Sandbox;
  }
}

/**
 * Chrome's headless shell animates at a steady frame rate, where the full Chrome that
 * agent-browser installs sometimes stalls. Returns its path, or undefined to use the default.
 */
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
    return (await run.stdout()).trim() || undefined;
  } catch (err) {
    console.warn("Couldn't install the headless shell; using agent-browser's Chrome", err);
    return undefined;
  }
}

/** Serves `html` as the gladiator's entry and returns its public URL. */
export async function deployEntry(arena: ArenaHandle, gladiatorId: string, html: string): Promise<string> {
  const sandbox = await Sandbox.get({ name: arena.name });
  await sandbox.writeFiles([{ path: `${arena.root}/${gladiatorId}/index.html`, content: html }]);
  return `${arena.baseUrl}/${gladiatorId}/`;
}

export async function testEntry(arena: ArenaHandle, gladiatorId: string, round: number, challenge: string): Promise<TestReport> {
  const sandbox = await Sandbox.get({ name: arena.name });
  return runBrowserTest({
    runner: sandbox as unknown as CommandRunner,
    url: `http://localhost:${PORT}/${gladiatorId}/`,
    sessionName: gladiatorId,
    round,
    challenge,
    browserPath: arena.browserPath,
  });
}
