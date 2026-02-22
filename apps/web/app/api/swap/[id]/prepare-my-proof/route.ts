/**
 * Proxy for POST /swap/:id/prepare-my-proof with a long timeout.
 * Proof generation can take time (witness + groth16), and we want to avoid ECONNRESET
 * and non-JSON "Internal Server Error" responses at the browser.
 */

// Server-side: backend API base URL (must be absolute; do not use /api)
const BACKEND_URL =
  process.env.API_BACKEND_URL ??
  (process.env.NEXT_PUBLIC_API_URL?.startsWith('http') ? process.env.NEXT_PUBLIC_API_URL : null) ??
  'https://lop-main.onrender.com';

const TIMEOUT_MS = 300_000; // 5 min

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const url = `${BACKEND_URL.replace(/\/$/, '')}/swap/${encodeURIComponent(id)}/prepare-my-proof`;
  const cookie = request.headers.get('cookie') ?? '';

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { cookie },
      credentials: 'include',
      signal: controller.signal,
    });
    const text = await res.text();
    // Always respond with JSON to the client (avoid "Unexpected token I").
    try {
      const json = JSON.parse(text);
      return Response.json(json, { status: res.status });
    } catch {
      return Response.json(
        { ready: false, error: text || `Upstream error (HTTP ${res.status})` },
        { status: 200 },
      );
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const timedOut = message.includes('abort') || message.includes('timeout');
    return Response.json(
      {
        ready: false,
        error: timedOut ? 'Proof generation timed out. Try again.' : `Request failed: ${message}`,
      },
      { status: 200 },
    );
  } finally {
    clearTimeout(timeoutId);
  }
}

