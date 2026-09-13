import { render, screen } from "@testing-library/react-native";
import { Text } from "react-native";

test("the testing pipeline can render and query a component", async () => {
  await render(<Text>Hello, vault.</Text>);
  expect(screen.getByText("Hello, vault.")).toBeTruthy();
});
