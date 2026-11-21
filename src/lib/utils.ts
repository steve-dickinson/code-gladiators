/** A readable message from anything thrown, with terminal colour codes removed. */
export function errorMessage(err: unknown, maxLength = 200): string {
  const message = err instanceof Error ? err.message : String(err);
  return message.replace(/\u001b\[\d+m/g, "").slice(0, maxLength);
}

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** A shuffled copy of `items`, using a cryptographically random sort key. */
export function shuffle<T>(items: readonly T[]): T[] {
  return items
    .map((item) => ({ item, key: crypto.getRandomValues(new Uint32Array(1))[0] }))
    .sort((a, b) => a.key - b.key)
    .map(({ item }) => item);
}

export function roundTo(n: number, decimals = 1): number {
  const factor = 10 ** decimals;
  return Math.round(n * factor) / factor;
}

export function mean(values: number[]): number | undefined {
  return values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : undefined;
}

export function median(values: number[]): number | undefined {
  if (!values.length) return undefined;
  const sorted = values.toSorted((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** 1 → "1st", 2 → "2nd", 11 → "11th", 23 → "23rd". */
export function ordinal(n: number): string {
  const lastTwo = n % 100;
  if (lastTwo >= 11 && lastTwo <= 13) return `${n}th`;
  return `${n}${{ 1: "st", 2: "nd", 3: "rd" }[n % 10] ?? "th"}`;
}

/** Strips a `data:<type>;base64,` prefix, leaving the base64 payload. */
export const base64Of = (dataUrl: string) => dataUrl.replace(/^data:[^,]+,/, "");
