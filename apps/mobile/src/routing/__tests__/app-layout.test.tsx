import { render, screen } from "@testing-library/react-native";
import { Text } from "react-native";
import { useAuth } from "@/context/AuthContext";

// See delete-account.test.tsx for why: every screen now renders through
// Spotlight (gradient + safe-area-inset logic), so the first render's
// deferred require() pays a one-time cold-transform cost that can exceed
// Jest's default 5000ms budget on its own.
jest.setTimeout(15000);

jest.mock("@/context/AuthContext");

// expo-router's <Redirect> and <Stack> aren't meaningfully renderable/
// assertable in a Jest/jsdom-less RN test environment (no navigator is
// mounted), and this project has no established pattern yet for testing
// them. We mock the two components with simple stand-ins we can query:
// Redirect renders its `href` as text (so we can assert *where* it would
// navigate), Stack renders a fixed marker (so we can assert it rendered at
// all, standing in for "the app's screens would show here").
//
// These stand-ins are declared at module scope (not inline in the
// jest.mock factory below) and named with a `Mock` prefix on purpose:
// this project's babel config enables NativeWind's babel plugin, which
// rewrites element-creation calls to go through its own
// `_ReactNativeCSSInterop` helper import — including ones written inline
// inside a jest.mock() factory — and Jest's factory-hoisting forbids a
// factory from referencing anything outside its scope except identifiers
// starting with "mock" (case-insensitive). Defining the components outside
// and referencing them by their Mock-prefixed name satisfies that rule.
const MockRedirect = ({ href }: { href: string }) => <Text testID="redirect">{href}</Text>;
const MockStack = () => <Text testID="stack">stack</Text>;

jest.mock("expo-router", () => ({
  Redirect: MockRedirect,
  Stack: MockStack,
}));

function mockStatus(status: "loading" | "locked" | "unlocked") {
  (useAuth as jest.Mock).mockReturnValue({ status });
}

beforeEach(() => {
  jest.clearAllMocks();
});

// This test file lives OUTSIDE app/ deliberately: Expo Router treats every
// *.tsx file under app/ as a route via require.context, and a file named
// "_layout.test.tsx" gets classified as a layout route (it only strips the
// trailing .tsx, leaving "_layout.test" whose first segment is still
// "_layout") — colliding with the real app/(app)/_layout.tsx. In dev this
// throws at boot; in a production export, sort order makes the test file
// silently win and replace the real layout. Keeping this file under src/
// avoids Expo Router's file-based routing scanning it at all, while still
// being discovered by Jest's default testMatch (anywhere under rootDir).
//
// AppLayout is require()'d lazily inside each test, NOT via a static
// top-level `import`, because of an ordering bug: `import` statements are
// hoisted above all other top-level code (per ES module semantics), so a
// static `import AppLayout from "../../../app/(app)/_layout"` would run —
// and therefore require("expo-router"), invoking the jest.mock("expo-router",
// ...) factory above — BEFORE this file's own `const MockRedirect = ...` /
// `const MockStack = ...` assignments have executed, making the factory
// capture them as `undefined`. Requiring the layout lazily here instead
// defers that require until test-run time, well after the Mock consts are
// assigned.
function getAppLayout() {
  return require("../../../app/(app)/_layout").default;
}

test("renders a loading indicator while status is 'loading'", async () => {
  mockStatus("loading");
  const AppLayout = getAppLayout();

  await render(<AppLayout />);

  expect(screen.getByTestId("loading-indicator")).toBeTruthy();
  expect(screen.queryByTestId("redirect")).toBeNull();
  expect(screen.queryByTestId("stack")).toBeNull();
});

test("redirects to the login screen when status is 'locked'", async () => {
  mockStatus("locked");
  const AppLayout = getAppLayout();

  await render(<AppLayout />);

  expect(screen.getByTestId("redirect").props.children).toBe("/(auth)/login");
});

test("renders the app's Stack when status is 'unlocked'", async () => {
  mockStatus("unlocked");
  const AppLayout = getAppLayout();

  await render(<AppLayout />);

  expect(screen.getByTestId("stack")).toBeTruthy();
  expect(screen.queryByTestId("redirect")).toBeNull();
});
