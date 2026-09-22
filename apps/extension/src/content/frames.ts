// Filling into third-party iframes is a classic credential-theft vector, so only
// the top frame and same-origin iframes are handled.
export function isTopOrSameOriginFrame(win: Window = window): boolean {
  try {
    if (win === win.top) return true;
    return win.top !== null && win.top.location.origin === win.location.origin;
  } catch {
    return false;
  }
}
