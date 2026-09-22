// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { sendMessage } from "../messaging/client";
import { OptionsApp } from "./OptionsApp";

vi.mock("../messaging/client", () => ({ sendMessage: vi.fn() }));
const send = vi.mocked(sendMessage) as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  send.mockImplementation(async (m: { type: string }) =>
    m.type === "getAutoLockMinutes" ? { minutes: 15 } : { ok: true }
  );
});

test("shows the current timeout and saves a new preset", async () => {
  render(<OptionsApp />);
  const select = (await screen.findByLabelText("Lock after")) as HTMLSelectElement;
  await waitFor(() => expect(select.value).toBe("15"));
  await userEvent.selectOptions(select, "30");
  await waitFor(() => expect(send).toHaveBeenCalledWith({ type: "setAutoLockMinutes", minutes: 30 }));
  expect(await screen.findByText("Saved.")).toBeTruthy();
});

test("Log out sends logout", async () => {
  render(<OptionsApp />);
  await userEvent.click(await screen.findByRole("button", { name: "Log out" }));
  await waitFor(() => expect(send).toHaveBeenCalledWith({ type: "logout" }));
  expect(await screen.findByText("Logged out.")).toBeTruthy();
});
