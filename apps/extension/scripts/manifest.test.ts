import { buildManifest } from "./manifest";

test("adds the API origin as a host permission", () => {
  const manifest = buildManifest({ name: "x" }, "https://api.example.com/some/path/");
  expect(manifest.host_permissions).toEqual(["https://api.example.com/*"]);
  expect(manifest.name).toBe("x");
});

test("keeps a non-default port in the origin", () => {
  const manifest = buildManifest({}, "http://localhost:8000");
  expect(manifest.host_permissions).toEqual(["http://localhost:8000/*"]);
});

test("throws on an invalid API URL", () => {
  expect(() => buildManifest({}, "not a url")).toThrow();
});

test("does not mutate the base manifest", () => {
  const base = { name: "x" };
  buildManifest(base, "https://api.example.com");
  expect(base).toEqual({ name: "x" });
});
