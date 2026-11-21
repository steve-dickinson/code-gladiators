import type { BattleData, BattleEvent, GladiatorStatus, TestReport } from "./types";

// One reducer drives both the live arena and the replay player:
// feed it the same events and you get the same fight on screen.

export type GladiatorView = {
  id: string;
  name: string;
  model: string;
  colour: string;
  versions: string[]; // the code of each round: first draft, then each fix
  round: number; // which version is on screen (1-based)
  code: string; // = versions[round - 1]
  tests: TestReport[]; // what the browser saw, round by round
  status: GladiatorStatus;
  previewUrl?: string;
  error?: string;
  outputTokens?: number;
  costUsd?: number;
  ms?: number;
};

export type BattleState = {
  id?: string;
  challenge?: string;
  maxRounds?: number;
  rematch?: BattleData["battle"]["rematch"];
  gladiators: GladiatorView[];
  verdict?: BattleData["verdict"];
  replayId?: string;
  done?: boolean;
};

export const emptyBattle: BattleState = { gladiators: [] };

export type BattleAction = { type: "reset" } | BattleEvent;

export function battleReducer(state: BattleState, action: BattleAction): BattleState {
  switch (action.type) {
    case "reset":
      return emptyBattle;
    case "battle":
      return {
        id: action.data.id,
        challenge: action.data.challenge,
        maxRounds: action.data.maxRounds,
        rematch: action.data.rematch,
        gladiators: action.data.gladiators.map((g) => ({
          ...g,
          versions: [""],
          round: 1,
          code: "",
          tests: [],
          status: "waiting",
        })),
      };
    case "delta":
      // Code always streams into the newest version.
      return update(state, action.data.gladiator, (g) => {
        const versions = g.versions.with(-1, g.versions.at(-1) + action.data.text);
        return { versions, round: versions.length };
      });
    case "status": {
      const { gladiator, round, ...rest } = action.data;
      return update(state, gladiator, (g) => {
        if (!round) return rest; // replays from before Stage 6 have no rounds
        // A new round starts a new, empty version; a lower round puts an older one back on screen.
        const versions = round > g.versions.length ? [...g.versions, ...Array(round - g.versions.length).fill("")] : g.versions;
        return { ...rest, versions, round };
      });
    }
    case "test": {
      const { gladiator, ...report } = action.data;
      return update(state, gladiator, (g) => ({ tests: [...g.tests, report] }));
    }
    case "verdict":
      return { ...state, verdict: action.data };
    case "replay":
      return { ...state, replayId: action.data.id };
    case "done":
      return { ...state, done: true };
  }
}

function update(state: BattleState, id: string, patch: (g: GladiatorView) => Partial<GladiatorView>): BattleState {
  return {
    ...state,
    gladiators: state.gladiators.map((g) => {
      if (g.id !== id) return g;
      const next = { ...g, ...patch(g) };
      return { ...next, code: next.versions[next.round - 1] ?? "" };
    }),
  };
}
