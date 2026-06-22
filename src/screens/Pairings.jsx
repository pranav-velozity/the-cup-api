import { useEffect, useState, useCallback } from "react";
import { useApi } from "../api.js";
import { useNav } from "../store.jsx";
import { Bar, Spinner } from "../components.jsx";

export default function Pairings() {
  const api = useApi();
  const { code, back } = useNav();
  const [t, setT] = useState(null);
  const [tid, setTid] = useState(null);
  const [day, setDay] = useState(0);
  const [pick, setPick] = useState(null); // { matchId, side:'A'|'B', idx }

  const load = useCallback(async () => {
    const list = await api("/api/organizer/tournaments");
    const mine = list.find((x) => x.code === code);
    if (!mine) return;
    setTid(mine.id);
    setT(await api(`/api/organizer/tournaments/${mine.id}`));
  }, [api, code]);

  useEffect(() => { load(); }, [load]);
  if (!t) return (<div className="screen"><Bar title="Hub" onBack={back} /><Spinner /></div>);

  const nameOf = (id) => {
    const r = t.roster.find((x) => x.id === id);
    return r ? (r.planned_name || r.phone) : null;
  };
  const dy = t.days.find((d) => d.day_index === day) || { format: "singles" };
  const isComplete = (m) => dy.format === "scramble"
    ? (m.side_a?.[0] && m.side_a?.[1] && m.side_b?.[0] && m.side_b?.[1])
    : (m.side_a?.[0] && m.side_b?.[0]);

  // Completed pairings sink to the bottom; keep ordinal order within groups.
  const dayMatches = t.matches
    .filter((m) => m.day_index === day)
    .map((m, i) => ({ m, i }))
    .sort((a, b) => (isComplete(a.m) ? 1 : 0) - (isComplete(b.m) ? 1 : 0) || a.i - b.i);

  const usedIds = (side) => {
    const ids = [];
    for (const m of t.matches.filter((x) => x.day_index === day))
      for (const id of (side === "A" ? m.side_a : m.side_b) || []) if (id) ids.push(id);
    return ids;
  };

  const assign = async (playerId) => {
    if (!pick) return;
    const m = t.matches.find((x) => x.id === pick.matchId);
    const sideKey = pick.side === "A" ? "side_a" : "side_b";
    const arr = (m[sideKey] || []).slice();
    arr[pick.idx] = playerId;
    const body = pick.side === "A" ? { sideA: arr } : { sideB: arr };
    await api(`/api/organizer/tournaments/${tid}/matches/${m.id}`, { method: "PATCH", body: JSON.stringify(body) });
    setPick(null);
    load();
  };

  const slot = (m, side, idx, label) => {
    const id = (side === "A" ? m.side_a : m.side_b)?.[idx];
    const filled = nameOf(id);
    const active = pick && pick.matchId === m.id && pick.side === side && pick.idx === idx;
    return (
      <button className="btn ghost" style={{ flex: 1, width: "auto", padding: 11, textAlign: "left", marginTop: 0,
        borderColor: active ? "#4AAA78" : "var(--line)", color: filled ? "var(--ink)" : "var(--mut)", fontWeight: filled ? 600 : 500 }}
        onClick={() => setPick({ matchId: m.id, side, idx })}>{filled || label}</button>
    );
  };

  // Picker shown right under the day toggle when a slot is selected.
  const picker = pick && (() => {
    const used = usedIds(pick.side);
    const avail = t.roster.filter((p) => p.team === pick.side && !used.includes(p.id));
    return (
      <div style={{ background: "#E9F6EF", border: "1px solid #BfE3Cf", borderRadius: 14, padding: "12px 13px", marginBottom: 14 }}>
        <div className="lab" style={{ marginBottom: 8 }}>Pick a {pick.side === "A" ? t.team_a_name : t.team_b_name} player</div>
        <div>
          {avail.length === 0 && <span className="muted" style={{ fontSize: 13 }}>No more {pick.side === "A" ? t.team_a_name : t.team_b_name} players available — add them in Roster.</span>}
          {avail.map((p) => (
            <span key={p.id} className="chip" style={{ background: "#fff" }} onClick={() => assign(p.id)}>{p.planned_name || p.phone}</span>
          ))}
        </div>
        <button className="linkbtn" style={{ textAlign: "left", marginTop: 4 }} onClick={() => setPick(null)}>Cancel</button>
      </div>
    );
  })();

  return (
    <div className="screen">
      <Bar title="Hub" onBack={back} />
      <div className="pad">
        <div className="h1">Pairings</div>
        <p className="sub">Tap a slot, then tap a player. Assigned players drop off the list, and finished matches move down.</p>

        <div className="seg">
          {t.days.map((d) => (
            <button key={d.day_index} className={day === d.day_index ? "on" : ""} onClick={() => { setDay(d.day_index); setPick(null); }}>
              Day {d.day_index + 1} · {d.format === "scramble" ? "Scramble" : "Singles"}
            </button>
          ))}
        </div>

        {picker}

        {dayMatches.map(({ m, i }) => {
          const done = isComplete(m);
          return dy.format === "singles" ? (
            <div key={m.id} style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 8, opacity: done ? 0.7 : 1 }}>
              <span style={{ width: 20, fontWeight: 800, color: "#9aa394", fontSize: 13 }}>{i + 1}</span>
              {slot(m, "A", 0, t.team_a_name)}
              <span className="muted" style={{ fontSize: 12 }}>v</span>
              {slot(m, "B", 0, t.team_b_name)}
            </div>
          ) : (
            <div key={m.id} style={{ border: "1px solid var(--line)", background: "#fff", borderRadius: 12, padding: 10, marginBottom: 8, opacity: done ? 0.7 : 1 }}>
              <div style={{ fontWeight: 700, color: "#9aa394", fontSize: 12, marginBottom: 6 }}>Match {i + 1}{done ? " · set" : ""}</div>
              <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>{slot(m, "A", 0, t.team_a_name + " 1")}{slot(m, "A", 1, t.team_a_name + " 2")}</div>
              <div style={{ display: "flex", gap: 6 }}>{slot(m, "B", 0, t.team_b_name + " 1")}{slot(m, "B", 1, t.team_b_name + " 2")}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
