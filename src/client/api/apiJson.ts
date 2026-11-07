import { apiFetch, UserSession } from '../context/AuthContext.js';

export async function apiJson<T = any>(
  path: string, 
  options: RequestInit = {}, 
  session?: UserSession | null
): Promise<T> {
  const res = await apiFetch(path, options, session);
  if (!res.ok) {
    let errBody: any;
    try {
      errBody = await res.json();
    } catch {
      errBody = { error: res.statusText || 'Request failed' };
    }
    throw new Error(errBody.error || `HTTP ${res.status}: ${res.statusText}`);
  }
  return (await res.json()) as T;
}
