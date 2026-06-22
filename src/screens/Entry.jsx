import { useEffect, useState, useCallback, useRef } from "react";
import { useApi, useScoreApi } from "../api.js";
import { useNav } from "../store.jsx";
import { Bar, Avatar, Spinner } from "../components.jsx";
import { mscore } from "../lib/scoring.js";
import { enqueue, flush, pendingCount } from "../lib/outbox.js";
import { T } from "../theme.js";

export default function Entry() {
  const api = useApi();
  const score = useScoreApi();
  const { code, entry, back } = useNav();
  const [board, setBoard] = useState(null);
  const [holes, setHoles] = useState(null);
  const [sel, setSel] = useState(entry?.hole ?? 0);
  const [pending, setPending] = useState(0);
  const [online, setOnline] = useState(navigator.onLine);
  const [caddi, setCaddi] = useState(false);
  const timelineRef = useRef(null);

  const matchId = entry?.matchId;

  const loadBoard = useCallback(async () => {
    try {
      const b = await api(`/api/score/${code}/board`);
      setBoard(b);
      const m = b.matches.find((x) => x.id === matchId);
      if (m && holes === null) setHoles(m.holes.slice());
    } catch { /* offline: keep local */ }
  }, [api, code, matchId, holes]);

  useEffect(() => { loadBoard(); }, [loadBoard]);

  // Drain the outbox when we (re)gain connectivity.
  const trySync = useCallback(async () => {
    try {
      await flush(score.batch);
      setPending(await pendingCount());
      loadBoard();
    } catch { setPending(await pendingCount()); }
  }, [score, loadBoard]);

  useEffect(() => {
    const on = () => { setOnline(true); trySync(); };
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    pendingCount().then(setPending);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, [trySync]);

  useEffect(() => {
    if (timelineRef.current) {
      const el = timelineRef.current.children[sel];
      el?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
    }
  }, [sel]);

  if (!board || holes === null) return (<div className="screen"><Bar title="Board" onBack={back} /><Spinner /></div>);

  const m = board.matches.find((x) => x.id === matchId);
  if (!m) return (<div className="screen"><Bar title="Board" onBack={back} /><div className="pad"><div className="ban err">Match not found.</div></div></div>);

  const A = board.teamA, B = board.teamB;
  const s = mscore(holes);

  // Optimistic team totals: latest board, with THIS match's local score swapped in.
  let totA = 0, totB = 0;
  for (const mm of board.matches) {
    if (mm.id === matchId) { totA += s.a * m.pph; totB += s.b * m.pph; }
    else { totA += mm.pointsA; totB += mm.pointsB; }
  }

  const tap = async (r) => {
    const next = holes.slice();
    next[sel] = next[sel] === r ? null : r;
    setHoles(next);
    if (next[sel] && sel < 17) setSel(sel + 1);

    const clientTs = new Date().toISOString();
    await enqueue({ matchId, hole: sel + 1, result: next[sel], clientTs });
    setPending(await pendingCount());
    if (navigator.onLine) trySync();
  };

  const cellBg = (r) => r === "A" ? A.color : r === "B" ? B.color : r === "T" ? T.tie : "#fff";

  return (
    <div className="screen" style={{ position: "relative" }}>
      <Bar title="Board" onBack={back} />
      <div className="pad">
        <div className="muted" style={{ fontSize: 12, fontWeight: 600 }}>
          Day {m.dayIndex + 1} · {m.format === "scramble" ? "Scramble" : "Singles"} · Match {m.ordinal || ""}
          {m.pph > 1 ? ` · ${m.pph} pts/hole` : ""}
        </div>

        {!online && <div className="offline" style={{ marginTop: 10 }}>📡 Offline — scores are saved on your phone and will sync when you're back. {pending} waiting.</div>}
        {online && pending > 0 && <div className="offline" style={{ marginTop: 10 }}>Syncing {pending}…</div>}

        <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "12px 0 6px" }}>
          <Avatar team={{ name: A.name, color: A.color }} size={40} />
          <div style={{ flex: 1, fontWeight: 700, color: A.color }}>{m.nameA}</div>
          <div style={{ fontWeight: 800, fontSize: 30 }}>{s.a}–{s.b}</div>
          <div style={{ flex: 1, textAlign: "right", fontWeight: 700, color: B.color }}>{m.nameB}</div>
          <Avatar team={{ name: B.name, color: B.color }} size={40} />
        </div>
        <div className="muted" style={{ textAlign: "center", fontSize: 12 }}>holes won</div>

        <div className="timeline" ref={timelineRef}>
          {holes.map((r, i) => (
            <div key={i} className={`cell${i === sel ? " sel" : ""}`} onClick={() => setSel(i)}
              style={{ background: cellBg(r), color: r ? "#fff" : "#c2c8ba", borderColor: r ? cellBg(r) : "var(--line)" }}>
              {i + 1}
            </div>
          ))}
        </div>

        <div style={{ textAlign: "center", fontWeight: 800, fontSize: 18, margin: "6px 0 10px" }}>Hole {sel + 1}</div>
        <div style={{ display: "flex", gap: 9 }}>
          <button className="bigbtn" style={{ background: A.color }} onClick={() => tap("A")}>{shortName(m.nameA)}</button>
          <button className="bigbtn" style={{ background: "#C4CABD", color: "#1B2A22" }} onClick={() => tap("T")}>Tie</button>
          <button className="bigbtn" style={{ background: B.color }} onClick={() => tap("B")}>{shortName(m.nameB)}</button>
        </div>
        <div className="help" style={{ textAlign: "center", marginTop: 10 }}>
          Tap a winner — it auto-jumps to the next hole. Tap the same one again to clear.
        </div>

        <div style={{ borderTop: "1px solid var(--line)", marginTop: 16, paddingTop: 14, textAlign: "center" }}>
          <div className="lab">Team total</div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12 }}>
            <span style={{ fontWeight: 600 }}>{A.name}</span>
            <b style={{ color: A.color, fontSize: 26 }}>{totA}</b>
            <span className="muted">–</span>
            <b style={{ color: B.color, fontSize: 26 }}>{totB}</b>
            <span style={{ fontWeight: 600 }}>{B.name}</span>
          </div>
        </div>

        <div className="caddi-handle" onClick={() => setCaddi(true)}>✨ cAdd-I ⌃</div>
      </div>

      {caddi && <div className="caddi-scrim" onClick={() => setCaddi(false)} />}
      <div className={`caddi-sheet${caddi ? " open" : ""}`}>
        <div className="caddi-grip" onClick={() => setCaddi(false)} />
        <div style={{ textAlign: "center", padding: "4px 18px 26px" }}>
          <div style={{ fontSize: 30 }}>✨</div>
          <div style={{ fontWeight: 800, fontSize: 18, marginTop: 4 }}>cAdd-I</div>
          <p className="muted" style={{ fontSize: 12.5, margin: "4px 0 12px" }}>Next Beta Version</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 7, justifyContent: "center" }}>
            {["What club here?", "Read this putt", "How's my match swinging?"].map((q) => (
              <span key={q} style={{ background: "#F3F6F0", border: "1px solid var(--line)", borderRadius: 16, padding: "7px 12px", fontSize: 12, color: "var(--mut)" }}>{q}</span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function shortName(n) { return (n || "").split(/[ &]/)[0]; }
