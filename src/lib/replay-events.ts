import type { BattleData, Replay } from "./types";

// Typed accessors for the events inside a saved replay.

export function battleOf(replay: Replay): BattleData["battle"] | undefined {
  return replay.events.find((e) => e.type === "battle")?.data as BattleData["battle"] | undefined;
}

export function verdictOf(replay: Replay): BattleData["verdict"] | undefined {
  return replay.events.findLast((e) => e.type === "verdict")?.data as BattleData["verdict"] | undefined;
}

export function statusesOf(replay: Replay): BattleData["status"][] {
  return replay.events.flatMap((e) => (e.type === "status" ? [e.data] : []));
}

export function testsOf(replay: Replay, gladiatorId?: string): BattleData["test"][] {
  return replay.events
    .flatMap((e) => (e.type === "test" ? [e.data] : []))
    .filter((t) => gladiatorId === undefined || t.gladiator === gladiatorId);
}

/** True if at least one gladiator produced an entry. */
export function hasEntries(replay: Replay): boolean {
  return statusesOf(replay).some((s) => s.status === "live");
}
