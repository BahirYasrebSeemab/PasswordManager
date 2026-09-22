import { useEffect, useState } from "react";
import { AUTO_LOCK_PRESETS, DEFAULT_AUTO_LOCK_MINUTES } from "../background/settings";
import { sendMessage } from "../messaging/client";
import { errorText } from "../popup/errors";

export function OptionsApp() {
  const [minutes, setMinutes] = useState<number>(DEFAULT_AUTO_LOCK_MINUTES);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    sendMessage({ type: "getAutoLockMinutes" })
      .then((r) => setMinutes(r.minutes))
      .catch(() => setMessage(errorText("network")));
  }, []);

  async function change(value: number) {
    setMinutes(value);
    const result = await sendMessage({ type: "setAutoLockMinutes", minutes: value });
    setMessage(result.ok ? "Saved." : errorText(result.error));
  }

  async function logout() {
    await sendMessage({ type: "logout" });
    setMessage("Logged out.");
  }

  return (
    <div>
      <h1>Password Manager settings</h1>
      <label htmlFor="autolock">Lock after</label>
      <select id="autolock" value={minutes} onChange={(e) => void change(Number(e.target.value))}>
        {AUTO_LOCK_PRESETS.map((m) => (
          <option key={m} value={m}>
            {m} {m === 1 ? "minute" : "minutes"} of inactivity
          </option>
        ))}
      </select>
      <p className="muted">The vault also locks whenever the browser closes.</p>
      <div className="actions">
        <button onClick={logout}>Log out</button>
      </div>
      {message && <p className="notice">{message}</p>}
    </div>
  );
}
