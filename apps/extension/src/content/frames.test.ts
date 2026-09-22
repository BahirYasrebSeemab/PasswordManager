import { isTopOrSameOriginFrame } from "./frames";

function fakeTop(origin: string) {
  const top: Record<string, unknown> = { location: { origin } };
  top.top = top;
  return top;
}

test("the top frame is eligible", () => {
  expect(isTopOrSameOriginFrame(fakeTop("https://a.com") as unknown as Window)).toBe(true);
});

test("a same-origin iframe is eligible", () => {
  const top = fakeTop("https://a.com");
  const frame = { top, location: { origin: "https://a.com" } };
  expect(isTopOrSameOriginFrame(frame as unknown as Window)).toBe(true);
});

test("a different-origin iframe is not eligible", () => {
  const top = fakeTop("https://a.com");
  const frame = { top, location: { origin: "https://ads.example" } };
  expect(isTopOrSameOriginFrame(frame as unknown as Window)).toBe(false);
});

test("a cross-origin iframe whose top.location access throws is not eligible", () => {
  const top = {
    get location(): never {
      throw new DOMException("blocked", "SecurityError");
    },
  };
  const frame = { top, location: { origin: "https://ads.example" } };
  expect(isTopOrSameOriginFrame(frame as unknown as Window)).toBe(false);
});
