/**
 * Foundation stats endpoint — `GET /api/members/summary`.
 *
 * The marketing site reads this for hero counters; the admin dashboard
 * reads it for the "Foundation reach" cards. The endpoint composes two
 * `$facet` Mongo pipelines (members + chapters). Test pins:
 *
 *   1. Shape — every field the FE reads is present and typed correctly.
 *   2. Empty state — fresh DB renders zeros, not undefined.
 *   3. Counts match real data after seeding through the standard CRUD.
 *   4. `isPubliclyListed: false` members are excluded from counts.
 *   5. Inactive / pending chapters are excluded from totalChapters.
 *   6. Distinct divisions = union across members + chapters (not just sum).
 *   7. Public route — no auth required.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { useIntegrationApp, type IntegrationCtx } from '../helpers/lifecycle.js';

interface FoundationSummary {
  totalMembers: number;
  totalChapters: number;
  distinctDivisions: number;
  distinctDistricts: number;
  byGender: { female: number; male: number; other: number };
  byDivision: Array<{ division: string; count: number }>;
  byDistrict: Array<{ districtLabel: string; count: number }>;
}

async function getSummary(ctx: IntegrationCtx): Promise<FoundationSummary> {
  const res = await ctx.app.inject({ method: 'GET', url: '/api/members/summary' });
  expect(res.statusCode).toBe(200);
  return JSON.parse(res.body) as FoundationSummary;
}

async function postMember(ctx: IntegrationCtx, data: Record<string, unknown>): Promise<void> {
  const res = await ctx.app.inject({
    method: 'POST',
    url: '/api/members',
    headers: ctx.auth.as('admin').headers,
    payload: { displayName: `M${Math.random().toString(36).slice(2, 8)}`, isPubliclyListed: true, ...data },
  });
  if (res.statusCode >= 400) {
    throw new Error(`postMember failed: ${res.statusCode} ${res.body.slice(0, 200)}`);
  }
}

async function postChapter(ctx: IntegrationCtx, data: Record<string, unknown>): Promise<void> {
  const res = await ctx.app.inject({
    method: 'POST',
    url: '/api/chapters',
    headers: ctx.auth.as('admin').headers,
    payload: { name: `C${Math.random().toString(36).slice(2, 8)}`, status: 'active', ...data },
  });
  if (res.statusCode >= 400) {
    throw new Error(`postChapter failed: ${res.statusCode} ${res.body.slice(0, 200)}`);
  }
}

describe('foundation stats summary', () => {
  let ctx: IntegrationCtx;

  beforeAll(async () => {
    ctx = await useIntegrationApp();
  });

  afterAll(async () => {
    await ctx?.close();
  });

  it('public endpoint — no auth required', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/members/summary' });
    expect(res.statusCode).toBe(200);
  });

  it('empty DB renders zeros across every field (no undefined)', async () => {
    const summary = await getSummary(ctx);
    expect(summary).toEqual({
      totalMembers: 0,
      totalChapters: 0,
      distinctDivisions: 0,
      distinctDistricts: 0,
      byGender: { female: 0, male: 0, other: 0 },
      byDivision: [],
      byDistrict: [],
    });
  });

  it('counts members through the standard POST surface', async () => {
    await postMember(ctx, { division: 'BDA', districtLabel: 'Barishal', gender: 'female' });
    await postMember(ctx, { division: 'BDA', districtLabel: 'Patuakhali', gender: 'female' });
    await postMember(ctx, { division: 'BDC', districtLabel: 'Dhaka', gender: 'male' });

    const summary = await getSummary(ctx);
    expect(summary.totalMembers).toBe(3);
    expect(summary.byGender.female).toBe(2);
    expect(summary.byGender.male).toBe(1);
    expect(summary.distinctDivisions).toBe(2);
    expect(summary.distinctDistricts).toBe(3);
  });

  it('returns sorted byDivision[] with per-division counts', async () => {
    const summary = await getSummary(ctx);
    expect(summary.byDivision).toEqual(
      expect.arrayContaining([
        { division: 'BDA', count: 2 },
        { division: 'BDC', count: 1 },
      ]),
    );
    // Sorted desc by count: BDA(2) before BDC(1)
    expect(summary.byDivision[0]?.division).toBe('BDA');
  });

  it('isPubliclyListed:false members are excluded', async () => {
    const before = await getSummary(ctx);
    await postMember(ctx, {
      division: 'BDH',
      districtLabel: 'Sylhet',
      gender: 'male',
      isPubliclyListed: false, // ← excluded
    });
    const after = await getSummary(ctx);

    expect(after.totalMembers).toBe(before.totalMembers); // unchanged
    expect(after.byGender.male).toBe(before.byGender.male); // unchanged
    // The Sylhet district shouldn't show up — un-listed members don't add districts.
    expect(after.byDistrict.find((d) => d.districtLabel === 'Sylhet')).toBeUndefined();
  });

  it('inactive chapters are excluded from totalChapters', async () => {
    await postChapter(ctx, { division: 'BDA', status: 'active' });
    await postChapter(ctx, { division: 'BDC', status: 'active' });
    await postChapter(ctx, { division: 'BDD', status: 'inactive' }); // ← excluded

    const summary = await getSummary(ctx);
    expect(summary.totalChapters).toBe(2);
  });

  it('distinctDivisions is the UNION of members + chapters (not sum)', async () => {
    // After above: members in BDA, BDC. Chapters in BDA, BDC.
    // Union = {BDA, BDC} = 2. NOT 4.
    const summary = await getSummary(ctx);
    expect(summary.distinctDivisions).toBe(2);

    // Add a chapter in a NEW division → union grows by 1.
    await postChapter(ctx, { division: 'BDF', status: 'active' });
    const after = await getSummary(ctx);
    expect(after.distinctDivisions).toBe(3);
  });

  it('shape: every field has the right type', async () => {
    const s = await getSummary(ctx);
    expect(typeof s.totalMembers).toBe('number');
    expect(typeof s.totalChapters).toBe('number');
    expect(typeof s.distinctDivisions).toBe('number');
    expect(typeof s.distinctDistricts).toBe('number');
    expect(typeof s.byGender.female).toBe('number');
    expect(typeof s.byGender.male).toBe('number');
    expect(typeof s.byGender.other).toBe('number');
    expect(Array.isArray(s.byDivision)).toBe(true);
    expect(Array.isArray(s.byDistrict)).toBe(true);
    for (const row of s.byDivision) {
      expect(typeof row.division).toBe('string');
      expect(typeof row.count).toBe('number');
    }
  });
});
