import { useCallback, useEffect, useState } from "react";
import { sendMessage } from "../messaging/client";
import { EntryDetailScreen } from "./screens/EntryDetailScreen";
import { LoginScreen } from "./screens/LoginScreen";
import { VaultListScreen } from "./screens/VaultListScreen";

type View = { name: "loading" } | { name: "login" } | { name: "list" } | { name: "entry"; id: number };

export function App() {
  const [view, setView] = useState<View>({ name: "loading" });

  useEffect(() => {
    sendMessage({ type: "getStatus" })
      .then((status) => setView(status.locked ? { name: "login" } : { name: "list" }))
      .catch(() => setView({ name: "login" }));
  }, []);

  const goLogin = useCallback(() => setView({ name: "login" }), []);
  const goList = useCallback(() => setView({ name: "list" }), []);

  switch (view.name) {
    case "loading":
      return <p className="muted">Loading…</p>;
    case "login":
      return <LoginScreen onLoggedIn={goList} />;
    case "list":
      return <VaultListScreen onSelect={(id) => setView({ name: "entry", id })} onLocked={goLogin} />;
    case "entry":
      return <EntryDetailScreen id={view.id} onBack={goList} onLocked={goLogin} />;
  }
}
