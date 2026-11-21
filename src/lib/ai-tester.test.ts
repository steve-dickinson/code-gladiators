import { describe, expect, it } from "vitest";
import { findControl, parseMove, planMove } from "./ai-tester";
import type { PageControls } from "./page-scripts";

const calculator: PageControls = {
  text: "0 7 8 9 +",
  controls: [
    { kind: "button", label: "7", x: 400, y: 250 },
    { kind: "button", label: "Clear all", x: 600, y: 250 },
    { kind: "input:text", label: "Amount", x: 300, y: 100 },
  ],
};

describe("parseMove", () => {
  it("reads a well-formed move", () => {
    expect(parseMove('{"move":"click","target":"7"}')).toEqual({ move: "click", target: "7" });
  });

  it("tidies the slips small models make", () => {
    expect(parseMove('{"move":"click","target":"7","x":null,"key":null}')).toEqual({ move: "click", target: "7" });
    expect(parseMove('Sure! ```json\n{"move":"Hold","key":"ArrowRight","ms":"800"}\n```')).toEqual({
      move: "hold",
      key: "ArrowRight",
      ms: 800,
    });
    expect(parseMove('{"move":"click","target":7,"x":"420"}')).toEqual({ move: "click", target: "7", x: 420 });
    expect(parseMove('{"move":"finish","bugs":["Clear does nothing"]}')).toEqual({ move: "finish", bugs: [{ what: "Clear does nothing" }] });
  });

  it("rejects replies that aren't a move", () => {
    expect(parseMove("no json here")).toBeUndefined();
    expect(parseMove('{"move":"dance"}')).toBeUndefined();
  });
});

describe("findControl", () => {
  it("prefers an exact label, then a partial one", () => {
    expect(findControl(calculator, "7")?.x).toBe(400);
    expect(findControl(calculator, "clear")?.label).toBe("Clear all");
    expect(findControl(calculator, "Missing")).toBeUndefined();
    expect(findControl(calculator, "")).toBeUndefined();
  });
});

describe("planMove", () => {
  it("clicks a control by its label", () => {
    expect(planMove({ move: "click", target: "7" }, calculator)).toEqual({
      commands: ["mouse move 400 250", "mouse down", "mouse up"],
      description: 'clicked "7"',
    });
  });

  it("clicks at coordinates, kept inside the window", () => {
    expect(planMove({ move: "click", x: 5000, y: -10 }, calculator)).toEqual({
      commands: ["mouse move 959 0", "mouse down", "mouse up"],
      description: "clicked at (959, 0)",
    });
  });

  it("types into a named field", () => {
    expect(planMove({ move: "type", target: "Amount", text: "50" }, calculator)).toEqual({
      commands: ["mouse move 300 100", "mouse down", "mouse up", "keyboard type 50"],
      description: 'typed "50" into "Amount"',
    });
  });

  it("holds a key for a bounded time", () => {
    expect(planMove({ move: "hold", key: "arrowright", ms: 99_999 }, calculator)).toEqual({
      commands: ["keydown ArrowRight", "wait 1500", "keyup ArrowRight"],
      description: "held ArrowRight for 1500 ms",
    });
  });

  it("explains moves it can't carry out", () => {
    expect(planMove({ move: "click", target: "Missing" }, calculator)).toEqual({ skipped: '(tried to click "Missing", which isn\'t on the page)' });
    expect(planMove({ move: "press", key: "F13" }, calculator)).toEqual({ skipped: "(asked for a key it can't use: F13)" });
    expect(planMove({ move: "type", text: "  " }, calculator)).toEqual({ skipped: "(tried to type nothing)" });
  });
});
