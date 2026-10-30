import { extractHtml } from "./prompt";
import type { BattleData, BattleEvent, GladiatorStatus } from "./types";

// One reducer drives both the live arena and the replay player:
// feed it the same events and you get the same fight on screen.

export type GladiatorView = {
  id: string;
  name: string;
  model: string;
  colour: string;
  code: string;
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
  gladiators: GladiatorView[];
  verdict?: BattleData["verdict"];
  replayId?: string;
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
        gladiators: action.data.gladiators.map((g) => ({ ...g, code: "", status: "waiting" })),
      };
    case "delta":
      return update(state, action.data.gladiator, (g) => ({ code: g.code + action.data.text }));
    case "status": {
      const { gladiator, ...rest } = action.data;
      return update(state, gladiator, () => rest);
    }
    case "verdict":
      return { ...state, verdict: action.data };
    case "replay":
      return { ...state, replayId: action.data.id };
  }
}

function update(state: BattleState, id: string, patch: (g: GladiatorView) => Partial<GladiatorView>): BattleState {
  return { ...state, gladiators: state.gladiators.map((g) => (g.id === id ? { ...g, ...patch(g) } : g)) };
}

export function finalHtml(g: GladiatorView) {
  return extractHtml(g.code);
}
