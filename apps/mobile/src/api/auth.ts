import { bytesToBase64 } from "@/crypto/base64";
import { apiRequest, ApiError } from "./client";

export { ApiError };

export interface TokenResponse {
  access_token: string;
  token_type: string;
}

export interface UserResponse {
  id: number;
  email: string;
}

export function register(email: string, authKey: Uint8Array): Promise<TokenResponse> {
  return apiRequest<TokenResponse>("/auth/register", {
    method: "POST",
    body: { email, auth_key: bytesToBase64(authKey) },
  });
}

export function login(email: string, authKey: Uint8Array): Promise<TokenResponse> {
  return apiRequest<TokenResponse>("/auth/login", {
    method: "POST",
    body: { email, auth_key: bytesToBase64(authKey) },
  });
}

export function getMe(accessToken: string): Promise<UserResponse> {
  return apiRequest<UserResponse>("/auth/me", { accessToken });
}

export function deleteAccount(accessToken: string, authKey: Uint8Array): Promise<void> {
  return apiRequest<void>("/auth/me", {
    method: "DELETE",
    accessToken,
    body: { auth_key: bytesToBase64(authKey) },
  });
}
