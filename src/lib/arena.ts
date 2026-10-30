import { Sandbox } from "@vercel/sandbox";

const PORT = 3000;

// One sandbox per battle. Every gladiator's game is served from its own
// folder inside a Firecracker microVM that has no internet access, so
// AI-written code can't phone home, mine crypto or touch your app.
export async function openArena(gladiatorIds: string[]) {
  const sandbox = await Sandbox.create({
    ports: [PORT],
    timeout: 10 * 60 * 1000, // 10 minutes is plenty to watch the fight (Hobby max is 45)
    resources: { vcpus: 1 }, // a static file server needs almost nothing
    persistent: false, // throwaway: no snapshot to store afterwards
    networkPolicy: "deny-all", // no outbound network from inside the arena
    tags: { app: "code-gladiators" },
  });

  const root = `${sandbox.cwd}/arena`;
  await sandbox.writeFiles(
    gladiatorIds.map((id) => ({
      path: `${root}/${id}/index.html`,
      content: `<body style="background:#0b0b0c;color:#888;font:14px monospace;display:grid;place-items:center;height:100vh">warming up…</body>`,
    })),
  );

  // A tiny static file server. `detached: true` returns as soon as it starts.
  await sandbox.runCommand({
    cmd: "python3",
    args: ["-m", "http.server", String(PORT), "--directory", root],
    detached: true,
  });

  const base = sandbox.domain(PORT);

  return {
    sandboxName: sandbox.name,
    async deploy(gladiatorId: string, html: string) {
      await sandbox.writeFiles([{ path: `${root}/${gladiatorId}/index.html`, content: html }]);
      return `${base}/${gladiatorId}/`;
    },
  };
}

export type Arena = Awaited<ReturnType<typeof openArena>>;
