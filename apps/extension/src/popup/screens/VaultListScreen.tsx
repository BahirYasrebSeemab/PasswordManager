import { useEffect, useMemo, useState } from "react";
import { sendMessage } from "../../messaging/client";
import type { EntrySummary } from "../../messaging/types";
import { errorText } from "../errors";

interface Props {
  onSelect: (id: number) => void;
  onLocked: () => void;
}

export function VaultListScreen({ onSelect, onLocked }: Props) {
  const [entries, setEntries] = useState<EntrySummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let cancelled = false;
    sendMessage({ type: "listEntries" })
      .then((result) => {
        if (cancelled) return;
        if (result.ok) setEntries(result.entries);
        else if (result.error === "locked") onLocked();
        else setError(errorText(result.error));
      })
      .catch(() => {
        if (!cancelled) setError(errorText("network"));
      });
    return () => {
      cancelled = true;
    };
  }, [onLocked]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!entries || !q) return entries ?? [];
    return entries.filter((e) =>
      [e.title, e.username ?? "", e.url ?? ""].some((field) => field.toLowerCase().includes(q))
    );
  }, [entries, query]);

  async function logout() {
    try {
      await sendMessage({ type: "logout" });
    } catch {
      // fail closed: even if we couldn't confirm the background cleared the
      // session, never leave the user staring at what looks like an unlocked vault
    }
    onLocked();
  }

  return (
    <div>
      <div className="row">
        <h1>Vault</h1>
        <span>
          <button onClick={() => void browser.runtime.openOptionsPage()}>Settings</button>{" "}
          <button onClick={logout}>Log out</button>
        </span>
      </div>
      <input placeholder="Search" value={query} onChange={(e) => setQuery(e.target.value)} />
      {error && <p className="error">{error}</p>}
      {entries === null && !error && <p className="muted">Loading…</p>}
      {entries !== null && entries.length === 0 && <p className="muted">No saved logins yet.</p>}
      <ul className="list">
        {visible.map((entry) => (
          <li key={entry.id}>
            <button onClick={() => onSelect(entry.id)}>
              <div>{entry.title}</div>
              {entry.username && <div className="muted">{entry.username}</div>}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
