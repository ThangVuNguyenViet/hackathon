Uri dashboardSocketUri(String baseUrl, {Uri? currentUri}) {
  final parsed = Uri.parse(baseUrl);
  final backend = parsed.hasAuthority
      ? parsed
      : (currentUri ?? Uri.base).resolveUri(parsed);
  return backend.replace(
    scheme: backend.scheme == 'https' ? 'wss' : 'ws',
    path: '/dashboard/socket',
    query: null,
    fragment: null,
  );
}
