import { fireEvent, render, screen } from "@testing-library/react-native";
import { Button } from "./button";

test("renders the given title", async () => {
  await render(<Button title="Unlock" onPress={() => {}} />);
  expect(screen.getByText("Unlock")).toBeTruthy();
});

test("calls onPress when tapped", async () => {
  const onPress = jest.fn();
  await render(<Button title="Unlock" onPress={onPress} />);
  fireEvent.press(screen.getByText("Unlock"));
  expect(onPress).toHaveBeenCalledTimes(1);
});

test("does not call onPress when disabled", async () => {
  const onPress = jest.fn();
  await render(<Button title="Unlock" onPress={onPress} disabled />);
  fireEvent.press(screen.getByText("Unlock"));
  expect(onPress).not.toHaveBeenCalled();
});

test("does not call onPress while loading", async () => {
  const onPress = jest.fn();
  await render(<Button title="Unlock" onPress={onPress} loading />);
  expect(screen.queryByText("Unlock")).toBeNull();
  expect(onPress).not.toHaveBeenCalled();
});
