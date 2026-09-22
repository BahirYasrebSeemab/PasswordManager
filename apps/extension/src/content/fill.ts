import type { LoginFields } from "./fieldDetector";

// React/Vue-controlled inputs track their value on the element instance, so a plain
// `input.value = x` is ignored on the next render. Calling the native prototype setter
// and then dispatching input/change events makes the framework see a real edit.
export function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  if (setter) setter.call(input, value);
  else input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

export function fillCredential(
  fields: LoginFields,
  credential: { username: string; password: string }
): void {
  if (fields.username && credential.username) setInputValue(fields.username, credential.username);
  setInputValue(fields.password, credential.password);
}
