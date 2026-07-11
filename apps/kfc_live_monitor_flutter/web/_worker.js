export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/ready' || url.pathname.startsWith('/dashboard/')) {
      return proxyBackendRequest(request, env, url);
    }
    return env.ASSETS.fetch(request);
  },
};

function proxyBackendRequest(request, env, url) {
  if (!env.KFC_AGENT_BACKEND_URL) {
    return Response.json(
      { error: 'KFC_AGENT_BACKEND_URL is not configured' },
      { status: 503 },
    );
  }
  const target = new URL(url.pathname + url.search, env.KFC_AGENT_BACKEND_URL);
  return fetch(new Request(target, request));
}
