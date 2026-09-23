import { render, screen, fireEvent, waitFor, act } from "@testing-library/react-native";
import { useAuth } from "@/context/AuthContext";
import { ApiError } from "@/api/auth";

jest.mock("@/context/AuthContext");

function getLoginScreen() {
  return require("../../../app/(auth)/login").default;
}

beforeEach(() => {
  jest.clearAllMocks();
});

// Regression test for the missing-submit-button bug: the screen must be
// wrapped in the keyboard-safe scroll container, or the button can be
// pushed off-screen by the keyboard with no way to reach it.
test("is wrapped in the keyboard-safe scroll container", async () => {
  (useAuth as jest.Mock).mockReturnValue({ login: jest.fn() });
  const LoginScreen = getLoginScreen();

  await render(<LoginScreen />);

  expect(screen.getByTestId("keyboard-safe-scroll")).toBeTruthy();
});

test("submitting valid credentials calls login with the entered email and password", async () => {
  const login = jest.fn().mockResolvedValue(undefined);
  (useAuth as jest.Mock).mockReturnValue({ login });
  const LoginScreen = getLoginScreen();

  await render(<LoginScreen />);
  await act(async () => {
    fireEvent.changeText(screen.getByPlaceholderText("Email"), "me@example.com");
    fireEvent.changeText(screen.getByPlaceholderText("Master password"), "correct horse battery staple");
  });
  fireEvent.press(screen.getByText("Log in"));

  await waitFor(() => expect(login).toHaveBeenCalledWith("me@example.com", "correct horse battery staple"));
});

test.each([
  [401, "Invalid email or password."],
  [429, "Too many attempts. Please wait a minute and try again."],
  [409, "There was a conflict with your request. Please try again."],
  [500, "Something went wrong. Please try again."],
])("a %i response shows the right error message", async (status, message) => {
  const login = jest.fn().mockRejectedValue(new ApiError(status, "detail"));
  (useAuth as jest.Mock).mockReturnValue({ login });
  const LoginScreen = getLoginScreen();

  await render(<LoginScreen />);
  await act(async () => {
    fireEvent.changeText(screen.getByPlaceholderText("Email"), "me@example.com");
    fireEvent.changeText(screen.getByPlaceholderText("Master password"), "pw");
  });
  fireEvent.press(screen.getByText("Log in"));

  await waitFor(() => expect(screen.getByText(message)).toBeTruthy());
});

test("a non-ApiError rejection (e.g. network failure) shows a connectivity message", async () => {
  const login = jest.fn().mockRejectedValue(new TypeError("Network request failed"));
  (useAuth as jest.Mock).mockReturnValue({ login });
  const LoginScreen = getLoginScreen();

  await render(<LoginScreen />);
  await act(async () => {
    fireEvent.changeText(screen.getByPlaceholderText("Email"), "me@example.com");
    fireEvent.changeText(screen.getByPlaceholderText("Master password"), "pw");
  });
  fireEvent.press(screen.getByText("Log in"));

  await waitFor(() =>
    expect(screen.getByText("Couldn't reach the server. Check your connection and try again.")).toBeTruthy()
  );
});
