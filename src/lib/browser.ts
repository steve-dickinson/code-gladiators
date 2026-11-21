// A headless browser session driven by agent-browser commands. The session stays open
// between commands, so the AI tester carries on from where the scripted test left off.

/** The size every entry is tested, judged and shown at. */
export const VIEWPORT = { width: 960, height: 600 };

/** Anything that can run a command: a Vercel Sandbox, or a local shell when developing. */
export type CommandRunner = {
  runCommand(cmd: string, args: string[]): Promise<{ exitCode?: number | null; stdout(): Promise<string> }>;
};

export type BatchItem = { success?: boolean; error?: string | null; result?: Record<string, unknown> | null };

export type BrowserSession = {
  /** Runs commands in order and returns one result per command. */
  batch(commands: string[]): Promise<BatchItem[]>;
  /** A JPEG data URL of the page, or undefined if one couldn't be taken. */
  screenshot(): Promise<string | undefined>;
  close(): Promise<void>;
};

const SCREENSHOT_FLAGS = ["--screenshot-format", "jpeg", "--screenshot-quality", "60"];
const MAX_SCREENSHOT_CHARS = 300_000;

export function openBrowserSession(runner: CommandRunner, sessionName: string, browserPath?: string): BrowserSession {
  const baseArgs = [
    "--session",
    `cg-${sessionName}`,
    ...SCREENSHOT_FLAGS,
    ...(browserPath ? ["--executable-path", browserPath] : []),
  ];
  const screenshotPath = `/tmp/cg-shot-${sessionName}.jpg`;

  async function batch(commands: string[]): Promise<BatchItem[]> {
    const run = await runner.runCommand("agent-browser", [...baseArgs, "batch", ...commands, "--json"]);
    const stdout = await run.stdout();
    try {
      const items: unknown = JSON.parse(stdout);
      if (Array.isArray(items)) return items as BatchItem[];
    } catch {
      // Not JSON: fall through to the error below.
    }
    // No report at all means the browser itself failed, not the page.
    throw new Error(`agent-browser gave no report (exit ${run.exitCode}): ${stdout.slice(0, 300)}`);
  }

  async function screenshot(): Promise<string | undefined> {
    try {
      const [taken] = await batch([`screenshot ${screenshotPath}`]);
      if (!taken?.success) return undefined;
      // Read back with a shell command so this works on any CommandRunner.
      const data = (await (await runner.runCommand("base64", ["-w0", screenshotPath])).stdout()).trim();
      return data && data.length <= MAX_SCREENSHOT_CHARS ? `data:image/jpeg;base64,${data}` : undefined;
    } catch {
      return undefined; // a missing screenshot never fails a test
    }
  }

  async function close() {
    await runner.runCommand("agent-browser", [...baseArgs, "close"]).catch(() => {});
  }

  return { batch, screenshot, close };
}
