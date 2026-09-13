import { apiRequest } from "./client";

export interface VaultEntryResponse {
  id: number;
  ciphertext: string;
  created_at: string;
  updated_at: string;
}

export function createVaultEntry(accessToken: string, ciphertext: string): Promise<VaultEntryResponse> {
  return apiRequest<VaultEntryResponse>("/vault", {
    method: "POST",
    accessToken,
    body: { ciphertext },
  });
}

export function listVaultEntries(accessToken: string): Promise<VaultEntryResponse[]> {
  return apiRequest<VaultEntryResponse[]>("/vault", { accessToken });
}

export function getVaultEntry(accessToken: string, id: string): Promise<VaultEntryResponse> {
  return apiRequest<VaultEntryResponse>(`/vault/${id}`, { accessToken });
}

export function updateVaultEntry(
  accessToken: string,
  id: string,
  ciphertext: string
): Promise<VaultEntryResponse> {
  return apiRequest<VaultEntryResponse>(`/vault/${id}`, {
    method: "PUT",
    accessToken,
    body: { ciphertext },
  });
}

export function deleteVaultEntry(accessToken: string, id: string): Promise<void> {
  return apiRequest<void>(`/vault/${id}`, { method: "DELETE", accessToken });
}
