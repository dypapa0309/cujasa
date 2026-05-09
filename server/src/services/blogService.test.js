import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createAccount } from './accountService.js';
import { ensureAccountBlog, listAccountBlogPosts, maybeGenerateBlogPostForQueue } from './blogService.js';
import { dbInsert, dbUpdate } from './supabaseService.js';

async function createBlogTestAccount(name = '블로그 테스트 계정') {
  const projectId = randomUUID();
  await dbInsert('projects', {
    id: projectId,
    name: `${name} 프로젝트`,
    type: 'coupang',
    status: 'active'
  });
  return createAccount({
    project_id: projectId,
    name,
    account_handle: `@blog_${randomUUID().slice(0, 8)}`,
    target_audience: '테스트 고객',
    content_scope: '테스트 콘텐츠'
  });
}

test('ensureAccountBlog creates an idempotent account blog URL', async () => {
  const account = await createBlogTestAccount('자체 블로그 계정');

  const created = await ensureAccountBlog(account.id);
  const again = await ensureAccountBlog(account.id);

  assert.equal(created.blog_enabled, true);
  assert.ok(created.blog_slug);
  assert.ok(created.blog_public_url.includes(`/blog/a/${created.blog_slug}`));
  assert.equal(again.blog_slug, created.blog_slug);
  assert.equal(again.blog_public_url, created.blog_public_url);
});

test('ensureAccountBlog rejects inactive accounts', async () => {
  const account = await createBlogTestAccount('비활성 블로그 계정');
  await dbUpdate('accounts', { id: account.id }, { status: 'paused' });

  await assert.rejects(
    () => ensureAccountBlog(account.id),
    (error) => error.status === 409
  );
});

test('account blog listing only returns posts for that account', async () => {
  const first = await ensureAccountBlog((await createBlogTestAccount('첫 블로그')).id);
  const second = await ensureAccountBlog((await createBlogTestAccount('둘째 블로그')).id);

  await dbInsert('blog_posts', {
    account_id: first.id,
    slug: `first-${randomUUID()}`,
    title: '첫 블로그 글',
    meta_description: '첫 계정 글',
    content: '<p>첫 글</p>',
    status: 'published'
  });
  await dbInsert('blog_posts', {
    account_id: second.id,
    slug: `second-${randomUUID()}`,
    title: '둘째 블로그 글',
    meta_description: '둘째 계정 글',
    content: '<p>둘째 글</p>',
    status: 'published'
  });

  const { account, posts } = await listAccountBlogPosts(first.blog_slug);

  assert.equal(account.id, first.id);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].title, '첫 블로그 글');
});

test('maybeGenerateBlogPostForQueue requires account blog to be enabled', async () => {
  const account = await createBlogTestAccount('블로그 자동 발행 차단 계정');
  const result = await maybeGenerateBlogPostForQueue({
    account: { ...account, blog_auto_publish_enabled: true, blog_enabled: false },
    post: { id: randomUUID(), topic_id: randomUUID() },
    queue: { id: randomUUID() }
  });

  assert.equal(result, null);
});
