import { sendMessage } from "./client";

afterEach(() => {
  delete (globalThis as { browser?: unknown }).browser;
});

test("sendMessage forwards the message to the background and returns its response", async () => {
  const send = vi.fn().mockResolvedValue({ locked: true });
  (globalThis as { browser?: unknown }).browser = { runtime: { sendMessage: send } };

  const response = await sendMessage({ type: "getStatus" });

  expect(send).toHaveBeenCalledWith({ type: "getStatus" });
  expect(response).toEqual({ locked: true });
});
