import { render, screen } from "@testing-library/react-native";
import { Text } from "react-native";
import { KeyboardSafeForm } from "./keyboard-safe-form";

test("wraps its children in a scrollable, keyboard-safe container", async () => {
  await render(
    <KeyboardSafeForm>
      <Text>content</Text>
    </KeyboardSafeForm>
  );

  expect(screen.getByTestId("keyboard-safe-scroll")).toBeTruthy();
  expect(screen.getByText("content")).toBeTruthy();
});
