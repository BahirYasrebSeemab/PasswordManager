import { isSafeHttpUrl } from "./safeUrl";

test.each(["https://example.com", "http://example.com/path?x=1", "https://localhost:3000"])(
  "accepts %s",
  (url) => expect(isSafeHttpUrl(url)).toBe(true)
);

test.each([
  "javascript:alert(1)",
  "JaVaScRiPt:alert(1)",
  "data:text/html,<script>alert(1)</script>",
  "ftp://example.com",
  "file:///etc/passwd",
  "example.com",
  "",
])("rejects %s", (url) => expect(isSafeHttpUrl(url)).toBe(false));
