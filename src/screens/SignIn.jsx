import { useState } from "react";
import { useSignIn, useSignUp } from "@clerk/clerk-react";

// US-default E.164 normalization (10 digits -> +1..........).
function normalizePhone(raw) {
  let p = (raw || "").trim().replace(/[()\-\s.]/g, "");
  if (!p.startsWith("+")) p = p.length === 10 ? "+1" + p : "+" + p;
  return p;
}
const errMsg = (e, fallback) =>
  e?.errors?.[0]?.longMessage || e?.errors?.[0]?.message || fallback;

// Unified phone OTP: tries sign-in first; if there's no account yet
// (every new player), falls through to sign-up. Same experience either way.
export default function SignIn() {
  const { signIn, setActive: setSignInActive, isLoaded: siLoaded } = useSignIn();
  const { signUp, setActive: setSignUpActive, isLoaded: suLoaded } = useSignUp();
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [stage, setStage] = useState("phone"); // phone | code
  const [mode, setMode] = useState(null);       // signin | signup
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  const sendCode = async () => {
    if (!siLoaded || !suLoaded) return;
    setBusy(true); setErr(null);
    const p = normalizePhone(phone);
    try {
      const si = await signIn.create({ identifier: p });
      const factor = si.supportedFirstFactors.find((f) => f.strategy === "phone_code");
      if (!factor) throw new Error("Phone code not available");
      await signIn.prepareFirstFactor({ strategy: "phone_code", phoneNumberId: factor.phoneNumberId });
      setMode("signin"); setStage("code");
    } catch {
      // No existing account -> create one.
      try {
        await signUp.create({ phoneNumber: p });
        await signUp.preparePhoneNumberVerification({ strategy: "phone_code" });
        setMode("signup"); setStage("code");
      } catch (e2) {
        setErr(errMsg(e2, "Couldn't send a code to that number. Check it and try again."));
      }
    }
    setBusy(false);
  };

  const verify = async () => {
    setBusy(true); setErr(null);
    try {
      if (mode === "signin") {
        const res = await signIn.attemptFirstFactor({ strategy: "phone_code", code });
        if (res.status === "complete") await setSignInActive({ session: res.createdSessionId });
        else setErr("Couldn't complete sign-in. Try again.");
      } else {
        const res = await signUp.attemptPhoneNumberVerification({ code });
        if (res.status === "complete") await setSignUpActive({ session: res.createdSessionId });
        else setErr("Couldn't complete sign-up. Try again.");
      }
    } catch (e) {
      setErr(errMsg(e, "That code didn't work. Check it and try again."));
    }
    setBusy(false);
  };

  return (
    <div className="screen">
      <div className="bar"><span style={{ fontWeight: 700 }}>Welcome</span><span className="wordmark">TOTO</span></div>
      <div className="pad" style={{ paddingTop: 8 }}>
        <div style={{ textAlign: "center", marginBottom: 6 }}>
          <div className="sp-word" style={{ fontSize: 40 }}>TOTO</div>
          <div className="sp-tag" style={{ fontSize: 13 }}>
            <span className="c">Compete… </span><span className="d">मगर प्यार से</span>
          </div>
        </div>
        <p className="sub" style={{ textAlign: "center" }}>
          Sign in with your phone — we text a one-time code. Players, organizers and admins all sign in the same way.
        </p>

        {err && <div className="ban err">{err}</div>}

        {stage === "phone" ? (
          <>
            <div className="field"><label className="lab">Mobile number</label>
              <input className="inp" type="tel" inputMode="tel" placeholder="+1 555 010 1234"
                value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
            <button className="btn grn" onClick={sendCode} disabled={busy || phone.replace(/\D/g, "").length < 7}>
              {busy ? "Sending…" : "Text me a code ›"}</button>
            <div className="help" style={{ textAlign: "center" }}>US numbers don't need the +1 — we'll add it.</div>
          </>
        ) : (
          <>
            <div className="field"><label className="lab">Enter the code we texted you</label>
              <input className="inp code" inputMode="numeric" maxLength={6} placeholder="000000"
                value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} /></div>
            <button className="btn grn" onClick={verify} disabled={busy || code.length < 4}>
              {busy ? "Verifying…" : "Verify & continue"}</button>
            <button className="linkbtn" onClick={() => { setStage("phone"); setCode(""); setErr(null); }}>
              ‹ Use a different number
            </button>
          </>
        )}
      </div>
    </div>
  );
}
