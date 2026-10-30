# Code Gladiators

One challenge. Four AI models. Each writes a game from scratch, live, and runs it in its own locked-down Vercel Sandbox. Then an AI judge picks the winner, and the whole fight is saved as a free-to-watch replay.

Built on Vercel: AI SDK 7, AI Gateway, Sandbox, Blob, BotID and Fluid compute.

## Run it

```bash
npm install
vercel link            # connect to your Vercel project
vercel env pull        # downloads VERCEL_OIDC_TOKEN (+ Blob token once connected)
echo "ARENA_KEY=$(openssl rand -hex 16)" >> .env.local
npm run check-models   # which gladiators can your account call, and what do they cost?
npm run dev
```

## Where things live

| File | What it does |
| --- | --- |
| `src/lib/gladiators.ts` | The models, the judge, and the cost limits. Edit this first. |
| `src/app/api/battle/route.ts` | Streams four models in parallel, deploys to Sandbox, judges, records the replay. |
| `src/lib/arena.ts` | One Sandbox microVM per battle, internet switched off, serving each entry. |
| `src/lib/judge.ts` | Structured scoring with `Output.object` and an AI Gateway fallback model. |
| `src/lib/replays.ts` | Saves and loads replays in Vercel Blob. |
| `src/lib/battle-state.ts` | One reducer for both live battles and replays. |
| `src/components/` | The arena UI, the live controls and the replay player. |
