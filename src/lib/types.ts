/** "deploying" only appears in replays recorded before battles were tested. */
export type GladiatorStatus = "waiting" | "writing" | "testing" | "fixing" | "deploying" | "live" | "failed";

export type Score = {
  gladiator: string;
  creativity: number;
  polish: number;
  fidelity: number;
  total: number;
  roast: string;
};

export type AiTestResult = {
  /** What the tester did, in order. */
  moves: string[];
  bugs: string[];
  summary: string;
  costUsd: number;
  /** What the tester decided the entry is: a game, a tool, a toy, a visual… */
  kind?: string;
  /** The model that did the testing: the first choice, or a fallback. */
  model?: string;
};

/** What happened when one version of an entry was tested in a real browser. */
export type TestReport = {
  round: number;
  /** No errors, something on screen, and no bugs found by the AI tester. */
  passed: boolean;
  /** Uncaught exceptions, console errors and problems the browser test detected. */
  errors: string[];
  /** Nothing drawn and no text. */
  blank: boolean;
  /** The page changed while the browser clicked, typed and pressed keys. */
  responsive: boolean;
  ms: number;
  /** The page after testing, as a JPEG data URL. */
  screenshot?: string;
  ai?: AiTestResult;
  /** Why the AI tester couldn't finish, so a replay can tell "no bugs" from "didn't run". */
  aiError?: string;
  /** The browser drew too few frames a second to judge the controls fairly. */
  slowBrowser?: boolean;
};

export type RematchPlan = {
  /** The replay id of the battle being rematched. */
  of: string;
  /** Gladiators shown their feedback; the rest are the control group. */
  coached: string[];
  previous: Record<string, { total: number; rank: number }>;
  /** Exactly what each coached gladiator was told. */
  feedback: Record<string, string>;
};

/** Every event a battle streams. The same events are saved, so a replay is just these played back. */
export type BattleData = {
  battle: {
    id: string;
    challenge: string;
    maxRounds?: number;
    gladiators: { id: string; name: string; model: string; colour: string }[];
    rematch?: RematchPlan;
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
    /** The judge saw anonymous, shuffled entries. Absent on older verdicts. */
    blind?: boolean;
  };
  replay: { id: string };
  done: { ok: boolean };
};

/** One event, e.g. `{ type: "delta", data: { gladiator: "qwen", text: "<div>" } }`. */
export type BattleEvent = {
  [K in keyof BattleData]: { type: K; data: BattleData[K] };
}[keyof BattleData];

/** A saved event, with when it happened in ms after the battle started. */
export type RecordedEvent = BattleEvent & { t: number };

/** An event while a battle runs, stamped with wall-clock time. */
export type StampedEvent = BattleEvent & { at: number };

export type Replay = {
  id: string;
  createdAt: string;
  challenge: string;
  winner?: string;
  rematchOf?: string;
  events: RecordedEvent[];
};
