/**
 * CMS resource integration tests.
 *
 * Covers:
 *   1. Admin creates a page via PATCH upsert
 *   2. Public GET with ?locale returns locale-resolved content
 *   3. Locale fallback chain (requested → defaultLocale → 'en')
 *   4. Draft pages are hidden from the public ?locale endpoint
 *   5. PATCH updates an existing locale without touching others
 *   6. PATCH auto-stamps publishedAt when status transitions to published
 *   7. Admin GET without locale returns full document (all translations)
 *   8. Admin list returns all pages
 *   9. Unauthenticated writes are rejected
 *  10. Soft-delete hides page from admin list
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { useIntegrationApp, type IntegrationCtx } from '../helpers/lifecycle.js';
import { upsertCmsPage } from '../helpers/fixtures.js';

interface CmsDoc {
  slug: string;
  status: string;
  defaultLocale: string;
  publishedAt?: string;
  translations: Array<{ locale: string; data: unknown }>;
}

interface LocaleView {
  slug: string;
  locale: string;
  data: unknown;
  metadata?: unknown;
}

describe('cms resource', () => {
  let ctx: IntegrationCtx;

  beforeAll(async () => {
    ctx = await useIntegrationApp();
  });

  afterAll(async () => {
    await ctx?.close();
  });

  // ── CRUD basics ─────────────────────────────────────────────────────────────

  it('admin can create a page via PATCH upsert', async () => {
    const { statusCode, body } = await upsertCmsPage(ctx.app, ctx.users.admin.token, {
      slug: 'referral',
      locale: 'en',
      data: { heading: 'Refer a Survivor', cta: 'Learn More' },
      status: 'published',
    });

    expect(statusCode).toBe(200);
    expect(body.slug).toBe('referral');
    expect(body.status).toBe('published');
    const translations = body.translations as CmsDoc['translations'];
    expect(translations).toHaveLength(1);
    expect(translations[0].locale).toBe('en');
    expect((translations[0].data as Record<string, string>).heading).toBe('Refer a Survivor');
  });

  it('public GET with ?locale returns locale-resolved content', async () => {
    await upsertCmsPage(ctx.app, ctx.users.admin.token, {
      slug: 'onboard',
      locale: 'en',
      data: { title: 'Welcome', steps: ['Sign up', 'Join a chapter'] },
      status: 'published',
    });

    const res = await ctx.app.inject({ method: 'GET', url: '/api/cms/onboard?locale=en' });
    expect(res.statusCode).toBe(200);

    // arc unwraps the controller's `{ data }` envelope — body IS the view.
    const body = JSON.parse(res.body) as LocaleView;
    expect(body.slug).toBe('onboard');
    expect(body.locale).toBe('en');
    expect((body.data as Record<string, string>).title).toBe('Welcome');
  });

  it('PATCH updates an existing locale without touching other locales', async () => {
    const slug = 'multi-locale-page';

    // Create with English
    await upsertCmsPage(ctx.app, ctx.users.admin.token, {
      slug,
      locale: 'en',
      data: { title: 'English Title' },
      status: 'published',
    });

    // Add Bengali
    await upsertCmsPage(ctx.app, ctx.users.admin.token, {
      slug,
      locale: 'bn',
      data: { title: 'বাংলা শিরোনাম' },
    });

    // Update only English
    await ctx.app.inject({
      method: 'PATCH',
      url: `/api/cms/${slug}`,
      headers: ctx.auth.as('admin').headers,
      payload: { locale: 'en', data: { title: 'Updated English Title' } },
    });

    // Verify Bengali is untouched
    const res = await ctx.app.inject({ method: 'GET', url: `/api/cms/${slug}?locale=bn` });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as LocaleView;
    expect((body.data as Record<string, string>).title).toBe('বাংলা শিরোনাম');

    // Verify English update
    const enRes = await ctx.app.inject({ method: 'GET', url: `/api/cms/${slug}?locale=en` });
    const enBody = JSON.parse(enRes.body) as LocaleView;
    expect((enBody.data as Record<string, string>).title).toBe('Updated English Title');
  });

  // ── Locale fallback ──────────────────────────────────────────────────────────

  it('falls back to defaultLocale when requested locale is missing', async () => {
    await upsertCmsPage(ctx.app, ctx.users.admin.token, {
      slug: 'fallback-test',
      locale: 'en',
      data: { message: 'English fallback' },
      status: 'published',
      defaultLocale: 'en',
    });

    // Request 'bn' which doesn't exist — should fall back to 'en'
    const res = await ctx.app.inject({ method: 'GET', url: '/api/cms/fallback-test?locale=bn' });
    expect(res.statusCode).toBe(200);

    const body = JSON.parse(res.body) as LocaleView;
    expect(body.locale).toBe('en');
    expect((body.data as Record<string, string>).message).toBe('English fallback');
  });

  it('falls back to first available translation when all chain locales are missing', async () => {
    const slug = 'bn-only-page';

    // Only Bengali exists, defaultLocale is 'en' which also doesn't exist
    await upsertCmsPage(ctx.app, ctx.users.admin.token, {
      slug,
      locale: 'bn',
      data: { message: 'শুধু বাংলা' },
      status: 'published',
      defaultLocale: 'en',
    });

    // Request 'fr' — chain: fr → en → first available (bn)
    const res = await ctx.app.inject({ method: 'GET', url: `/api/cms/${slug}?locale=fr` });
    expect(res.statusCode).toBe(200);

    const body = JSON.parse(res.body) as LocaleView;
    expect(body.locale).toBe('bn');
  });

  // ── Status / visibility ──────────────────────────────────────────────────────

  it('draft page returns 404 on the public ?locale endpoint', async () => {
    await upsertCmsPage(ctx.app, ctx.users.admin.token, {
      slug: 'draft-page',
      locale: 'en',
      data: { title: 'Not yet live' },
      status: 'draft',
    });

    const res = await ctx.app.inject({ method: 'GET', url: '/api/cms/draft-page?locale=en' });
    expect(res.statusCode).toBe(404);
  });

  it('stamps publishedAt when status transitions to published', async () => {
    const slug = 'publish-stamp-test';

    // Create as draft
    await upsertCmsPage(ctx.app, ctx.users.admin.token, {
      slug,
      locale: 'en',
      data: { title: 'Draft Content' },
      status: 'draft',
    });

    // Publish it
    const res = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/cms/${slug}`,
      headers: ctx.auth.as('admin').headers,
      payload: { locale: 'en', data: { title: 'Live Content' }, status: 'published' },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as CmsDoc;
    expect(body.publishedAt).toBeTruthy();
  });

  it('does not overwrite publishedAt when publishing again', async () => {
    const slug = 'idempotent-publish';

    const first = await upsertCmsPage(ctx.app, ctx.users.admin.token, {
      slug,
      locale: 'en',
      data: { v: 1 },
      status: 'published',
    });
    const firstPublishedAt = (first.body as CmsDoc).publishedAt;

    // Small delay then publish again
    await new Promise((r) => setTimeout(r, 5));

    const second = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/cms/${slug}`,
      headers: ctx.auth.as('admin').headers,
      payload: { locale: 'en', data: { v: 2 }, status: 'published' },
    });
    const secondPublishedAt = (JSON.parse(second.body) as CmsDoc).publishedAt;

    expect(secondPublishedAt).toBe(firstPublishedAt);
  });

  // ── Admin surface ────────────────────────────────────────────────────────────

  it('admin GET without locale returns full document with all translations', async () => {
    await upsertCmsPage(ctx.app, ctx.users.admin.token, {
      slug: 'full-doc-test',
      locale: 'en',
      data: { x: 1 },
      status: 'draft',
    });

    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/cms/full-doc-test',
      headers: ctx.auth.as('admin').headers,
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as CmsDoc;
    // Full doc has translations array, not a resolved locale view
    expect(Array.isArray(body.translations)).toBe(true);
    expect(body.status).toBe('draft');
  });

  it('admin list returns pages', async () => {
    await upsertCmsPage(ctx.app, ctx.users.admin.token, {
      slug: 'list-test-page',
      locale: 'en',
      data: {},
    });

    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/cms',
      headers: ctx.auth.as('admin').headers,
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { data: CmsDoc[] };
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBeGreaterThan(0);
  });

  it('admin list can filter by status', async () => {
    await upsertCmsPage(ctx.app, ctx.users.admin.token, {
      slug: 'filter-published',
      locale: 'en',
      data: {},
      status: 'published',
    });

    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/cms?status=published',
      headers: ctx.auth.as('admin').headers,
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { data: CmsDoc[] };
    expect(body.data.every((p) => p.status === 'published')).toBe(true);
  });

  // ── Permissions ──────────────────────────────────────────────────────────────

  it('unauthenticated PATCH is rejected', async () => {
    const res = await ctx.app.inject({
      method: 'PATCH',
      url: '/api/cms/anon-write-test',
      payload: { locale: 'en', data: { x: 1 } },
    });
    expect([401, 403]).toContain(res.statusCode);
  });

  it('general member cannot write CMS pages', async () => {
    const res = await ctx.app.inject({
      method: 'PATCH',
      url: '/api/cms/general-write-test',
      headers: ctx.auth.as('general').headers,
      payload: { locale: 'en', data: { x: 1 } },
    });
    expect(res.statusCode).toBe(403);
  });

  it('unauthenticated list is rejected', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/cms' });
    expect([401, 403]).toContain(res.statusCode);
  });

  it('GET without locale on non-existent slug returns 404', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/cms/does-not-exist' });
    expect(res.statusCode).toBe(404);
  });

  // ── Hard delete by slug ──────────────────────────────────────────────────────
  // Regression: the resource binds `idField: 'slug'`. Without the matching
  // option on the Repository constructor, Mongo's deleteById hashes on
  // `_id`, fails to cast the slug, and 404s. This test pins both halves.

  it('admin deletes a page by slug — row is truly gone', async () => {
    const slug = 'hard-delete-test';
    await upsertCmsPage(ctx.app, ctx.users.admin.token, { slug, locale: 'en', data: { x: 1 } });

    // Confirm it exists before delete (admin GET = full doc, status='draft').
    const preDel = await ctx.app.inject({
      method: 'GET',
      url: `/api/cms/${slug}`,
      headers: ctx.auth.as('admin').headers,
    });
    expect(preDel.statusCode).toBe(200);

    const del = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/cms/${slug}`,
      headers: ctx.auth.as('admin').headers,
    });
    expect([200, 204]).toContain(del.statusCode);

    // Subsequent admin GET 404s — proof of hard delete (not soft).
    const postDel = await ctx.app.inject({
      method: 'GET',
      url: `/api/cms/${slug}`,
      headers: ctx.auth.as('admin').headers,
    });
    expect(postDel.statusCode).toBe(404);

    // And it disappears from the list.
    const list = await ctx.app.inject({
      method: 'GET',
      url: '/api/cms',
      headers: ctx.auth.as('admin').headers,
    });
    const body = JSON.parse(list.body) as { data: CmsDoc[] };
    expect(body.data.find((p) => p.slug === slug)).toBeUndefined();
  });

  it('DELETE on non-existent slug returns 404', async () => {
    const res = await ctx.app.inject({
      method: 'DELETE',
      url: '/api/cms/never-existed',
      headers: ctx.auth.as('admin').headers,
    });
    expect(res.statusCode).toBe(404);
  });
});
