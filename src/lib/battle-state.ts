import type { BattleData, BattleEvent, GladiatorStatus, TestReport } from "./types";

// One reducer drives both the live arena and the replay player: the same events give
// the same battle on screen.

export type GladiatorView = {
  id: string;
  name: string;
  model: string;
  colour: string;
  /** The code of each round: the first draft, then each fix. */
  versions: string[];
  /** The version on screen, starting at 1. */
  round: number;
  /** The code of the version on screen. */
  code: string;
  tests: TestReport[];
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
        gladiators: action.data.gladiators.map((g) => ({ ...g, versions: [""], round: 1, code: "", tests: [], status: "waiting" })),
      };
    case "delta":
      // Code always streams into the newest version.
      return updateGladiator(state, action.data.gladiator, (g) => {
        const versions = g.versions.with(-1, g.versions.at(-1) + action.data.text);
        return { versions, round: versions.length };
      });
    case "status": {
      const { gladiator, round, ...rest } = action.data;
      return updateGladiator(state, gladiator, (g) => {
        if (!round) return rest; // older replays have no rounds
        // A new round starts an empty version; an earlier round puts that version back on screen.
        const versions = round > g.versions.length ? [...g.versions, ...Array(round - g.versions.length).fill("")] : g.versions;
        return { ...rest, versions, round };
      });
    }
    case "test": {
      const { gladiator, ...report } = action.data;
      return updateGladiator(state, gladiator, (g) => ({ tests: [...g.tests, report] }));
    }
    case "verdict":
      return { ...state, verdict: action.data };
    case "replay":
      return { ...state, replayId: action.data.id };
    case "done":
      return { ...state, done: true };
  }
}

function updateGladiator(state: BattleState, id: string, patch: (g: GladiatorView) => Partial<GladiatorView>): BattleState {
  return {
    ...state,
    gladiators: state.gladiators.map((g) => {
      if (g.id !== id) return g;
      const next = { ...g, ...patch(g) };
      return { ...next, code: next.versions[next.round - 1] ?? "" };
    }),
  };
}
