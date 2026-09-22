export interface LoginFields {
  password: HTMLInputElement;
  username: HTMLInputElement | null;
}

const TEXT_TYPES = new Set(["text", "email", "tel"]);
// Only the password field's immediate parent is searched when there's no <form> —
// climbing further risks pairing with an unrelated input from another section of
// the page that merely shares a distant ancestor (e.g. a header search box).
const MAX_ANCESTOR_HOPS = 1;
const USERNAME_HINT = /(^|\s)(username|email)(\s|$)/;

function isVisible(el: HTMLElement): boolean {
  if (typeof el.checkVisibility === "function" && !el.checkVisibility()) return false;
  const style = getComputedStyle(el);
  if (style.display === "none" || style.visibility === "hidden") return false;
  return parseFloat(style.opacity) !== 0;
}

function isUsable(input: HTMLInputElement): boolean {
  return !input.disabled && !input.readOnly && isVisible(input);
}

function precedingTextInputs(scope: ParentNode, password: HTMLInputElement): HTMLInputElement[] {
  return Array.from(scope.querySelectorAll("input")).filter(
    (candidate) =>
      candidate !== password &&
      TEXT_TYPES.has(candidate.type) &&
      isUsable(candidate) &&
      (candidate.compareDocumentPosition(password) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
  );
}

function scopesFor(password: HTMLInputElement): ParentNode[] {
  if (password.form) return [password.form];
  const scopes: ParentNode[] = [];
  let node = password.parentElement;
  for (let hops = 0; node && hops < MAX_ANCESTOR_HOPS; hops++) {
    scopes.push(node);
    node = node.parentElement;
  }
  return scopes;
}

function findUsername(password: HTMLInputElement): HTMLInputElement | null {
  for (const scope of scopesFor(password)) {
    const candidates = precedingTextInputs(scope, password);
    if (candidates.length === 0) continue;
    return candidates.find((c) => USERNAME_HINT.test(c.autocomplete)) ?? candidates[candidates.length - 1];
  }
  return null;
}

export function findLoginFields(root: ParentNode = document): LoginFields[] {
  return Array.from(root.querySelectorAll<HTMLInputElement>("input[type=password]"))
    .filter(isUsable)
    .map((password) => ({ password, username: findUsername(password) }));
}

// Many login forms are rendered by JavaScript after load, so rescan (debounced)
// whenever the page adds or removes nodes.
export function observeLoginFields(onChange: () => void, root: Node = document, delayMs = 100): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const observer = new MutationObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(onChange, delayMs);
  });
  observer.observe(root, { childList: true, subtree: true });
  return () => {
    observer.disconnect();
    clearTimeout(timer);
  };
}
