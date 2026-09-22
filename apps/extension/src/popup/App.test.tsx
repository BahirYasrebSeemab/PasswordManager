// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { sendMessage } from "../messaging/client";
import { App } from "./App";

vi.mock("../messaging/client", () => ({ sendMessage: vi.fn() }));
const send = vi.mocked(sendMessage) as unknown as ReturnType<typeof vi.fn>;

const entry = { title: "GitHub", password: "pw", username: "octo" };

function backend(locked: boolean) {
  send.mockImplementation(async (m: { type: string }) => {
    switch (m.type) {
      case "getStatus": return { locked };
      case "login": return { ok: true };
      case "listEntries": return { ok: true, entries: [{ id: 1, title: "GitHub", username: "octo" }] };
      case "getEntry": return { ok: true, entry };
      default: return { ok: true };
    }
  });
}

beforeEach(() => vi.clearAllMocks());

test("shows the login screen when locked, then the vault after logging in", async () => {
  backend(true);
  render(<App />);
  await userEvent.type(await screen.findByLabelText("Email"), "me@example.com");
  await userEvent.type(screen.getByLabelText("Master password"), "pw");
  await userEvent.click(screen.getByRole("button", { name: "Log in" }));
  expect(await screen.findByText("GitHub")).toBeTruthy();
});

test("shows the vault directly when already unlocked, and can open then leave an entry", async () => {
  backend(false);
  render(<App />);
  await userEvent.click(await screen.findByRole("button", { name: /GitHub/ }));
  expect(await screen.findByRole("heading", { name: "GitHub" })).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "Back" }));
  expect(await screen.findByPlaceholderText("Search")).toBeTruthy();
});

test("falls back to the login screen if the status check fails", async () => {
  send.mockRejectedValue(new Error("no background"));
  render(<App />);
  await waitFor(() => expect(screen.getByLabelText("Email")).toBeTruthy());
});
