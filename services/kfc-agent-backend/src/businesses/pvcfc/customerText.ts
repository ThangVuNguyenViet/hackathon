/**
 * Converts model-authored Markdown into the plain text contract used by the
 * PVCFC chat surfaces. Official source URLs remain literal so citation checks
 * and clients can keep them clickable without rendering Markdown.
 */
export function normalizePvcfcCustomerText(value: string): string {
  return value
    .replace(/\r\n?/g, '\n')
    .replace(/^[ \t]*```[^\n]*$/gm, '')
    .replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, '')
    .replace(/^[ \t]{0,3}>[ \t]?/gm, '')
    .replace(/^[ \t]*[-+*][ \t]+/gm, '• ')
    .replace(/^[ \t]*(?:[-*_][ \t]*){3,}$/gm, '')
    .replace(/^[ \t]*\|?(?:[ \t]*:?-{3,}:?[ \t]*\|)+[ \t]*$/gm, '')
    .replace(/^[ \t]*\|(.+)\|[ \t]*$/gm, (_match, cells: string) =>
      cells
        .split('|')
        .map((cell) => cell.trim())
        .filter(Boolean)
        .join(' — '),
    )
    .replace(
      /!?\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g,
      (_match, label: string, url: string) => `${label.trim()}: ${url}`,
    )
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')
    .replace(/__([^_\n]+)__/g, '$1')
    .replace(/~~([^~\n]+)~~/g, '$1')
    .replace(/(^|[\s([{])\*([^*\n]+)\*(?=$|[\s)\]},.!?:;])/gm, '$1$2')
    .replace(/(^|[\s([{])_([^_\n]+)_(?=$|[\s)\]},.!?:;])/gm, '$1$2')
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
