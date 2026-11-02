// Cascading L1-L8 dropdowns: each level offers only the values that actually
// occur, in some catalogue row, alongside the levels already chosen on the row
// being edited.
//
// The source is the catalogue itself, not the GMD Category sheet: that sheet
// holds one independent list per column (its columns have 11 to 695 values and
// its rows pair unrelated things), so it carries no combination data at all.
// This follows getTradingValveOptionsAction, which narrows the same way for
// L8 = TRADING VALVE; here it is every row's own L8.

export const L_HEADERS = [
  "L1",
  "L2-VALVE TYPE",
  "L3-DIA",
  "L4-COMPONENT",
  "L5- MATERIAL",
  "L6-STD",
  "L7-DIMENSION",
  "L8 -ITEM CATEGORY",
] as const;

export type LCascade = (row: unknown[], header: string) => string[] | undefined;

const cell = (row: unknown[], idx: number): string =>
  idx === -1 ? "" : String(row[idx] ?? "").trim();

/**
 * Builds the cascade for a catalogue. `fullOptions` is the unnarrowed list per
 * header (the sheet's own lists), used whenever narrowing would leave nothing
 * to pick from.
 *
 * Returns undefined for a non-L header so the caller falls through to its
 * normal options.
 */
export function buildLCascade(
  catalogue: unknown[][],
  headers: string[],
  fullOptions: Record<string, string[]> = {},
): LCascade {
  const idx = L_HEADERS.map((h) => headers.indexOf(h));
  // One compact tuple per catalogue row, in L_HEADERS order.
  const combos: string[][] = catalogue.map((row) => idx.map((i) => cell(row, i)));
  const cache = new Map<string, string[]>();

  return (row, header) => {
    const level = L_HEADERS.indexOf(header as (typeof L_HEADERS)[number]);
    if (level === -1) return undefined;

    const chosen = idx.map((i) => cell(row, i));
    // Every other level that is already filled in is a constraint.
    const constraints = chosen
      .map((v, i) => [i, v] as const)
      .filter(([i, v]) => i !== level && v !== "");

    const key = `${level}\u0000${constraints.map(([i, v]) => `${i}=${v}`).join("\u0001")}`;
    const hit = cache.get(key);
    if (hit) return hit;

    const values = new Set<string>();
    for (const combo of combos) {
      let ok = true;
      for (const [i, v] of constraints) {
        if (combo[i] !== v) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      const v = combo[level];
      if (v) values.add(v);
    }

    // Nothing in the catalogue matches this combination - it is a genuinely new
    // item. Never leave the editor with an empty list.
    const out =
      values.size === 0
        ? (fullOptions[header] ?? [])
        : [...values].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    cache.set(key, out);
    return out;
  };
}
