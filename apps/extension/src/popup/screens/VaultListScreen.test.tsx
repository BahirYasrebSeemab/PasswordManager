// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { sendMessage } from "../../messaging/client";
import { VaultListScreen } from "./VaultListScreen";

vi.mock("../../messaging/client", () => ({ sendMessage: vi.fn() }));
const send = vi.mocked(sendMessage) as unknown as ReturnType<typeof vi.fn>;

const entries = [
  { id: 1, title: "GitHub", username: "octo", url: "https://github.com" },
  { id: 2, title: "Bank", username: "me@bank.com", url: "https://bank.example" },
];

beforeEach(() => {
  vi.clearAllMocks();
  send.mockImplementation(async (m: { type: string }) =>
    m.type === "listEntries" ? { ok: true, entries } : { ok: true }
  );
});

test("lists entries and opens one on click", async () => {
  const onSelect = vi.fn();
  render(<VaultListScreen onSelect={onSelect} onLocked={vi.fn()} />);
  await userEvent.click(await screen.findByRole("button", { name: /GitHub/ }));
  expect(onSelect).toHaveBeenCalledWith(1);
});

test("filters by title, username, or url as you type", async () => {
  render(<VaultListScreen onSelect={vi.fn()} onLocked={vi.fn()} />);
  await screen.findByText("GitHub");
  await userEvent.type(screen.getByPlaceholderText("Search"), "bank");
  expect(screen.queryByText("GitHub")).toBeNull();
  expect(screen.getByText("Bank")).toBeTruthy();
});

test("shows an empty state", async () => {
  send.mockResolvedValue({ ok: true, entries: [] });
  render(<VaultListScreen onSelect={vi.fn()} onLocked={vi.fn()} />);
  expect(await screen.findByText("No saved logins yet.")).toBeTruthy();
});

test("a locked response calls onLocked; other errors are shown", async () => {
  send.mockResolvedValueOnce({ ok: false, error: "locked" });
  const onLocked = vi.fn();
  const first = render(<VaultListScreen onSelect={vi.fn()} onLocked={onLocked} />);
  await waitFor(() => expect(onLocked).toHaveBeenCalled());
  first.unmount();

  send.mockResolvedValueOnce({ ok: false, error: "network" });
  render(<VaultListScreen onSelect={vi.fn()} onLocked={vi.fn()} />);
  expect(await screen.findByText(/Couldn't reach the server/)).toBeTruthy();
});

test("Log out sends logout and calls onLocked", async () => {
  const onLocked = vi.fn();
  render(<VaultListScreen onSelect={vi.fn()} onLocked={onLocked} />);
  await screen.findByText("GitHub");
  await userEvent.click(screen.getByRole("button", { name: "Log out" }));
  await waitFor(() => expect(send).toHaveBeenCalledWith({ type: "logout" }));
  await waitFor(() => expect(onLocked).toHaveBeenCalled());
});
