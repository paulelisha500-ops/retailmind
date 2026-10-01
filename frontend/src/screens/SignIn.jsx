import { ChevronLeft, Leaf, Lock, Mail } from "lucide-react";
import { useState } from "react";
import { EDITION } from "../api.js";
import { SEED_ACCOUNTS, SEED_PASSWORD } from "../engine/accounts.js";
import { useSession } from "../session.jsx";
import { Banner, Avatar, List, ListRow } from "../ui/display.jsx";
import { Button, IconInput } from "../ui/controls.jsx";

export default function SignIn({ onBack }) {
  const { signIn, notice } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(nextEmail = email, nextPassword = password) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await signIn(nextEmail, nextPassword);
    } catch (err) {
      setError(err.message || "Sign in failed");
      setBusy(false);
    }
  }

  return (
    <main className="auth">
      <div className="auth__card">
        <button type="button" className="back-btn" data-tid="signin.back" onClick={onBack}><ChevronLeft size={18} aria-hidden="true" />Back</button>

        <div className="auth__brand">
          <div className="brand__mark brand__mark--lg"><Leaf size={26} aria-hidden="true" /></div>
          <h1 className="t-title">Sign in to RetailMind</h1>
          <p className="t-sub">Forecasting, procurement and the shop floor in one console.</p>
        </div>

        <Banner tone="info">{notice}</Banner>
        <Banner tone="error">{error}</Banner>

        <form onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <div className="field">
            <IconInput icon={Mail} tid="signin.email" type="email" name="email" autoComplete="username" autoCapitalize="none" spellCheck={false}
              placeholder="Email address" aria-label="Email address" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div className="field">
            <IconInput icon={Lock} tid="signin.password" type="password" name="password" autoComplete="current-password"
              placeholder="Password" aria-label="Password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
          <Button type="submit" tid="signin.submit" block size="lg" loading={busy}>Sign in</Button>
        </form>

        {EDITION === "browser" && (
          <div className="auth__accounts">
            <div className="section__title"><h2>Workspace accounts</h2></div>
            <List>
              {SEED_ACCOUNTS.map((a) => (
                <ListRow key={a.email} tid={`signin.account.${a.role.toLowerCase()}`} onClick={() => { setEmail(a.email); setPassword(SEED_PASSWORD); submit(a.email, SEED_PASSWORD); }}
                  lead={<Avatar name={a.label} />} title={a.label} detail={a.email} aside={a.role} chevron disabled={busy} />
              ))}
            </List>
            <p className="hint mt-3">Every workspace account uses the password <b>{SEED_PASSWORD}</b>. Each role sees a different set of screens and permissions.</p>
          </div>
        )}
        <p className="hint auth__foot">
          {EDITION === "browser"
            ? "Your workspace is stored in this browser only — nothing is sent anywhere."
            : "You're signing in to your RetailMind server."}
        </p>
      </div>
    </main>
  );
}
