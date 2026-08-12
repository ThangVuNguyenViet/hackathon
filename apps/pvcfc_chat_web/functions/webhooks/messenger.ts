const UPSTREAM_URL =
  'https://pvcfc-chatbot.165-154-229-65.sslip.io/webhooks/messenger';

/**
 * Keep Meta on a stable Cloudflare-hosted DNS name while the PVCFC runtime
 * remains on SCloud. The proxy deliberately forwards the raw request body so
 * Messenger signature verification remains authoritative in the backend.
 */
export const onRequest = async ({ request }: { request: Request }) => {
  try {
    const upstreamUrl = new URL(UPSTREAM_URL);
    upstreamUrl.search = new URL(request.url).search;
    const headers = new Headers(request.headers);
    headers.delete('host');
    headers.delete('content-length');

    const upstream = await fetch(upstreamUrl, {
      method: request.method,
      headers,
      body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
    });

    const responseHeaders = new Headers(upstream.headers);
    responseHeaders.set('cache-control', 'no-store');
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders,
    });
  } catch {
    return Response.json(
      { message: 'PVCFC Messenger backend proxy unavailable' },
      { status: 502, headers: { 'cache-control': 'no-store' } },
    );
  }
};
