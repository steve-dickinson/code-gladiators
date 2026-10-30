import type { UIMessage } from "ai";

export type GladiatorStatus = "waiting" | "writing" | "deploying" | "live" | "failed";

export type Score = {
  gladiator: string;
  creativity: number;
  polish: number;
  fidelity: number;
  total: number;
  roast: string;
};

// Every event the battle route streams. The same events are recorded
// to Blob, so a replay is just these events played back on a timer.
export type BattleData = {
  battle: {
    id: string;
    challenge: string;
    gladiators: { id: string; name: string; model: string; colour: string }[];
  };
  delta: { gladiator: string; text: string };
  status: {
    gladiator: string;
    status: GladiatorStatus;
    previewUrl?: string;
    error?: string;
    outputTokens?: number;
    costUsd?: number;
    ms?: number;
  };
  verdict: { winner: string; headline: string; scores: Score[] };
  replay: { id: string };
};

export type BattleMessage = UIMessage<never, BattleData>;

// One battle event, e.g. { type: "delta", data: { gladiator: "haiku", text: "<div>" } }
export type BattleEvent = {
  [K in keyof BattleData]: { type: K; data: BattleData[K] };
}[keyof BattleData];

// A recorded event also stores when it happened (ms after the battle started).
export type RecordedEvent = BattleEvent & { t: number };

export type Replay = {
  id: string;
  createdAt: string;
  challenge: string;
  winner?: string;
  events: RecordedEvent[];
};
