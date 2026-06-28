// ============================================================
//  Format registry — the two independent axes every golf format
//  decomposes into:
//    scoring  = how holes become points + how the board renders
//    format   = who's on a side + ball rules (drives side size)
//
//  Adding a scoring method or a team format is a data edit here
//  (+ one case in lib/scoring.js for a brand-new scoring), not a
//  rewrite of the wizard, board, or pairing screens.
// ============================================================

export const SCORINGS = {
  match: { side_default: true },
  stroke: {},
};

export const FORMATS = {
  singles: { side: 1 },
  scramble: { side: 2 },
};

// Combos that are NOT allowed (greyed in the UI). Empty = everything goes.
// e.g. "stroke:singles": "Individual medal play isn't supported yet"
export const INVALID_COMBOS = {};

export function comboOk(scoring, format) {
  if (!SCORINGS[scoring] || !FORMATS[format]) return false;
  return !INVALID_COMBOS[`${scoring}:${format}`];
}

export function sideSize(format) {
  return FORMATS[format]?.side || 1;
}

// matches.kind only encodes side size (1 = 'singles', 2+ = 'scramble').
export function matchKind(format) {
  return sideSize(format) === 1 ? "singles" : "scramble";
}

// Normalize a raw day config from the client into { scoring, format }.
// Also understands the legacy single-field encoding (scramble_stroke).
export function normalizeDay(d = {}) {
  let { scoring, format } = d;

  // Legacy: a single `format` field carried scoring + team format together.
  if (!scoring) {
    if (format === "scramble_stroke") { scoring = "stroke"; format = "scramble"; }
    else scoring = "match";
  }

  scoring = SCORINGS[scoring] ? scoring : "match";
  format = FORMATS[format] ? format : "singles";
  if (!comboOk(scoring, format)) { scoring = "match"; format = "singles"; }
  return { scoring, format };
}
