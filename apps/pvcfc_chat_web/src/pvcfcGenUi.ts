export interface PvcfcGenUiAction {
  readonly label: string;
  readonly prompt: string;
}

export interface PvcfcGenUiModel {
  readonly kind: "evidence";
  readonly title: string;
  readonly summary: string;
  readonly points: readonly string[];
  readonly sources: readonly string[];
  readonly actions: readonly PvcfcGenUiAction[];
}

const URL_PATTERN = /https?:\/\/[^\s<>"']+/giu;
const TRAILING_URL_PUNCTUATION = /[),.;!?]+$/u;

const FOLLOW_UP_ACTIONS: readonly PvcfcGenUiAction[] = Object.freeze([
  {
    label: "So sánh sản phẩm",
    prompt:
      "So sánh hai sản phẩm PVCFC theo hồ sơ chính thức và dẫn nguồn cho từng điểm khác biệt.",
  },
  {
    label: "Tìm đại lý",
    prompt:
      "Tìm đại lý PVCFC phù hợp và dẫn nguồn chính thức cho thông tin liên hệ.",
  },
]);

function cleanUrl(value: string): string | undefined {
  const candidate = value.replace(TRAILING_URL_PUNCTUATION, "");
  try {
    const url = new URL(candidate);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}

export function extractPvcfcSourceUrls(text: string): readonly string[] {
  return Object.freeze(
    [...text.matchAll(URL_PATTERN)]
      .map(([url]) => cleanUrl(url))
      .filter((url): url is string => url !== undefined)
      .filter((url, index, urls) => urls.indexOf(url) === index)
      .slice(0, 5),
  );
}

function extractPoints(text: string): readonly string[] {
  const bulletPoints = text
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => /^[-•*]\s+/u.test(line))
    .map((line) => line.replace(/^[-•*]\s+/u, "").trim())
    .filter(Boolean)
    .slice(0, 5);
  if (bulletPoints.length > 0) return Object.freeze(bulletPoints);

  const paragraphs = text
    .split(/\r?\n\s*\r?\n/u)
    .map((paragraph) => paragraph.replace(URL_PATTERN, "").trim())
    .filter(Boolean)
    .slice(0, 3);
  return Object.freeze(paragraphs.length > 0 ? paragraphs : [text.trim()]);
}

export function createPvcfcGenUiModel(responseText: string): PvcfcGenUiModel {
  const normalizedText = responseText.trim();
  const points = extractPoints(normalizedText);
  const summary = (points[0] ?? normalizedText).slice(0, 280);

  return {
    kind: "evidence",
    title: "Bảng thông tin PVCFC",
    summary:
      summary.length < (points[0]?.length ?? 0)
        ? `${summary.trimEnd()}…`
        : summary,
    points,
    sources: extractPvcfcSourceUrls(normalizedText),
    actions: FOLLOW_UP_ACTIONS,
  };
}
