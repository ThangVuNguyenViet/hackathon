const PVCFC_MESSAGE_PATH = "/chat/pvcfc/message";

export function resolvePvcfcMessageEndpoint(
  configuredBaseUrl: string | undefined,
): string {
  const candidate = configuredBaseUrl?.trim();
  if (!candidate) return PVCFC_MESSAGE_PATH;

  let baseUrl: URL;
  try {
    baseUrl = new URL(candidate);
  } catch {
    throw new Error("pvcfc_api_base_url_invalid");
  }

  const isLocalHttp =
    baseUrl.protocol === "http:" &&
    (baseUrl.hostname === "localhost" || baseUrl.hostname === "127.0.0.1");
  if (
    (baseUrl.protocol !== "https:" && !isLocalHttp) ||
    baseUrl.username ||
    baseUrl.password ||
    baseUrl.search ||
    baseUrl.hash ||
    (baseUrl.pathname !== "/" && baseUrl.pathname !== "")
  ) {
    throw new Error("pvcfc_api_base_url_invalid");
  }

  return `${baseUrl.origin}${PVCFC_MESSAGE_PATH}`;
}
