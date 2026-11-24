/**
 * RSS 2.0 rendering. Pure string building on purpose: thread titles, board
 * names and author names are all user input, so every value goes through
 * escapeXml() and the whole document is assembled in one place.
 */

export interface RssItem {
  title: string
  link: string
  pubDate: string
  /** plain text; Markdown has already been flattened by the caller */
  description: string
  author?: string
  category?: string
}

export interface RssChannel {
  title: string
  link: string
  description: string
  /** absolute URL of this feed, for atom:link rel="self" */
  selfUrl: string
  items: RssItem[]
}

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function itemXml(item: RssItem): string {
  const lines = [
    '    <item>',
    `      <title>${escapeXml(item.title)}</title>`,
    `      <link>${escapeXml(item.link)}</link>`,
    `      <guid isPermaLink="true">${escapeXml(item.link)}</guid>`,
    `      <pubDate>${escapeXml(item.pubDate)}</pubDate>`,
    `      <description>${escapeXml(item.description)}</description>`,
  ]
  if (item.author) lines.push(`      <dc:creator>${escapeXml(item.author)}</dc:creator>`)
  if (item.category) lines.push(`      <category>${escapeXml(item.category)}</category>`)
  lines.push('    </item>')
  return lines.join('\n')
}

export function buildRss(channel: RssChannel, now = new Date()): string {
  const items = channel.items.map(itemXml).join('\n')
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:atom="http://www.w3.org/2005/Atom">',
    '  <channel>',
    `    <title>${escapeXml(channel.title)}</title>`,
    `    <link>${escapeXml(channel.link)}</link>`,
    `    <description>${escapeXml(channel.description)}</description>`,
    '    <language>zh-CN</language>',
    `    <lastBuildDate>${now.toUTCString()}</lastBuildDate>`,
    '    <generator>BunForo</generator>',
    `    <atom:link href="${escapeXml(channel.selfUrl)}" rel="self" type="application/rss+xml" />`,
    ...(items ? [items] : []),
    '  </channel>',
    '</rss>',
    '',
  ].join('\n')
}
