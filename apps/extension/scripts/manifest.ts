export function buildManifest(base: Record<string, unknown>, apiUrl: string): Record<string, unknown> {
  const origin = new URL(apiUrl).origin;
  return { ...base, host_permissions: [`${origin}/*`] };
}
