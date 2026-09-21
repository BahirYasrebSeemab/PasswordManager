import type { ErrorCode } from "../messaging/types";

const TEXT: Record<ErrorCode, string> = {
  locked: "Your vault is locked.",
  network: "Couldn't reach the server. Check your connection and try again.",
  invalid_input: "That input isn't valid.",
  invalid_credentials: "Incorrect email or master password.",
  not_found: "That entry no longer exists.",
  forbidden: "That action isn't allowed.",
  rate_limited: "Too many attempts. Wait a minute and try again.",
};

export function errorText(code: ErrorCode): string {
  return TEXT[code];
}
