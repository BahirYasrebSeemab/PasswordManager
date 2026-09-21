import { sendMessage } from "../messaging/client";

// The popup is destroyed as soon as it loses focus, so it cannot run its own
// "clear after 30 s" timer. It asks the background, which clears via an alarm.
export async function copyToClipboard(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
  await sendMessage({ type: "scheduleClipboardClear" });
}
