import { render, screen } from "@testing-library/react-native";
import { Text } from "react-native";
import { useAuth } from "@/context/AuthContext";

jest.mock("@/context/AuthContext");

// Mirrors app-layout.test.tsx's approach — see the detailed comments there
// for why Redirect/Stack are module-scope `Mock`-prefixed stand-ins, why
// this file lives under src/ instead of app/ (Expo Router would otherwise
// misclassify "_layout.test.tsx" as a real route and collide with the
// actual layout), and why AuthLayout is require()'d lazily inside each
// test rather than via a static top-level `import`.
const MockRedirect = ({ href }: { href: string }) => <Text testID="redirect">{href}</Text>;
const MockStack = () => <Text testID="stack">stack</Text>;

jest.mock("expo-router", () => ({
  Redirect: MockRedirect,
  Stack: MockStack,
}));

function mockStatus(status: "loading" | "locked" | "unlocked") {
  (useAuth as jest.Mock).mockReturnValue({ status });
}

function getAuthLayout() {
  return require("../../../app/(auth)/_layout").default;
}

beforeEach(() => {
  jest.clearAllMocks();
});

test("redirects to '/' when status is 'unlocked' (already signed in)", async () => {
  mockStatus("unlocked");
  const AuthLayout = getAuthLayout();

  await render(<AuthLayout />);

  expect(screen.getByTestId("redirect").props.children).toBe("/");
});

test("renders the auth Stack (login/register) when status is 'locked'", async () => {
  mockStatus("locked");
  const AuthLayout = getAuthLayout();

  await render(<AuthLayout />);

  expect(screen.getByTestId("stack")).toBeTruthy();
  expect(screen.queryByTestId("redirect")).toBeNull();
});

test("renders the auth Stack (login/register) when status is 'loading'", async () => {
  mockStatus("loading");
  const AuthLayout = getAuthLayout();

  await render(<AuthLayout />);

  expect(screen.getByTestId("stack")).toBeTruthy();
  expect(screen.queryByTestId("redirect")).toBeNull();
});
