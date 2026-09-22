import { sendMessage } from "../messaging/client";

// The popup is destroyed as soon as it loses focus, so it cannot run its own
// "clear after 30 s" timer. It asks the background, which clears via an alarm.
// A failed write throws; a failed schedule is reported so the UI can tell the user
// the secret is on the clipboard with no automatic clear.
export async function copyToClipboard(text: string): Promise<{ clearScheduled: boolean }> {
  await navigator.clipboard.writeText(text);
  try {
    const result = await sendMessage({ type: "scheduleClipboardClear" });
    return { clearScheduled: result?.ok === true };
  } catch {
    return { clearScheduled: false };
  }
}
