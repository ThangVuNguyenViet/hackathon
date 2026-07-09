const backendBaseUrl = 'https://kfc-agent-backend-demo.thangvnv0806.workers.dev';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/ready' || url.pathname.startsWith('/dashboard/')) {
      return proxyBackendRequest(request, url);
    }
    return env.ASSETS.fetch(request);
  },
};

async function proxyBackendRequest(request, url) {
  const target = new URL(backendBaseUrl);
  target.pathname = url.pathname;
  target.search = url.search;

  const headers = new Headers(request.headers);
  headers.delete('host');

  const response = await fetch(target.toString(), {
    method: request.method,
    headers,
    body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
    redirect: 'manual',
  });

  const responseHeaders = new Headers(response.headers);
  responseHeaders.delete('content-encoding');
  responseHeaders.delete('content-length');
  responseHeaders.set('access-control-allow-origin', '*');
  responseHeaders.set('access-control-allow-methods', 'GET,POST,OPTIONS');
  responseHeaders.set('access-control-allow-headers', 'Content-Type,Authorization');
  const body = request.method === 'HEAD' ? null : await response.arrayBuffer();

  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
  });
}
