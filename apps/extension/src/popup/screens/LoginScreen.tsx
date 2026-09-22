import { useState, type FormEvent } from "react";
import { sendMessage } from "../../messaging/client";
import { LIMITS } from "../../safety/limits";
import { errorText } from "../errors";

export function LoginScreen({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [email, setEmail] = useState("");
  const [masterPassword, setMasterPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await sendMessage({ type: "login", email, masterPassword });
      if (result.ok) {
        setMasterPassword("");
        onLoggedIn();
        return;
      }
      setError(errorText(result.error));
    } catch {
      setError(errorText("network"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <h1>Password Manager</h1>
      <label htmlFor="email">Email</label>
      <input id="email" type="email" value={email} maxLength={LIMITS.email} onChange={(e) => setEmail(e.target.value)} />
      <label htmlFor="master">Master password</label>
      <input
        id="master"
        type="password"
        value={masterPassword}
        maxLength={LIMITS.password}
        onChange={(e) => setMasterPassword(e.target.value)}
      />
      {error && <p className="error">{error}</p>}
      <div className="actions">
        <button type="submit" className="primary" disabled={busy}>
          {busy ? "Logging in…" : "Log in"}
        </button>
      </div>
      <p className="muted">Accounts are created in the mobile app.</p>
    </form>
  );
}
