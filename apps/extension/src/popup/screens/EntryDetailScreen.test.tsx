// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { sendMessage } from "../../messaging/client";
import { copyToClipboard } from "../clipboard";
import { EntryDetailScreen } from "./EntryDetailScreen";

vi.mock("../../messaging/client", () => ({ sendMessage: vi.fn() }));
vi.mock("../clipboard", () => ({ copyToClipboard: vi.fn().mockResolvedValue({ clearScheduled: true }) }));

const send = vi.mocked(sendMessage) as unknown as ReturnType<typeof vi.fn>;

const entry = {
  title: "Example",
  username: "me@example.com",
  password: "hunter2",
  url: "https://example.com",
  notes: "keep",
};

function respond(overrides: Record<string, unknown> = {}) {
  send.mockImplementation(async (message: { type: string }) => {
    if (message.type in overrides) return overrides[message.type];
    if (message.type === "getEntry") return { ok: true, entry };
    return { ok: true };
  });
}

function setup() {
  const props = { id: 4, onBack: vi.fn(), onLocked: vi.fn() };
  render(<EntryDetailScreen {...props} />);
  return props;
}

beforeEach(() => vi.clearAllMocks());

test("shows the entry with the password hidden until Show is clicked", async () => {
  respond();
  setup();
  expect(await screen.findByText("Example")).toBeTruthy();
  expect(screen.getByText("me@example.com")).toBeTruthy();
  expect(screen.queryByText("hunter2")).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "Show" }));
  expect(screen.getByText("hunter2")).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "Hide" }));
  expect(screen.queryByText("hunter2")).toBeNull();
});

test("copying the password uses the clipboard helper", async () => {
  respond();
  setup();
  await screen.findByText("Example");
  await userEvent.click(screen.getByRole("button", { name: "Copy password" }));
  expect(copyToClipboard).toHaveBeenCalledWith("hunter2");
  expect(await screen.findByText("Password copied. It will be cleared in 30 seconds.")).toBeTruthy();
});

test("warns to clear the clipboard manually when the automatic clear could not be scheduled", async () => {
  respond();
  vi.mocked(copyToClipboard).mockResolvedValueOnce({ clearScheduled: false });
  setup();
  await screen.findByText("Example");
  await userEvent.click(screen.getByRole("button", { name: "Copy password" }));
  expect(
    await screen.findByText("Password copied, but automatic clearing failed. Clear your clipboard manually.")
  ).toBeTruthy();
});

test("says the copy failed when the clipboard write itself fails", async () => {
  respond();
  vi.mocked(copyToClipboard).mockRejectedValueOnce(new Error("denied"));
  setup();
  await screen.findByText("Example");
  await userEvent.click(screen.getByRole("button", { name: "Copy password" }));
  expect(await screen.findByText("Couldn't copy to the clipboard.")).toBeTruthy();
});

test("an https url renders as a safe link; a javascript: url is plain text, never a link", async () => {
  respond();
  const { unmount } = render(<EntryDetailScreen id={4} onBack={vi.fn()} onLocked={vi.fn()} />);
  const link = await screen.findByRole("link");
  expect(link.getAttribute("href")).toBe("https://example.com");
  expect(link.getAttribute("rel")).toContain("noopener");
  unmount();

  respond({ getEntry: { ok: true, entry: { ...entry, url: "javascript:alert(1)" } } });
  render(<EntryDetailScreen id={4} onBack={vi.fn()} onLocked={vi.fn()} />);
  await screen.findByText("javascript:alert(1)");
  expect(screen.queryByRole("link")).toBeNull();
});

test("hostile markup in a field is rendered as text, never as elements", async () => {
  respond({ getEntry: { ok: true, entry: { ...entry, title: "<img src=x onerror=alert(1)>" } } });
  const { container } = render(<EntryDetailScreen id={4} onBack={vi.fn()} onLocked={vi.fn()} />);
  await screen.findByText("<img src=x onerror=alert(1)>");
  expect(container.querySelector("img")).toBeNull();
});

test("a locked response returns to the login flow", async () => {
  respond({ getEntry: { ok: false, error: "locked" } });
  const props = setup();
  await waitFor(() => expect(props.onLocked).toHaveBeenCalled());
});

test("editing sends the full content, preserving fields, and returns to the view", async () => {
  respond();
  setup();
  await screen.findByText("Example");
  await userEvent.click(screen.getByRole("button", { name: "Edit" }));
  const title = screen.getByLabelText("Title");
  await userEvent.clear(title);
  await userEvent.type(title, "Renamed");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));

  await waitFor(() =>
    expect(send).toHaveBeenCalledWith({
      type: "updateEntry",
      id: 4,
      content: { ...entry, title: "Renamed" },
    })
  );
  expect(await screen.findByText("Renamed")).toBeTruthy();
});

test("saving an invalid edit shows the reason and does not send", async () => {
  respond();
  setup();
  await screen.findByText("Example");
  await userEvent.click(screen.getByRole("button", { name: "Edit" }));
  await userEvent.clear(screen.getByLabelText("Title"));
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(await screen.findByText("Title is required.")).toBeTruthy();
  expect(send).not.toHaveBeenCalledWith(expect.objectContaining({ type: "updateEntry" }));
});

test("delete needs a second confirming click, then deletes and goes back", async () => {
  respond();
  const props = setup();
  await screen.findByText("Example");
  await userEvent.click(screen.getByRole("button", { name: "Delete" }));
  expect(send).not.toHaveBeenCalledWith(expect.objectContaining({ type: "deleteEntry" }));
  await userEvent.click(screen.getByRole("button", { name: "Confirm delete" }));
  await waitFor(() => expect(send).toHaveBeenCalledWith({ type: "deleteEntry", id: 4 }));
  await waitFor(() => expect(props.onBack).toHaveBeenCalled());
});
