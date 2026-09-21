export class ApiError extends Error {
  status: number;
  detail: unknown;

  constructor(status: number, detail: unknown) {
    super(`API error ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
  }
}

function getBaseUrl(): string {
  const url = import.meta.env.VITE_API_URL as string | undefined;
  if (!url) {
    throw new Error("VITE_API_URL is not set");
  }
  return url.replace(/\/$/, "");
}

export async function apiRequest<T>(
  path: string,
  options: { method?: string; body?: unknown; accessToken?: string } = {}
): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (options.accessToken) {
    headers.Authorization = `Bearer ${options.accessToken}`;
  }

  const response = await fetch(`${getBaseUrl()}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  // A 204 No Content response (vault DELETE success) has no body; calling
  // response.json() on it throws, so handle it before parsing.
  if (response.status === 204) {
    if (!response.ok) {
      throw new ApiError(response.status, undefined);
    }
    return undefined as T;
  }

  const data = await response.json();

  if (!response.ok) {
    throw new ApiError(response.status, (data as { detail?: unknown }).detail);
  }

  return data as T;
}
