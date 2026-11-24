/**
 * RSS rendering is pure, so it needs no database. The important assertions are
 * structural: user-supplied titles/authors/boards must never escape the markup.
 */
import { describe, expect, test } from 'bun:test'
import { plainText } from '../src/server/plaintext'
import { buildRss, escapeXml } from '../src/server/rss'

describe('escapeXml', () => {
  test('escapes every markup-significant character', () => {
    expect(escapeXml(`a & b < c > d " e ' f`)).toBe(
      'a &amp; b &lt; c &gt; d &quot; e &apos; f',
    )
  })
})

describe('buildRss', () => {
  const now = new Date('2026-11-24T00:00:00.000Z')

  test('renders one item with escaped user text', () => {
    const xml = buildRss(
      {
        title: 'A & B',
        link: 'https://forum.example.com/',
        description: 'board <desc>',
        selfUrl: 'https://forum.example.com/feed.xml',
        items: [
          {
            title: '<script>alert(1)</script>',
            link: 'https://forum.example.com/t/7',
            pubDate: 'Tue, 24 Nov 2026 00:00:00 GMT',
            description: 'a < b & c',
            author: 'A "quoted" name',
            category: 'General',
          },
        ],
      },
      now,
    )

    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>')
    expect(xml).toContain('<rss version="2.0"')
    expect(xml).toContain('<title>A &amp; B</title>')
    expect(xml).toContain('<description>board &lt;desc&gt;</description>')
    expect(xml).toContain('<lastBuildDate>Tue, 24 Nov 2026 00:00:00 GMT</lastBuildDate>')
    expect(xml).toContain('<link>https://forum.example.com/t/7</link>')
    expect(xml).toContain('<guid isPermaLink="true">https://forum.example.com/t/7</guid>')
    expect(xml).toContain('<dc:creator>A &quot;quoted&quot; name</dc:creator>')
    expect(xml).toContain('<category>General</category>')
    expect(xml).toContain('<description>a &lt; b &amp; c</description>')
    expect(xml).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    // The payload must never appear as a real tag.
    expect(xml).not.toContain('<script>')
    expect((xml.match(/<item>/g) ?? []).length).toBe(1)
  })

  test('an empty feed omits items but keeps the channel', () => {
    const xml = buildRss(
      {
        title: 'Empty',
        link: 'https://forum.example.com/',
        description: '',
        selfUrl: 'https://forum.example.com/feed.xml',
        items: [],
      },
      now,
    )
    expect(xml).not.toContain('<item>')
    expect(xml).toContain('</channel>')
  })
})

describe('plainText', () => {
  test('flattens markdown and clips long bodies', () => {
    expect(plainText('**bold** and [link](https://x.test) and ![img](/a.png)')).toBe(
      'bold and link and [图片]',
    )
    const long = plainText('x'.repeat(200), 20)
    expect(long.length).toBe(20)
    expect(long.endsWith('…')).toBe(true)
    expect(plainText('a\n\nb   c')).toBe('a b c')
  })
})
