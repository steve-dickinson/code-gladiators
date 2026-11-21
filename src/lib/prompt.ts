import type { TestReport } from "./types";

export const GLADIATOR_SYSTEM = `You are a gladiator in Code Gladiators, a live arena where AI models race to build the same thing.

Build exactly what the challenge asks as ONE self-contained HTML file.
Rules:
- Output only the HTML document, starting with <!DOCTYPE html>. No explanations, no markdown fences.
- All CSS and JavaScript inline. No external scripts, fonts, images or network requests: your code runs in a sandbox with the internet switched off.
- Never embed fonts, images, audio or any other file as base64 or a data: URI. Use system fonts, and draw everything with CSS, SVG or canvas.
- It must work at any size from 360px to 1200px wide, and on touch as well as keyboard where it makes sense.
- Make it delightful: a judge scores creativity, polish and how faithfully you followed the challenge.
- Keep it under 400 lines. Finish the file: an unfinished file scores zero.`;

/** The challenge, plus last time's feedback for a coached gladiator in a rematch. */
export function gladiatorPrompt(challenge: string, feedback?: string): string {
  return feedback ? `Challenge: ${challenge}\n\n${feedback}` : `Challenge: ${challenge}`;
}

/** Everything the testers found, for the gladiator to fix. */
export function fixPrompt(report: TestReport): string {
  const problems = [
    ...report.errors,
    ...(report.blank ? ["The screen stayed empty: nothing was drawn and no text appeared."] : []),
    ...(report.ai?.bugs ?? []).map((bug) => `An AI tester found: ${bug}`),
  ];
  const moves = report.ai?.moves.length ? `\nWhat the AI tester did:\n${bulleted(report.ai.moves)}\n` : "";
  return `A headless browser just loaded your page, pressed any Start button, pressed keys and moved the mouse. Then an AI tester used it for what the challenge asked. They found these problems:
${bulleted(problems)}
${moves}
Fix them. Keep everything that already works. Output the complete corrected HTML file, starting with <!DOCTYPE html>, and nothing else.`;
}

const bulleted = (lines: string[]) => lines.map((line) => `- ${line}`).join("\n");

/**
 * Pulls the HTML document out of a model's reply, which may wrap it in a code fence,
 * add chat around it, or leave a stray closing fence after a bare document.
 */
export function extractHtml(reply: string): string {
  const start = reply.search(/<!doctype html|<html[\s>]/i);
  if (start >= 0) {
    const end = reply.toLowerCase().lastIndexOf("</html>");
    const html = end > start ? reply.slice(start, end + "</html>".length) : reply.slice(start).replace(/`{3,}\s*$/, "");
    return html.trim();
  }
  const fenced = reply.match(/```(?:html)?\s*([\s\S]*?)(?:```|$)/i);
  return (fenced?.[1] ?? reply).trim();
}
