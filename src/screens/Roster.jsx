import { useEffect, useState, useCallback } from "react";
import { useApi } from "../api.js";
import { useNav } from "../store.jsx";
import { Bar, Spinner } from "../components.jsx";

// Parse "Name 0412 345 678" lines into { planned_name, phone }.
function parseLines(text) {
  return text.split("\n").map((line) => {
    const t = line.trim();
    if (!t) return null;
    const m = t.match(/(\+?[\d ()-]{6,})$/);
    const phone = m ? m[1].trim() : "";
    const name = m ? t.slice(0, m.index).trim() : t;
    return phone ? { planned_name: name || null, phone } : null;
  }).filter(Boolean);
}

export default function Roster() {
  const api = useApi();
  const { code, back } = useNav();
  const [t, setT] = useState(null);
  const [tid, setTid] = useState(null);
  const [paste, setPaste] = useState("");
  const [team, setTeam] = useState("A");
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const list = await api("/api/organizer/tournaments");
    const mine = list.find((x) => x.code === code);
    if (!mine) return;
    setTid(mine.id);
    setT(await api(`/api/organizer/tournaments/${mine.id}`));
  }, [api, code]);

  useEffect(() => { load(); }, [load]);

  const addBatch = async () => {
    const parsed = parseLines(paste).map((e) => ({ ...e, team }));
    if (!parsed.length) { setMsg({ k: "err", t: "No names with phone numbers found." }); return; }
    setBusy(true); setMsg(null);
    try {
      const res = await api(`/api/organizer/tournaments/${tid}/roster`, {
        method: "POST", body: JSON.stringify({ entries: parsed }),
      });
      setPaste("");
      setMsg({ k: "ok", t: `Added ${res.added.length} to ${team === "A" ? t.team_a_name : t.team_b_name}.` });
      load();
    } catch (e) { setMsg({ k: "err", t: e.message }); }
    setBusy(false);
  };

  const share = async () => {
    const text = `Join ${t.name} on TOTO — tournament code ${t.code}`;
    if (navigator.share) { try { await navigator.share({ title: t.name, text, url: location.href }); } catch {} }
    else if (navigator.clipboard) { await navigator.clipboard.writeText(text); setMsg({ k: "ok", t: "Invite copied — paste it into your group chat." }); }
  };

  if (!t) return (<div className="screen"><Bar title="Hub" onBack={back} /><Spinner /></div>);

  return (
    <div className="screen">
      <Bar title="Hub" onBack={back} />
      <div className="pad">
        <div className="h1">Roster</div>
        <p className="sub">Paste a list of names + phone numbers, tag the batch to a team, then add.</p>

        <button className="btn ghost" style={{ marginBottom: 14, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }} onClick={share}>
          <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4" /></svg>
          Share invite (code + link)
        </button>

        {msg && <div className={`ban ${msg.k}`}>{msg.t}</div>}

        <div className="seg">
          <button className={team === "A" ? "on" : ""} onClick={() => setTeam("A")}>Add as {t.team_a_name}</button>
          <button className={team === "B" ? "on" : ""} onClick={() => setTeam("B")}>Add as {t.team_b_name}</button>
        </div>
        <textarea className="inp" style={{ minHeight: 120, resize: "vertical" }} placeholder={"Dave Chen 0412 345 678\nSarah Lin 0413 222 111"}
          value={paste} onChange={(e) => setPaste(e.target.value)} />
        <button className="btn grn" onClick={addBatch} disabled={busy}>{busy ? "Adding…" : `Add to ${team === "A" ? t.team_a_name : t.team_b_name}`}</button>

        <div className="lab" style={{ marginTop: 20 }}>On the roster ({t.roster.length})</div>
        {t.roster.length === 0
          ? <p className="muted" style={{ fontSize: 13 }}>No players yet.</p>
          : t.roster.map((r) => (
            <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 0", borderBottom: "1px solid var(--line)" }}>
              <span style={{ flex: 1, fontWeight: 600 }}>{r.planned_name || r.phone}</span>
              <span style={{ fontSize: 11, fontWeight: 800, color: r.team === "A" ? t.team_a_color : t.team_b_color }}>
                {r.team === "A" ? t.team_a_name : t.team_b_name}
              </span>
            </div>
          ))}
      </div>
    </div>
  );
}
