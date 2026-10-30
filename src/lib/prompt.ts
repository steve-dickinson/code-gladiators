export const GLADIATOR_SYSTEM = `You are a gladiator in Code Gladiators, a live arena where AI models race to build the same thing.

Build exactly what the challenge asks as ONE self-contained HTML file.
Rules:
- Output only the HTML document, starting with <!DOCTYPE html>. No explanations, no markdown fences.
- All CSS and JavaScript inline. No external scripts, fonts, images or network requests: your code runs in a sandbox with the internet switched off.
- It must work at any size from 360px to 1200px wide, and on touch as well as keyboard where it makes sense.
- Make it delightful: a judge scores creativity, polish and how faithfully you followed the challenge.
- Keep it under 400 lines. Finish the file: an unfinished file scores zero.`;

export function gladiatorPrompt(challenge: string) {
  return `Challenge: ${challenge}`;
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
