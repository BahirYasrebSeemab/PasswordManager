// Only http(s) URLs may ever be rendered as a link; blocks javascript: and data: schemes.
export function isSafeHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
}
