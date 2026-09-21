import type { Message, ResponseMap } from "./types";

export function sendMessage<T extends Message["type"]>(
  message: Extract<Message, { type: T }>
): Promise<ResponseMap[T]> {
  return browser.runtime.sendMessage(message) as Promise<ResponseMap[T]>;
}
