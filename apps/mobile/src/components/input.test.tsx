import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { Input } from "./input";

test("renders the label and forwards typed text", async () => {
  const onChangeText = jest.fn();
  await render(<Input label="Email" value="" onChangeText={onChangeText} testID="input-email" />);

  expect(screen.getByText("Email")).toBeTruthy();
  fireEvent.changeText(screen.getByTestId("input-email"), "a@b.com");
  expect(onChangeText).toHaveBeenCalledWith("a@b.com");
});

test("shows an error message when given one", async () => {
  await render(<Input label="Email" value="" error="Required" />);
  expect(screen.getByText("Required")).toBeTruthy();
});

test("hides password text by default and reveals it when the eye icon is tapped", async () => {
  await render(<Input label="Password" password value="hunter2" testID="input-password" />);

  expect(screen.getByTestId("input-password").props.secureTextEntry).toBe(true);
  fireEvent.press(screen.getByLabelText("Show password"));
  await waitFor(() => expect(screen.getByTestId("input-password").props.secureTextEntry).toBe(false));
});
