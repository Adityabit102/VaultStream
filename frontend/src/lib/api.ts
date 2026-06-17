import { supabase, isSupabaseMock } from './supabaseClient';

/** Central backend base URL — never hardcode localhost:8000 again. */
export const API_BASE =
  process.env.NEXT_PUBLIC_HTTP_API_URL || 'http://localhost:8000';

export const WS_BASE =
  process.env.NEXT_PUBLIC_WS_API_URL || 'ws://localhost:8000/ws/alerts';

export const apiUrl = (path: string) =>
  `${API_BASE}${path.startsWith('/') ? path : `/${path}`}`;

/**
 * Resolve the bearer token. In mock mode returns `mock-token-{role}`
 * (matching the backend dev bypass in auth.py). In production reads the
 * live Supabase access token.
 */
export async function getToken(role: string = 'viewer'): Promise<string> {
  if (!isSupabaseMock && supabase) {
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (session?.access_token) return session.access_token;
    } catch {
      /* fall through to mock */
    }
  }
  return `mock-token-${role}`;
}

/** Authenticated fetch helper. */
export async function apiFetch(
  path: string,
  opts: RequestInit & { role?: string } = {}
) {
  const { role = 'viewer', headers, ...rest } = opts;
  const token = await getToken(role);
  return fetch(apiUrl(path), {
    ...rest,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...headers,
    },
  });
}
