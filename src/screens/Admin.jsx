import { useEffect, useState, useCallback } from "react";
import { useApi } from "../api.js";
import { useNav } from "../store.jsx";
import { Bar, Spinner } from "../components.jsx";

const STATUS_COLOR = { unused: "#9A7A1F", claimed: "#2F8A5E", revoked: "#a8a399" };

export default function Admin() {
  const api = useApi();
  const { back } = useNav();
  const [passes, setPasses] = useState(null);
  const [minted, setMinted] = useState(null);
  const [err, setErr] = useState(null);

  const load = useCallback(async () => {
    try { setPasses(await api("/api/admin/gate-passes")); }
    catch (e) { setErr(e.message); setPasses([]); }
  }, [api]);

  useEffect(() => { load(); }, [load]);

  const mint = async () => {
    try { const p = await api("/api/admin/gate-passes", { method: "POST", body: "{}" }); setMinted(p.code); load(); }
    catch (e) { setErr(e.message); }
  };
  const revoke = async (id) => {
    try { await api(`/api/admin/gate-passes/${id}/revoke`, { method: "POST", body: "{}" }); load(); }
    catch (e) { setErr(e.message); }
  };

  return (
    <div className="screen">
      <Bar title="Home" onBack={back} />
      <div className="pad">
        <div className="h1">Gate passes</div>
        <p className="sub">Each pass is single-use and unlocks one tournament.</p>
        {err && <div className="ban err">{err}</div>}
        {minted && <div className="ban ok">New pass: <b style={{ letterSpacing: ".1em" }}>{minted}</b> — share it with an organizer.</div>}
        <button className="btn grn" onClick={mint}>＋ Mint a gate pass</button>

        <div className="lab" style={{ marginTop: 18 }}>All passes</div>
        {passes === null ? <Spinner /> : passes.length === 0 ? (
          <p className="muted" style={{ fontSize: 13 }}>No passes yet.</p>
        ) : passes.map((p) => (
          <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 0", borderBottom: "1px solid var(--line)" }}>
            <b style={{ fontSize: 18, letterSpacing: ".1em" }}>{p.code}</b>
            <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: STATUS_COLOR[p.status] }}>{p.status}</span>
            {p.requested_by && <span className="muted" style={{ fontSize: 12 }}>👤 {p.requested_by}</span>}
            {p.tournament_name && <span className="muted" style={{ fontSize: 12 }}>{p.tournament_name}</span>}
            {p.status === "unused" && (
              <button className="btn ghost" style={{ marginLeft: "auto", width: "auto", padding: "5px 10px", fontSize: 12, marginTop: 0 }}
                onClick={() => revoke(p.id)}>Revoke</button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
