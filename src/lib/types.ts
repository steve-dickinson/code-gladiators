// "deploying" only appears in replays recorded before Stage 6.
export type GladiatorStatus = "waiting" | "writing" | "testing" | "fixing" | "deploying" | "live" | "failed";

export type Score = {
  gladiator: string;
  creativity: number;
  polish: number;
  fidelity: number;
  total: number;
  roast: string;
};

// What a headless browser in the sandbox saw when it played one version of a game.
export type TestReport = {
  round: number;
  passed: boolean; // no errors and something on screen
  errors: string[]; // page errors and console.error messages
  blank: boolean; // nothing drawn and no text
  responsive: boolean; // the page changed after clicks, keys and mouse movement
  ms: number;
  screenshot?: string; // the page after being played, as a JPEG data URL: what the judge sees
  // What the AI tester did and found (absent if it didn't get to test).
  // kind is what it decided the entry is: a game, a tool, a toy, a visual…
  ai?: { moves: string[]; bugs: string[]; summary: string; costUsd: number; kind?: string };
  // Why the AI tester didn't report, when it tried and couldn't finish. Recorded so a
  // replay can tell "the tester found nothing wrong" apart from "the tester never ran".
  aiError?: string;
  // The test browser drew too few frames a second to judge the controls fairly.
  slowBrowser?: boolean;
};

// Every event the battle streams. The same events are recorded to Blob,
// so a replay is just these events played back on a timer.
export type BattleData = {
  battle: {
    id: string;
    challenge: string;
    maxRounds?: number;
    gladiators: { id: string; name: string; model: string; colour: string }[];
    // Present when this battle is a rematch: see src/lib/rematch.ts.
    rematch?: {
      of: string; // the replay id of the battle being rematched
      coached: string[]; // gladiators who were shown their feedback; the rest are the control group
      previous: Record<string, { total: number; rank: number }>; // last time's scores
      feedback: Record<string, string>; // exactly what each coached gladiator was told
    };
  };
  delta: { gladiator: string; text: string };
  status: {
    gladiator: string;
    status: GladiatorStatus;
    round?: number;
    previewUrl?: string;
    error?: string;
    outputTokens?: number;
    costUsd?: number;
    ms?: number;
  };
  test: { gladiator: string } & TestReport;
  verdict: {
    winner: string;
    headline: string;
    scores: Score[];
    sawScreenshots?: boolean;
    // The judge saw the entries as "Entry A" to "Entry D", in a shuffled order, with no
    // model names. Verdicts from before blind judging don't have this.
    blind?: boolean;
  };
  replay: { id: string };
  done: { ok: boolean };
};

// One battle event, e.g. { type: "delta", data: { gladiator: "qwen", text: "<div>" } }
export type BattleEvent = {
  [K in keyof BattleData]: { type: K; data: BattleData[K] };
}[keyof BattleData];

// A recorded event also stores when it happened (ms after the battle started).
export type RecordedEvent = BattleEvent & { t: number };

// While a battle runs, steps stamp events with the wall-clock time instead.
export type StampedEvent = BattleEvent & { at: number };

export type Replay = {
  id: string;
  createdAt: string;
  challenge: string;
  winner?: string;
  rematchOf?: string;
  events: RecordedEvent[];
};
