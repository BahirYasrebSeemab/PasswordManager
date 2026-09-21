import { sendMessage } from "../messaging/client";
import { copyToClipboard } from "./clipboard";

vi.mock("../messaging/client", () => ({ sendMessage: vi.fn().mockResolvedValue({ ok: true }) }));

test("writes the text to the clipboard and asks the background to clear it later", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { clipboard: { writeText } });

  await copyToClipboard("secret");

  expect(writeText).toHaveBeenCalledWith("secret");
  expect(sendMessage).toHaveBeenCalledWith({ type: "scheduleClipboardClear" });
  vi.unstubAllGlobals();
});
