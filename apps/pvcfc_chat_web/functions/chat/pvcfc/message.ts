const UPSTREAM_URL = 'http://165.154.229.65.nip.io/chat/pvcfc/message';

export const onRequestPost = async ({ request }: { request: Request }) => {
  try {
    const headers = new Headers();
    const contentType = request.headers.get('content-type');
    if (contentType) headers.set('content-type', contentType);

    const upstream = await fetch(UPSTREAM_URL, {
      method: 'POST',
      headers,
      body: request.body,
    });

    const responseHeaders = new Headers(upstream.headers);
    responseHeaders.set('cache-control', 'no-store');

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders,
    });
  } catch (error) {
    return Response.json(
      {
        message: 'PVCFC backend proxy unavailable',
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 502, headers: { 'cache-control': 'no-store' } },
    );
  }
};

export const onRequestOptions = () =>
  new Response(null, {
    status: 204,
    headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'Content-Type',
    },
  });
