Uri dashboardSocketUri(String baseUrl) {
  final backend = Uri.parse(baseUrl);
  return backend.replace(
    scheme: backend.scheme == 'https' ? 'wss' : 'ws',
    path: '/dashboard/socket',
    query: null,
    fragment: null,
  );
}
