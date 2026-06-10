/**
 * Central API access for the frontend.
 *
 * The backend lives on Cloud Run while the frontend is served from Vercel, so
 * every request must be prefixed with VITE_API_BASE (empty in local dev, where
 * the Vite middleware shares the Express origin).
 *
 * apiFetch also watches for the shared rate-limit engine's responses:
 *  - 429 (rate limit hit)   -> dispatches `gitlens:rate-limit` with queries_used
 *  - 503 with a paused body -> dispatches `gitlens:demo-paused` with the message
 * App.tsx listens for these events and renders the CTA modal / paused notice.
 */

export const API_BASE = (import.meta.env.VITE_API_BASE || '').replace(/\/$/, '');

export const apiUrl = (path: string) => `${API_BASE}${path}`;

export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const response = await fetch(apiUrl(path), init);

  if (response.status === 429 || response.status === 503) {
    try {
      const body = await response.clone().json();
      if (response.status === 429) {
        window.dispatchEvent(
          new CustomEvent('gitlens:rate-limit', {
            detail: { queriesUsed: body?.queries_used ?? body?.detail?.queries_used ?? 0 },
          })
        );
      } else if (body?.message && String(body.message).toLowerCase().includes('paused')) {
        window.dispatchEvent(
          new CustomEvent('gitlens:demo-paused', { detail: { message: body.message } })
        );
      }
    } catch {
      // Non-JSON 429/503 — let callers handle it as a normal error.
    }
  }

  return response;
}
