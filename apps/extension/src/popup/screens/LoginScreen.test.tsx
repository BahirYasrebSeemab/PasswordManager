// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { sendMessage } from "../../messaging/client";
import { LoginScreen } from "./LoginScreen";

vi.mock("../../messaging/client", () => ({ sendMessage: vi.fn() }));
const send = vi.mocked(sendMessage) as unknown as ReturnType<typeof vi.fn>;

async function fillAndSubmit() {
  await userEvent.type(screen.getByLabelText("Email"), "me@example.com");
  await userEvent.type(screen.getByLabelText("Master password"), "pw");
  await userEvent.click(screen.getByRole("button", { name: "Log in" }));
}

beforeEach(() => vi.clearAllMocks());

test("sends the credentials and calls onLoggedIn on success", async () => {
  send.mockResolvedValue({ ok: true });
  const onLoggedIn = vi.fn();
  render(<LoginScreen onLoggedIn={onLoggedIn} />);
  await fillAndSubmit();
  await waitFor(() => expect(onLoggedIn).toHaveBeenCalled());
  expect(send).toHaveBeenCalledWith({ type: "login", email: "me@example.com", masterPassword: "pw" });
});

test.each([
  ["invalid_credentials", "Incorrect email or master password."],
  ["rate_limited", "Too many attempts. Wait a minute and try again."],
  ["network", "Couldn't reach the server. Check your connection and try again."],
])("shows a message for %s and does not log in", async (error, text) => {
  send.mockResolvedValue({ ok: false, error });
  const onLoggedIn = vi.fn();
  render(<LoginScreen onLoggedIn={onLoggedIn} />);
  await fillAndSubmit();
  expect(await screen.findByText(text)).toBeTruthy();
  expect(onLoggedIn).not.toHaveBeenCalled();
});

test("the button is disabled with a progress label while logging in", async () => {
  let resolve!: (value: unknown) => void;
  send.mockReturnValue(new Promise((r) => (resolve = r)));
  render(<LoginScreen onLoggedIn={vi.fn()} />);
  await fillAndSubmit();
  const button = await screen.findByRole("button", { name: "Logging in…" });
  expect((button as HTMLButtonElement).disabled).toBe(true);
  resolve({ ok: false, error: "network" });
});
