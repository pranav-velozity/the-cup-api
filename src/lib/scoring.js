// Client copy of the scoring engine. Mirrors the server's lib/scoring.js
// exactly so optimistic UI and the authoritative board never disagree.

export function mscore(holes) {
  let a = 0, b = 0, played = 0;
  for (const x of holes || []) {
    if (x === "A") { a++; played++; }
    else if (x === "B") { b++; played++; }
    else if (x === "T") { played++; }
  }
  return { a, b, played, rem: 18 - played };
}

export function matchDone(s, playAll) {
  if (s.rem === 0) return true;
  if (playAll) return false;
  return Math.abs(s.a - s.b) > s.rem;
}

export function matchStatus(s, playAll) {
  if (matchDone(s, playAll)) return "final";
  if (s.a === s.b) return "tied";
  if (Math.abs(s.a - s.b) === 1) return "tight";
  return "ahead";
}

export function streak(holes) {
  let run = null, n = 0;
  for (const x of holes || []) {
    if (x === "A" || x === "B") {
      if (x === run) n++;
      else { run = x; n = 1; }
      if (n >= 3) return run;
    }
  }
  return null;
}
