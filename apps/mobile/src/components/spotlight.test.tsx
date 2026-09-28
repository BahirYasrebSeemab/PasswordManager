import { render, screen } from "@testing-library/react-native";
import { Text } from "react-native";
import { Spotlight } from "./spotlight";

test("renders its children", async () => {
  await render(
    <Spotlight>
      <Text>content</Text>
    </Spotlight>
  );

  expect(screen.getByText("content")).toBeTruthy();
});
