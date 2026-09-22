import { sendMessage } from "../messaging/client";
import { copyToClipboard } from "./clipboard";

vi.mock("../messaging/client", () => ({ sendMessage: vi.fn() }));

const send = vi.mocked(sendMessage) as unknown as ReturnType<typeof vi.fn>;

function stubClipboard(writeText: ReturnType<typeof vi.fn>) {
  vi.stubGlobal("navigator", { clipboard: { writeText } });
}

beforeEach(() => {
  vi.clearAllMocks();
  send.mockResolvedValue({ ok: true });
});
afterEach(() => vi.unstubAllGlobals());

test("writes the text, asks the background to clear it later, and reports the clear as scheduled", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  stubClipboard(writeText);

  await expect(copyToClipboard("secret")).resolves.toEqual({ clearScheduled: true });

  expect(writeText).toHaveBeenCalledWith("secret");
  expect(sendMessage).toHaveBeenCalledWith({ type: "scheduleClipboardClear" });
});

test("rejects and schedules nothing when the clipboard write fails", async () => {
  stubClipboard(vi.fn().mockRejectedValue(new Error("denied")));

  await expect(copyToClipboard("secret")).rejects.toThrow("denied");

  expect(sendMessage).not.toHaveBeenCalled();
});

test("reports clearScheduled false when the schedule message rejects", async () => {
  stubClipboard(vi.fn().mockResolvedValue(undefined));
  send.mockRejectedValue(new Error("no background"));

  await expect(copyToClipboard("secret")).resolves.toEqual({ clearScheduled: false });
});

test("reports clearScheduled false when the schedule message returns a failure", async () => {
  stubClipboard(vi.fn().mockResolvedValue(undefined));
  send.mockResolvedValue({ ok: false, error: "locked" });

  await expect(copyToClipboard("secret")).resolves.toEqual({ clearScheduled: false });
});
