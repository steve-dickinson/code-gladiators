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
};

// Every event the battle streams. The same events are recorded to Blob,
// so a replay is just these events played back on a timer.
export type BattleData = {
  battle: {
    id: string;
    challenge: string;
    maxRounds?: number;
    gladiators: { id: string; name: string; model: string; colour: string }[];
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
  verdict: { winner: string; headline: string; scores: Score[] };
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
  events: RecordedEvent[];
};
