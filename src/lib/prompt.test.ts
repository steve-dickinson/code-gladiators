import { describe, expect, it } from "vitest";
import { testReport } from "@/test/replay-fixtures";
import { extractHtml, fixPrompt, gladiatorPrompt } from "./prompt";

const page = '<!DOCTYPE html>\n<html lang="en"><body><p>hi</p></body>\n</html>';

describe("extractHtml", () => {
  it.each([
    ["a bare page", page],
    ["a page in a code fence", "```html\n" + page + "\n```"],
    ["a fenced page with chat around it", "Here you go!\n\n```html\n" + page + "\n```\nEnjoy."],
    ["a bare page followed by a stray closing fence", page + "\n```"],
  ])("returns the document from %s", (_, reply) => {
    expect(extractHtml(reply)).toBe(page);
  });

  it("keeps an unfinished page, without a trailing fence", () => {
    expect(extractHtml("<!DOCTYPE html><html><body>cut off\n```")).toBe("<!DOCTYPE html><html><body>cut off");
  });

  it("falls back to the reply when there's no document", () => {
    expect(extractHtml("Sorry, I can't do that.")).toBe("Sorry, I can't do that.");
    expect(extractHtml("")).toBe("");
  });
});

describe("gladiatorPrompt", () => {
  it("adds rematch feedback only when given", () => {
    expect(gladiatorPrompt("Snake")).toBe("Challenge: Snake");
    expect(gladiatorPrompt("Snake", "You came 2nd.")).toBe("Challenge: Snake\n\nYou came 2nd.");
  });
});

describe("fixPrompt", () => {
  it("lists every problem the testers found", () => {
    const prompt = fixPrompt(
      testReport({
        passed: false,
        errors: ["TypeError: x is null"],
        blank: true,
        ai: { moves: ["pressed Space"], bugs: ["Space does nothing"], summary: "", costUsd: 0 },
      }),
    );
    expect(prompt).toContain("- TypeError: x is null");
    expect(prompt).toContain("- The screen stayed empty");
    expect(prompt).toContain("- An AI tester found: Space does nothing");
    expect(prompt).toContain("What the AI tester did:\n- pressed Space");
  });
});
