// ============================================================
//  THE CUP / TOTO — shared scoring engine
//
//  Pure functions, no I/O. This is the SINGLE SOURCE OF TRUTH for
//  how holes turn into match status and team points. The frontend
//  ships the same logic for optimistic UI; the server recomputes
//  authoritatively here so the two can never drift.
//
//  Scoring is per hole: each hole is won by 'A', 'B', or halved 'T'.
//  A team's points = (holes it won) x (that day's points_per_hole).
// ============================================================

// Turn a sparse list of hole_results rows into an 18-length array
// of 'A' | 'B' | 'T' | null (null = not yet played).
export function holesArray(rows) {
  const arr = new Array(18).fill(null);
  for (const r of rows || []) {
    const h = Number(r.hole);
    if (h >= 1 && h <= 18 && ["A", "B", "T"].includes(r.result)) {
      arr[h - 1] = r.result;
    }
  }
  return arr;
}

// Count a single match from its 18-array.
export function mscore(holes) {
  let a = 0, b = 0, played = 0;
  for (const x of holes || []) {
    if (x === "A") { a++; played++; }
    else if (x === "B") { b++; played++; }
    else if (x === "T") { played++; }
  }
  return { a, b, played, rem: 18 - played };
}

// A match is settled when all 18 are in, OR (match-play only) the lead
// is bigger than the holes remaining. playAll=true => only at 18.
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

// Is this match in the middle of being played (started, not settled)?
export function isLive(s, playAll) {
  return s.played > 0 && !matchDone(s, playAll);
}

// 3-in-a-row streak for the HOT chip. Returns 'A' | 'B' | null.
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

export function matchNames(match, namesById, teamAName, teamBName) {
  const nm = (ids) =>
    (ids || [])
      .map((id) => namesById[id])
      .filter(Boolean)
      .join(" & ");
  return [nm(match.side_a) || teamAName, nm(match.side_b) || teamBName];
}

// ------------------------------------------------------------
//  deriveBoard — assemble the full board snapshot the client renders.
//
//  input = {
//    tournament: { team_a_name, team_a_color, team_b_name, team_b_color },
//    days:    [{ day_index, format, points_per_hole, play_all }],
//    matches: [{ id, day_index, kind, label, ordinal, side_a, side_b }],
//    holesByMatch: { [matchId]: [{ hole, result }] },
//    namesById: { [rosterEntryId]: name },
//    events:  [{ text, dot, match_id, created_at }]  // newest first, optional
//  }
// ------------------------------------------------------------
// Stroke-differential days: each pair records per-hole strokes; a team's day
// total is the SUM of its pairs' strokes. The lower team wins the difference
// as points, but only LOCKS into the cup total when the day is complete.
const STROKE_FMT = "scramble_stroke";

export function deriveBoard(input) {
  const { tournament: t, days = [], matches = [], holesByMatch = {}, namesById = {}, events = [] } = input;
  const dayByIndex = {};
  for (const d of days) dayByIndex[d.day_index] = d;

  let A = 0, B = 0, holesPlayed = 0, liveCount = 0;
  const matchOut = [];
  const strokeByDay = {}; // day_index -> [{ m, day }]

  for (const m of matches) {
    const day = dayByIndex[m.day_index] || { points_per_hole: 1, play_all: true, format: m.kind };

    // Stroke-diff matches are scored at the team/day level, not as tiles.
    if ((day.format || m.kind) === STROKE_FMT) {
      (strokeByDay[m.day_index] ||= []).push({ m, day });
      continue;
    }

    // ---- match-play path (singles + classic scramble) — UNCHANGED ----
    const pph = Number(day.points_per_hole) || 1;
    const playAll = day.play_all !== false;
    const holes = holesArray(holesByMatch[m.id]);
    const s = mscore(holes);

    A += s.a * pph;
    B += s.b * pph;
    holesPlayed += s.played;
    if (isLive(s, playAll)) liveCount++;

    const [nameA, nameB] = matchNames(m, namesById, t.team_a_name, t.team_b_name);
    matchOut.push({
      id: m.id,
      dayIndex: m.day_index,
      format: day.format || m.kind,
      pph,
      playAll,
      label: m.label,
      ordinal: m.ordinal,
      nameA,
      nameB,
      a: s.a,
      b: s.b,
      played: s.played,
      rem: s.rem,
      pointsA: s.a * pph,
      pointsB: s.b * pph,
      status: matchStatus(s, playAll),
      done: matchDone(s, playAll),
      hot: streak(holes),
      holes,
    });
  }

  // Live (un-settled) matches first, ordered by holes-through desc; settled last.
  matchOut.sort((x, y) => {
    const xf = x.done ? 1 : 0, yf = y.done ? 1 : 0;
    return xf - yf || y.played - x.played;
  });

  // ---- stroke-diff days ----
  const strokeDays = [];
  for (const dayIndex of Object.keys(strokeByDay).map(Number).sort((a, b) => a - b)) {
    const entries = strokeByDay[dayIndex];
    let teamATotal = 0, teamBTotal = 0, aThru = 0, bThru = 0;
    let allComplete = true, anyPlayed = false, dayHolesPlayed = 0;
    const pairs = [];

    for (const { m } of entries) {
      const byHole = {};
      for (const r of holesByMatch[m.id] || []) byHole[Number(r.hole)] = r;
      let aTot = 0, aN = 0, bTot = 0, bN = 0;
      const holesA = new Array(18).fill(null), holesB = new Array(18).fill(null);
      for (let h = 1; h <= 18; h++) {
        const r = byHole[h];
        if (r && r.strokes_a != null) { holesA[h - 1] = Number(r.strokes_a); aTot += Number(r.strokes_a); aN++; }
        if (r && r.strokes_b != null) { holesB[h - 1] = Number(r.strokes_b); bTot += Number(r.strokes_b); bN++; }
      }
      if (aN < 18 || bN < 18) allComplete = false;
      if (aN > 0 || bN > 0) anyPlayed = true;
      teamATotal += aTot; teamBTotal += bTot;
      aThru += aN; bThru += bN;
      dayHolesPlayed += Math.max(aN, bN);

      const [nameA, nameB] = matchNames(m, namesById, t.team_a_name, t.team_b_name);
      pairs.push({ matchId: m.id, side: "A", name: nameA, total: aTot, thru: aN, holes: holesA });
      pairs.push({ matchId: m.id, side: "B", name: nameB, total: bTot, thru: bN, holes: holesB });
    }

    // Best (lowest score) on top; pairs with no holes yet sink to the bottom.
    pairs.sort((x, y) => (x.thru === 0 ? 1 : 0) - (y.thru === 0 ? 1 : 0) || x.total - y.total);

    const diff = Math.abs(teamATotal - teamBTotal);
    const leader = teamATotal === teamBTotal ? null : teamATotal < teamBTotal ? "A" : "B";
    const locked = entries.length > 0 && allComplete;

    holesPlayed += dayHolesPlayed;
    if (anyPlayed && !locked) liveCount++;

    // Only a LOCKED day moves the cup total.
    if (locked && leader === "A") A += diff;
    else if (locked && leader === "B") B += diff;

    strokeDays.push({
      dayIndex,
      format: STROKE_FMT,
      teamATotal,
      teamBTotal,
      aThru,
      bThru,
      diff,
      leader,         // 'A' | 'B' | null  (lower total = leader)
      locked,
      provisional: anyPlayed && !locked,
      pairs,
    });
  }

  const totalMatches = matches.length;
  const holesLeft = Math.max(0, totalMatches * 18 - holesPlayed);

  // Last-9 momentum strip: most recent hole winners, oldest->newest.
  const last9 = (events || [])
    .slice(0, 9)
    .reverse()
    .map((e) => (e.dot ? (e.dot === t.team_a_color ? "A" : e.dot === t.team_b_color ? "B" : "T") : "T"));

  const tot = A + B;
  const aShare = tot === 0 ? 50 : Math.round((A / tot) * 100);

  return {
    teamA: { name: t.team_a_name, color: t.team_a_color, emoji: t.team_a_emoji, kind: t.team_a_kind, logoUrl: t.team_a_logo_url, points: A },
    teamB: { name: t.team_b_name, color: t.team_b_color, emoji: t.team_b_emoji, kind: t.team_b_kind, logoUrl: t.team_b_logo_url, points: B },
    holesPlayed,
    holesLeft,
    totalMatches,
    aShare,
    live: liveCount > 0,
    leadText:
      A > B ? `${t.team_a_name} lead by ${A - B}`
        : B > A ? `${t.team_b_name} lead by ${B - A}`
        : "All square",
    last9,
    matches: matchOut,
    strokeDays,
  };
}
