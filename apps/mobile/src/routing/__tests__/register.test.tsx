import { render, screen, fireEvent, waitFor, act } from "@testing-library/react-native";
import { useAuth } from "@/context/AuthContext";
import { ApiError } from "@/api/auth";

jest.mock("@/context/AuthContext");

function getRegisterScreen() {
  return require("../../../app/(auth)/register").default;
}

beforeEach(() => {
  jest.clearAllMocks();
});

// Regression test for the missing-submit-button bug: the screen must be
// wrapped in the keyboard-safe scroll container, or the button can be
// pushed off-screen by the keyboard with no way to reach it.
test("is wrapped in the keyboard-safe scroll container", async () => {
  (useAuth as jest.Mock).mockReturnValue({ register: jest.fn() });
  const RegisterScreen = getRegisterScreen();

  await render(<RegisterScreen />);

  expect(screen.getByTestId("keyboard-safe-scroll")).toBeTruthy();
});

test("submitting valid credentials calls register with the entered email and password", async () => {
  const register = jest.fn().mockResolvedValue(undefined);
  (useAuth as jest.Mock).mockReturnValue({ register });
  const RegisterScreen = getRegisterScreen();

  await render(<RegisterScreen />);
  await act(async () => {
    fireEvent.changeText(screen.getByPlaceholderText("Email"), "me@example.com");
    fireEvent.changeText(screen.getByPlaceholderText("Master password"), "correct horse battery staple");
  });
  fireEvent.press(screen.getByText("Register"));

  await waitFor(() => expect(register).toHaveBeenCalledWith("me@example.com", "correct horse battery staple"));
});

test.each([
  [401, "Something went wrong verifying your details. Please try again."],
  [429, "Too many attempts. Please wait a minute and try again."],
  [409, "That email is already registered."],
  [500, "Something went wrong. Please try again."],
])("a %i response shows the right error message", async (status, message) => {
  const register = jest.fn().mockRejectedValue(new ApiError(status, "detail"));
  (useAuth as jest.Mock).mockReturnValue({ register });
  const RegisterScreen = getRegisterScreen();

  await render(<RegisterScreen />);
  await act(async () => {
    fireEvent.changeText(screen.getByPlaceholderText("Email"), "me@example.com");
    fireEvent.changeText(screen.getByPlaceholderText("Master password"), "pw");
  });
  fireEvent.press(screen.getByText("Register"));

  await waitFor(() => expect(screen.getByText(message)).toBeTruthy());
});

test("a non-ApiError rejection (e.g. network failure) shows a connectivity message", async () => {
  const register = jest.fn().mockRejectedValue(new TypeError("Network request failed"));
  (useAuth as jest.Mock).mockReturnValue({ register });
  const RegisterScreen = getRegisterScreen();

  await render(<RegisterScreen />);
  await act(async () => {
    fireEvent.changeText(screen.getByPlaceholderText("Email"), "me@example.com");
    fireEvent.changeText(screen.getByPlaceholderText("Master password"), "pw");
  });
  fireEvent.press(screen.getByText("Register"));

  await waitFor(() =>
    expect(screen.getByText("Couldn't reach the server. Check your connection and try again.")).toBeTruthy()
  );
});
