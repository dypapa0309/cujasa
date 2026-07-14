import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeXmlEntities, parseRssItems, splitPublisherSuffix } from './rssParser.js';

const SAMPLE_RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <title>테스트 피드</title>
  <item>
    <title><![CDATA[폭염에 전기요금 부담 &quot;비상&quot; - 연합뉴스]]></title>
    <link>https://news.example.com/a1</link>
    <pubDate>Mon, 14 Jul 2026 01:00:00 GMT</pubDate>
    <source url="https://yna.co.kr">연합뉴스</source>
    <description><![CDATA[<a href="#">폭염</a> 관련 &amp; 요약]]></description>
  </item>
  <item>
    <title>냉방비 절감 꿀팁 공개</title>
    <link>https://news.example.com/a2</link>
  </item>
  <item>
    <title>링크 없는 기사</title>
  </item>
</channel></rss>`;

test('parseRssItems extracts title/link/publisher/pubDate and skips linkless items', () => {
  const items = parseRssItems(SAMPLE_RSS);
  assert.equal(items.length, 2);
  assert.equal(items[0].title, '폭염에 전기요금 부담 "비상"');
  assert.equal(items[0].publisher, '연합뉴스');
  assert.equal(items[0].link, 'https://news.example.com/a1');
  assert.equal(items[0].publishedAt, '2026-07-14T01:00:00.000Z');
  assert.equal(items[0].description, '폭염 관련 & 요약');
  assert.equal(items[1].title, '냉방비 절감 꿀팁 공개');
  assert.equal(items[1].publisher, null);
  assert.equal(items[1].publishedAt, null);
});

test('splitPublisherSuffix splits Google News style publisher suffix', () => {
  assert.deepEqual(splitPublisherSuffix('제목입니다 - 조선일보'), { title: '제목입니다', publisher: '조선일보' });
  assert.deepEqual(splitPublisherSuffix('대시 없는 제목', '기본'), { title: '대시 없는 제목', publisher: '기본' });
});

test('decodeXmlEntities handles numeric and named entities', () => {
  assert.equal(decodeXmlEntities('&lt;b&gt;&amp;&#44608;&#xCE58;'), '<b>&김치');
});

test('parseRssItems returns empty array for garbage input', () => {
  assert.deepEqual(parseRssItems('not xml at all'), []);
  assert.deepEqual(parseRssItems(''), []);
});
