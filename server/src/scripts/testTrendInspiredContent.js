import 'dotenv/config';
import {
  buildTrendInspiredContentPreview
} from '../services/trendPatternService.js';

function parseArgs(argv = []) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    if (key === 'no-ai') {
      args.useAi = false;
      continue;
    }
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      args[key] = next;
      index += 1;
    } else {
      args[key] = true;
    }
  }
  return args;
}

function formatFlags(flags = []) {
  return flags.length ? flags.join(', ') : '없음';
}

function printSource(source = {}) {
  console.log('\n[수집 소스]');
  console.log(`provider: ${source.provider}${source.usedFallback ? ` (fallback: ${source.fallbackReason || source.requestedProvider || 'fixture'})` : ''}`);
  console.log(`candidates: ${source.samples?.length || 0}`);
  for (const sample of (source.samples || []).slice(0, 5)) {
    console.log(`- ${sample.id || 'unknown'} · ${sample.topicKeyword || 'topic 없음'} · 좋아요 ${sample.likes || 0} · 댓글 ${sample.replies || 0}`);
  }
}

function printPatterns(patterns = []) {
  console.log('\n[선택 패턴]');
  patterns.forEach((pattern, index) => {
    console.log(`${index + 1}. ${pattern.sourceId} · score ${pattern.performanceScore}`);
    console.log(`   hook: ${pattern.hookPattern}`);
    console.log(`   question: ${pattern.commentQuestion}`);
    console.log(`   tension: ${pattern.tensionType} · emotion: ${pattern.emotionSignal}`);
    console.log(`   safety: ${formatFlags(pattern.safetyFlags)}`);
  });
}

function printPosts(posts = []) {
  console.log('\n[CUJASA식 변주 글]');
  posts.forEach((post, index) => {
    console.log(`\n${index + 1}. ${post.contentType} · 댓글 유도 ${post.engagementScore}점 · ${post.engagementPattern}`);
    console.log(`   allowed: ${post.allowed ? 'yes' : 'no'} · similarityRisk: ${post.similarityRisk}`);
    console.log(`   safety: ${formatFlags(post.safetyFlags)}`);
    console.log('---');
    console.log(post.body);
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const preview = await buildTrendInspiredContentPreview({
    query: args.query || '자취 꿀템',
    contentScope: args.scope || args.contentScope || '생활용품',
    targetAudience: args.audience || args.targetAudience || '2030 자취생',
    productCategory: args.productCategory || args.category || '',
    provider: args.provider || process.env.TREND_SOURCE_PROVIDER || 'fixture',
    since: args.since || '24h',
    limit: Number(args.limit || 10),
    patternLimit: Number(args.patternLimit || 5),
    useAi: args.useAi !== false
  });

  console.log('[Trend Inspired Content Test]');
  console.log(`query: ${args.query || '자취 꿀템'}`);
  console.log(`scope: ${args.scope || args.contentScope || '생활용품'}`);
  console.log(`audience: ${args.audience || args.targetAudience || '2030 자취생'}`);
  console.log(`mode: ${args.useAi === false ? 'fixture/rule only' : 'AI with fallback'}`);
  printSource(preview.source);
  printPatterns(preview.patterns);
  printPosts(preview.posts);
}

main().catch((error) => {
  console.error('\n[trend content test failed]');
  console.error(error?.stack || error?.message || error);
  process.exitCode = 1;
});
