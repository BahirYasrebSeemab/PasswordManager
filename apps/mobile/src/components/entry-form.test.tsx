import { render, screen, fireEvent, waitFor, act } from "@testing-library/react-native";
import { EntryForm } from "./entry-form";

test("shows a validation error and does not call onSubmit when title/password are empty", async () => {
  const onSubmit = jest.fn();
  await render(<EntryForm submitLabel="Save" onSubmit={onSubmit} />);

  fireEvent.press(screen.getByText("Save"));

  await waitFor(() => expect(screen.getByText("Title and password are required.")).toBeTruthy());
  expect(onSubmit).not.toHaveBeenCalled();
});

test("calls onSubmit with the trimmed field values, omitting empty optional fields", async () => {
  const onSubmit = jest.fn().mockResolvedValue(undefined);
  const { getByTestId, getByText } = await render(<EntryForm submitLabel="Save" onSubmit={onSubmit} />);

  await act(async () => {
    fireEvent.changeText(getByTestId("input-title"), "  GitHub  ");
    fireEvent.changeText(getByTestId("input-password"), "hunter2");
  });

  fireEvent.press(getByText("Save"));

  await waitFor(() =>
    expect(onSubmit).toHaveBeenCalledWith({
      title: "GitHub",
      username: undefined,
      password: "hunter2",
      url: undefined,
      notes: undefined,
    })
  );
});

test("pre-fills fields from initialValue", async () => {
  await render(
    <EntryForm
      initialValue={{ title: "GitHub", username: "me", password: "hunter2" }}
      submitLabel="Save changes"
      onSubmit={jest.fn()}
    />
  );

  expect(screen.getByDisplayValue("GitHub")).toBeTruthy();
  expect(screen.getByDisplayValue("me")).toBeTruthy();
});
