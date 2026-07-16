/** API base URL is baked at build time (public — it is only a URL, never a secret). */
export const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "https://kv2x41mtz3.execute-api.us-east-2.amazonaws.com";

const TOKEN_KEY = "oracle-duval-access-token";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.sessionStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  if (typeof window !== "undefined") window.sessionStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  if (typeof window !== "undefined") window.sessionStorage.removeItem(TOKEN_KEY);
}
