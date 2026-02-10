/**
 * Proxy for POST /users/deposit with a long timeout (125s).
 * Soroban RPC (getCommitments, sendTransaction) can take 60–90s on testnet;
 * the default proxy/rewrite can close the connection (ECONNRESET). This route
 * forwards to the API with an explicit timeout so the client gets a proper response.
 */

// Server-side: backend API base URL (must be absolute; do not use /api)
const BACKEND_URL =
  process.env.API_BACKEND_URL ??
  (process.env.NEXT_PUBLIC_API_URL?.startsWith('http') ? process.env.NEXT_PUBLIC_API_URL : null) ??
  'http://localhost:3001';
const DEPOSIT_TIMEOUT_MS = 125_000;

export async function POST(request: Request) {
  const url = `${BACKEND_URL.replace(/\/$/, '')}/users/deposit`;
  const cookie = request.headers.get('cookie') ?? '';
  const body = await request.text();

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DEPOSIT_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie,
      },
      body: body || undefined,
      credentials: 'include',
      signal: controller.signal,
    });
    const data = await res.json().catch(() => ({}));
    return Response.json(data, { status: res.status });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const timedOut = message.includes('abort') || message.includes('timeout');
    return Response.json(
      {
        success: false,
        error: timedOut
          ? 'Deposit is taking longer than expected. Check the dashboard or try again in a moment.'
          : `Deposit request failed: ${message}`,
      },
      { status: 200 }
    );
  } finally {
    clearTimeout(timeoutId);
  }
}
