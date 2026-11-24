/**
 * Flattens Markdown into one line of plain text for previews. The notification
 * excerpt and the RSS description print this verbatim, so it must never be
 * injected as HTML: Markdown punctuation is stripped rather than rendered.
 */
export function plainText(markdown: string, max = 160): string {
  const flat = markdown
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '[图片]')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[`*_~>#]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return flat.length > max ? flat.slice(0, max - 1) + '…' : flat
}
