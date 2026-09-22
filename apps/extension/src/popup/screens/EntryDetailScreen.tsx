import { useCallback, useEffect, useState, type FormEvent } from "react";
import { sendMessage } from "../../messaging/client";
import type { ErrorCode } from "../../messaging/types";
import { LIMITS, validateEntryContent } from "../../safety/limits";
import { isSafeHttpUrl } from "../../safety/safeUrl";
import type { VaultEntryContent } from "../../vault/entry";
import { copyToClipboard } from "../clipboard";
import { errorText } from "../errors";

interface Props {
  id: number;
  onBack: () => void;
  onLocked: () => void;
}

type Mode = "view" | "edit" | "confirmDelete";

interface Draft {
  title: string;
  username: string;
  password: string;
  url: string;
  notes: string;
}

const toDraft = (e: VaultEntryContent): Draft => ({
  title: e.title,
  username: e.username ?? "",
  password: e.password,
  url: e.url ?? "",
  notes: e.notes ?? "",
});

function toContent(d: Draft): VaultEntryContent {
  const content: VaultEntryContent = { title: d.title, password: d.password };
  if (d.username) content.username = d.username;
  if (d.url) content.url = d.url;
  if (d.notes) content.notes = d.notes;
  return content;
}

export function EntryDetailScreen({ id, onBack, onLocked }: Props) {
  const [entry, setEntry] = useState<VaultEntryContent | null>(null);
  const [mode, setMode] = useState<Mode>("view");
  const [reveal, setReveal] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const fail = useCallback(
    (code: ErrorCode) => {
      if (code === "locked") onLocked();
      else setMessage(errorText(code));
    },
    [onLocked]
  );

  useEffect(() => {
    let cancelled = false;
    sendMessage({ type: "getEntry", id })
      .then((result) => {
        if (cancelled) return;
        if (result.ok) setEntry(result.entry);
        else fail(result.error);
      })
      .catch(() => {
        if (!cancelled) setMessage(errorText("network"));
      });
    return () => {
      cancelled = true;
    };
  }, [id, fail]);

  async function copy(value: string, label: string) {
    try {
      const { clearScheduled } = await copyToClipboard(value);
      setMessage(
        clearScheduled
          ? `${label} copied. It will be cleared in 30 seconds.`
          : `${label} copied, but automatic clearing failed. Clear your clipboard manually.`
      );
    } catch {
      setMessage("Couldn't copy to the clipboard.");
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!draft) return;
    const content = toContent(draft);
    const check = validateEntryContent(content);
    if (!check.ok) {
      setMessage(check.reason);
      return;
    }
    setBusy(true);
    try {
      const result = await sendMessage({ type: "updateEntry", id, content });
      if (result.ok) {
        setEntry(content);
        setMode("view");
        setMessage("Saved.");
      } else fail(result.error);
    } catch {
      setMessage(errorText("network"));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      const result = await sendMessage({ type: "deleteEntry", id });
      if (result.ok) onBack();
      else fail(result.error);
    } catch {
      setMessage(errorText("network"));
    } finally {
      setBusy(false);
    }
  }

  if (!entry) {
    return (
      <div>
        <button onClick={onBack}>Back</button>
        <p className={message ? "error" : "muted"}>{message ?? "Loading…"}</p>
      </div>
    );
  }

  if (mode === "edit" && draft) {
    const field = (key: keyof Draft, label: string, max: number) => (
      <>
        <label htmlFor={`f-${key}`}>{label}</label>
        <input
          id={`f-${key}`}
          value={draft[key]}
          maxLength={max}
          onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
        />
      </>
    );
    return (
      <form onSubmit={save}>
        <h1>Edit entry</h1>
        {field("title", "Title", LIMITS.title)}
        {field("username", "Username", LIMITS.username)}
        {field("password", "Password", LIMITS.password)}
        {field("url", "URL", LIMITS.url)}
        <label htmlFor="f-notes">Notes</label>
        <textarea
          id="f-notes"
          rows={3}
          value={draft.notes}
          maxLength={LIMITS.notes}
          onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
        />
        {message && <p className="error">{message}</p>}
        <div className="actions">
          <button type="submit" className="primary" disabled={busy}>
            Save
          </button>
          <button type="button" onClick={() => { setMode("view"); setMessage(null); }}>
            Cancel
          </button>
        </div>
      </form>
    );
  }

  return (
    <div>
      <div className="row">
        <button onClick={onBack}>Back</button>
      </div>
      <h1>{entry.title}</h1>
      {entry.username && (
        <div className="row">
          <span>{entry.username}</span>
          <button onClick={() => copy(entry.username ?? "", "Username")}>Copy username</button>
        </div>
      )}
      <div className="row">
        <span>{reveal ? entry.password : "••••••••"}</span>
        <span>
          <button onClick={() => setReveal(!reveal)}>{reveal ? "Hide" : "Show"}</button>{" "}
          <button onClick={() => copy(entry.password, "Password")}>Copy password</button>
        </span>
      </div>
      {entry.url &&
        (isSafeHttpUrl(entry.url) ? (
          <p>
            <a href={entry.url} target="_blank" rel="noopener noreferrer">
              {entry.url}
            </a>
          </p>
        ) : (
          <p>{entry.url}</p>
        ))}
      {entry.notes && <pre>{entry.notes}</pre>}
      {message && <p className="notice">{message}</p>}
      <div className="actions">
        <button onClick={() => { setDraft(toDraft(entry)); setMode("edit"); setMessage(null); }}>Edit</button>
        {mode === "confirmDelete" ? (
          <>
            <button className="danger" disabled={busy} onClick={remove}>
              Confirm delete
            </button>
            <button onClick={() => setMode("view")}>Cancel</button>
          </>
        ) : (
          <button className="danger" onClick={() => setMode("confirmDelete")}>
            Delete
          </button>
        )}
      </div>
    </div>
  );
}
