import { findLoginFields } from "./fieldDetector";

export interface Submission {
  username: string;
  password: string;
}

const DEDUPE_WINDOW_MS = 1000;
const SUBMIT_WORDS = /sign\s?in|log\s?in|submit|continue|next|register|sign\s?up|create account|save/i;

// Signup forms repeat the password as a confirm field (use the first); change-password
// forms have current + new + confirm (use the second, the NEW one). Empty fields are ignored.
export function pickSubmittedPassword(values: string[]): string | null {
  const filled = values.filter((value) => value.length > 0);
  if (filled.length === 0) return null;
  return filled.length >= 3 ? filled[1] : filled[0];
}

function collect(form: HTMLFormElement | null, doc: Document): Submission | null {
  const groups = findLoginFields(doc).filter((g) => g.password.form === form);
  if (groups.length === 0) return null;
  const password = pickSubmittedPassword(groups.map((g) => g.password.value));
  if (password === null) return null;
  const group = groups.find((g) => g.password.value === password) ?? groups[0];
  return { username: group.username?.value.trim() ?? "", password };
}

function looksLikeSubmit(button: Element): boolean {
  if (button instanceof HTMLButtonElement || button instanceof HTMLInputElement) {
    if (button.type === "submit") return true;
  }
  const label = [button.textContent, button.getAttribute("aria-label"), (button as HTMLInputElement).value]
    .filter((part): part is string => typeof part === "string")
    .join(" ");
  return SUBMIT_WORDS.test(label);
}

// SPAs often never fire a real `submit`, so we also watch Enter in an input and
// clicks on submit-looking buttons.
export function watchSubmissions(onSubmit: (submission: Submission) => void, doc: Document = document): () => void {
  let last: { key: string; at: number } | null = null;

  function report(form: HTMLFormElement | null): void {
    const submission = collect(form, doc);
    if (!submission) return;
    const key = `${submission.username} ${submission.password}`;
    const now = Date.now();
    if (last && last.key === key && now - last.at < DEDUPE_WINDOW_MS) return;
    last = { key, at: now };
    onSubmit(submission);
  }

  const onFormSubmit = (event: Event) => {
    if (event.target instanceof HTMLFormElement) report(event.target);
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Enter" || event.isComposing) return;
    if (event.target instanceof HTMLInputElement) report(event.target.form);
  };
  const onClick = (event: Event) => {
    if (!(event.target instanceof Element)) return;
    const button = event.target.closest("button, input[type=submit], input[type=button], [role=button]");
    if (button && looksLikeSubmit(button)) report(button.closest("form"));
  };

  doc.addEventListener("submit", onFormSubmit, true);
  doc.addEventListener("keydown", onKeyDown, true);
  doc.addEventListener("click", onClick, true);
  return () => {
    doc.removeEventListener("submit", onFormSubmit, true);
    doc.removeEventListener("keydown", onKeyDown, true);
    doc.removeEventListener("click", onClick, true);
  };
}
