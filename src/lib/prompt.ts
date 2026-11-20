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

export function gladiatorPrompt(challenge: string) {
  return `Challenge: ${challenge}`;
}

// After a failed playtest, the gladiator sees exactly what the browser saw.
export function fixPrompt(report: TestReport) {
  const problems = [
    ...report.errors.map((e) => `- ${e}`),
    ...(report.blank ? ["- The screen stayed empty: nothing was drawn and no text appeared."] : []),
  ].join("\n");
  return `A headless browser just played your file. It loaded the page, clicked, pressed Space, Enter and the arrow keys, typed, and moved the mouse. It found these problems:
${problems}

Fix them. Keep everything that already works. Output the complete corrected HTML file, starting with <!DOCTYPE html>, and nothing else.`;
}

// Models sometimes wrap their answer in ``` fences or add chatter. Pull out the HTML.
export function extractHtml(raw: string): string {
  const fenced = raw.match(/```(?:html)?\s*([\s\S]*?)(?:```|$)/i);
  const body = fenced ? fenced[1] : raw;
  const start = body.search(/<!doctype html|<html/i);
  const html = start >= 0 ? body.slice(start) : body;
  const end = html.toLowerCase().lastIndexOf("</html>");
  return (end >= 0 ? html.slice(0, end + 7) : html).trim();
}
