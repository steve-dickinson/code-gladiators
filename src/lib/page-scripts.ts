// JavaScript run inside the entry's page by agent-browser's `eval` command.

/** What's on screen: canvases (and whether they're drawn on), visible elements, text, and a fingerprint for spotting change. */
export type PageProbe = {
  canvases: number;
  /** Canvases with a real size on the page. */
  shown: number;
  /** The largest canvas, as a fraction of the window. */
  biggest: number;
  /** Canvases with more than one colour on them. */
  painted: number;
  visible: number;
  text: number;
  signature: string;
};

export const PROBE = `(() => {
  const canvases = [...document.querySelectorAll("canvas")];
  let painted = 0, shown = 0, biggest = 0, signature = "";
  for (const c of canvases) {
    const r = c.getBoundingClientRect();
    if (r.width >= 4 && r.height >= 4) shown++;
    biggest = Math.max(biggest, (r.width * r.height) / (innerWidth * innerHeight));
    let url = ""; try { url = c.toDataURL("image/png"); } catch {}
    signature += url.length + url.slice(-40);
    try {
      const g = c.getContext("2d");
      if (g && c.width && c.height) {
        const d = g.getImageData(0, 0, c.width, c.height).data;
        const first = d.slice(0, 4).join();
        let differing = 0;
        for (let i = 0; i < d.length && differing < 2; i += 4 * 13) if (d.slice(i, i + 4).join() !== first) differing++;
        if (differing >= 2) painted++;
      } else if (url.length > 3000) painted++; // a WebGL canvas with something on it
    } catch {}
  }
  const elements = [...(document.body?.querySelectorAll("*") ?? [])];
  const visible = elements.filter((e) => { const r = e.getBoundingClientRect(); return r.width > 4 && r.height > 4; }).length;
  const text = (document.body?.innerText ?? "").trim().length;
  signature += "|" + (document.body?.innerHTML.length ?? 0) + "|" + text;
  return { canvases: canvases.length, shown, biggest, painted, visible, text, signature };
})()`;

/** Clicks the page's own Start or Play button, if it has one, and returns its label. */
export const CLICK_START = `(() => {
  const isVisible = (e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 4 && r.height > 4 && s.visibility !== "hidden" && s.display !== "none"; };
  const label = (e) => ((e.textContent || e.value || "") + " " + (e.id || "")).trim();
  const words = /start|play|begin|insert coin|new game|race|launch|\\bgo\\b/i;
  const button = [...document.querySelectorAll("button, [role=button], input[type=button], input[type=submit], a")].find((e) => isVisible(e) && words.test(label(e)));
  if (!button) return "";
  button.click();
  return label(button).slice(0, 40);
})()`;

/** Animation frames per second, measured over half a second. */
export const FRAME_RATE = `new Promise((done) => {
  let frames = 0;
  const start = performance.now();
  (function tick() { frames++; if (performance.now() - start < 500) requestAnimationFrame(tick); else done(frames * 2); })();
})`;

/** The page's text and its controls, each with a label and the centre of where it sits. */
export type PageControls = { text: string; controls: { kind: string; label: string; x: number; y: number }[] };

export const CONTROLS = `(() => {
  const isVisible = (e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 2 && r.height > 2 && r.bottom > 0 && r.top < innerHeight && s.visibility !== "hidden"; };
  const label = (e) => (e.getAttribute("aria-label") || e.innerText || e.value || e.placeholder || e.title || e.name || e.id || "").replace(/\\s+/g, " ").trim().slice(0, 40);
  const elements = [...document.querySelectorAll("button, a[href], input, textarea, select, [role=button], [onclick], [contenteditable=true]")].filter(isVisible).slice(0, 30);
  return {
    text: (document.body?.innerText ?? "").replace(/\\s+/g, " ").trim().slice(0, 500),
    controls: elements.map((e) => { const r = e.getBoundingClientRect(); return { kind: e.tagName.toLowerCase() + (e.type ? ":" + e.type : ""), label: label(e), x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; }),
  };
})()`;

/** An agent-browser command that evaluates `script` in the page (base64 avoids quoting problems). */
export const evalCommand = (script: string) => `eval -b ${Buffer.from(script).toString("base64")}`;
