import { bytesToBase64 } from "../crypto/base64";
import { apiRequest, ApiError } from "./client";

export { ApiError };

export interface TokenResponse {
  access_token: string;
  token_type: string;
}

export function login(email: string, authKey: Uint8Array): Promise<TokenResponse> {
  return apiRequest<TokenResponse>("/auth/login", {
    method: "POST",
    body: { email, auth_key: bytesToBase64(authKey) },
  });
}
