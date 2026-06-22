import { useEffect, useState, useRef, useCallback } from "react";
import { useApi } from "../api.js";
import { useNav } from "../store.jsx";
import { useLiveBoard } from "../lib/useSocket.js";
import { Bar, Avatar, Spinner } from "../components.jsx";

export default function Board() {
  const api = useApi();
  const { code, go, back } = useNav();
  const [board, setBoard] = useState(null);
  const [view, setView] = useState("tile");
  const [flash, setFlash] = useState({});
  const prevScores = useRef({});

  const applyBoard = useCallback((b) => {
    // Detect which matches changed score -> flash them once.
    const f = {};
    for (const m of b.matches) {
      const key = m.id;
      const sig = `${m.a}-${m.b}`;
      if (prevScores.current[key] && prevScores.current[key] !== sig) f[key] = true;
      prevScores.current[key] = sig;
    }
    if (Object.keys(f).length) {
      setFlash(f);
      setTimeout(() => setFlash({}), 950);
    }
    setBoard(b);
  }, []);

  const load = useCallback(() => {
    api(`/api/score/${code}/board`).then(applyBoard).catch(() => {});
  }, [api, code, applyBoard]);

  useEffect(() => { load(); }, [load]);
  useLiveBoard(code, { onBoard: applyBoard });

  if (!board) return (<div className="screen"><Bar title="Tournament" onBack={back} /><Spinner /></div>);

  const A = board.teamA, B = board.teamB;
  const teamA = { name: A.name, color: A.color, emoji: A.emoji, kind: A.kind, logoUrl: A.logoUrl };
  const teamB = { name: B.name, color: B.color, emoji: B.emoji, kind: B.kind, logoUrl: B.logoUrl };
  const labels = { tight: "TIGHT", tied: "TIED", ahead: "AHEAD", final: "FINAL" };

  const tile = (m) => (
    <div key={m.id} className={`mtile${flash[m.id] ? " justchanged" : ""}`}
      onClick={() => go("entry", { code, entry: { matchId: m.id, hole: nextHole(m.holes) } })}>
      <div className={`tstat${m.status === "tight" ? " breathe" : ""}`}>{labels[m.status]}</div>
      <div className="tilescore">
        <div className="tnameT" style={{ color: A.color, fontWeight: m.a >= m.b ? 700 : 600 }}>{m.nameA}</div>
        <div className={`tnum${flash[m.id] ? " numrefresh" : ""}`}>{m.pointsA}–{m.pointsB}</div>
        <div className="tnameT" style={{ color: B.color, fontWeight: m.b >= m.a ? 700 : 600 }}>{m.nameB}</div>
      </div>
      <div className="tmeta">
        Day {m.dayIndex + 1} · {m.format === "scramble" ? "Scramble" : "Singles"}
        {m.done ? " · done" : ` · thru ${m.played}`}
      </div>
      {m.hot && <span className="hot" style={{ position: "absolute", bottom: 7, right: 8, fontSize: 9 }}>
        <span style={{ display: "inline-block", width: 5, height: 5, borderRadius: "50%",
          background: m.hot === "A" ? A.color : B.color, marginRight: 4, verticalAlign: 1 }} />HOT</span>}
    </div>
  );

  const row = (m) => (
    <div key={m.id} className={`mcard${flash[m.id] ? " justchanged" : ""}`}
      onClick={() => go("entry", { code, entry: { matchId: m.id, hole: nextHole(m.holes) } })}>
      <div className={`spine s-${m.status}`}>{labels[m.status]}</div>
      <div className="mbody">
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ flex: 1, fontSize: 13.5, color: A.color, fontWeight: m.a >= m.b ? 700 : 500 }}>{m.nameA}</span>
          <b className={flash[m.id] ? "numrefresh" : ""} style={{ fontSize: 17 }}>{m.pointsA}–{m.pointsB}</b>
          <span style={{ flex: 1, textAlign: "right", fontSize: 13.5, color: B.color, fontWeight: m.b >= m.a ? 700 : 500 }}>{m.nameB}</span>
        </div>
        <div className="muted" style={{ fontSize: 11, marginTop: 4, textAlign: "center" }}>
          Day {m.dayIndex + 1} · {m.format === "scramble" ? "Scramble" : "Singles"}{m.done ? " · done" : ` · thru ${m.played}`}
        </div>
      </div>
    </div>
  );

  return (
    <div className="screen">
      <Bar title="Home" onBack={back} />
      <div className="pad">
        <div className="h1">Live board</div>
        <p className="sub" style={{ display: "flex", alignItems: "center", gap: 7 }}>
          {board.live ? <><span className="livedot" /><span style={{ color: "#16A34A", fontWeight: 700, fontSize: 11.5, letterSpacing: ".12em" }}>LIVE</span></>
            : <span style={{ color: "var(--mut)", fontWeight: 700, fontSize: 11.5, letterSpacing: ".12em" }}>FINAL</span>}
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "center", gap: 6 }}>
          <div className="crestwrap"><Avatar team={teamA} size={44} />
            <div style={{ fontWeight: 700, fontSize: 13 }}>{A.name}</div>
            <div className="bigpts" style={{ color: A.color }}>{A.points}</div></div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontWeight: 800, fontSize: 30, lineHeight: 1 }}>{board.holesPlayed}</div>
            <div className="muted" style={{ fontSize: 11 }}>holes played</div>
            <div style={{ fontSize: 11, color: "var(--mut)", fontWeight: 600, marginTop: 3 }}>{board.holesLeft} to play</div></div>
          <div className="crestwrap"><Avatar team={teamB} size={44} />
            <div style={{ fontWeight: 700, fontSize: 13 }}>{B.name}</div>
            <div className="bigpts" style={{ color: B.color }}>{B.points}</div></div>
        </div>
        <div className="tug">
          <div style={{ width: `${board.aShare}%`, background: A.color }} />
          <div style={{ width: `${100 - board.aShare}%`, background: B.color }} />
        </div>
        <div style={{ textAlign: "center", fontWeight: 700, fontSize: 13 }}>{board.leadText}</div>

        {board.last9?.length > 0 && (
          <div className="form9">
            <span className="form9lab">LAST 9</span>
            <div className="form9cells">
              {Array.from({ length: 9 }).map((_, i) => {
                const pad = 9 - board.last9.length;
                const e = i >= pad ? board.last9[i - pad] : null;
                const bg = e === "A" ? A.color : e === "B" ? B.color : e === "T" ? "#C4CABD" : null;
                return <span key={i} className={`f9${bg ? "" : " empty"}`} style={bg ? { background: bg } : {}} />;
              })}
            </div>
          </div>
        )}

        <div style={{ display: "flex", alignItems: "center", marginTop: 14, marginBottom: 9 }}>
          <div className="lab" style={{ margin: 0 }}>Matches</div>
          <div style={{ marginLeft: "auto" }}>
            <div className="viewtog">
              <button className={view === "list" ? "on" : ""} onClick={() => setView("list")}>
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /></svg>
              </button>
              <button className={view === "tile" ? "on" : ""} onClick={() => setView("tile")}>
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="8" height="8" rx="1.5" /><rect x="13" y="3" width="8" height="8" rx="1.5" /><rect x="3" y="13" width="8" height="8" rx="1.5" /><rect x="13" y="13" width="8" height="8" rx="1.5" /></svg>
              </button>
            </div>
          </div>
        </div>

        {view === "tile"
          ? <div className="tilegrid">{board.matches.map(tile)}</div>
          : board.matches.map(row)}
      </div>
    </div>
  );
}

function nextHole(holes) {
  const i = (holes || []).indexOf(null);
  return i < 0 ? 17 : i;
}
