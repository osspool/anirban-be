/**
 * Test fixtures — `make*` (in-memory builders) + `submit*` (HTTP submitters).
 *
 * Every builder takes `Partial<T>` so tests can override only what matters.
 * No fixture creates state directly in mongo — tests call the public API
 * via `app.inject` so the integration is real, not synthetic.
 */

import type { FastifyInstance } from 'fastify';

let _seq = 0;
const seq = () => ++_seq;

export interface MembershipRequestSeed {
  applicantName: string;
  email: string;
  phone?: string;
  imageUrl?: string;
  survivorStory: string;
}

export function makeMembershipRequest(
  overrides: Partial<MembershipRequestSeed> = {},
): MembershipRequestSeed {
  const n = seq();
  return {
    applicantName: `Survivor ${n}`,
    email: `applicant-${n}@example.com`,
    survivorStory: 'I escaped trafficking in 2024 and want to help others.',
    ...overrides,
  };
}

export async function submitMembershipRequest(
  app: FastifyInstance,
  overrides: Partial<MembershipRequestSeed> = {},
): Promise<{ statusCode: number; body: Record<string, unknown> }> {
  const payload = makeMembershipRequest(overrides);
  const res = await app.inject({
    method: 'POST',
    url: '/api/membership-requests',
    payload,
  });
  return {
    statusCode: res.statusCode,
    body: res.statusCode === 0 ? {} : (JSON.parse(res.body) as Record<string, unknown>),
  };
}

export interface SupportRequestSeed {
  submitterName?: string;
  submitterEmail?: string;
  submitterPhone?: string;
  category: 'trafficking_report' | 'child_marriage' | 'legal_help' | 'reintegration' | 'other';
  subject: string;
  description: string;
  attachmentUrls?: string[];
  priority?: 'low' | 'normal' | 'high' | 'urgent';
}

export function makeSupportRequest(
  overrides: Partial<SupportRequestSeed> = {},
): SupportRequestSeed {
  const n = seq();
  return {
    submitterName: `Reporter ${n}`,
    submitterEmail: `reporter-${n}@example.com`,
    category: 'trafficking_report',
    subject: `Suspected trafficking case #${n}`,
    description: 'Multiple young women being moved through a known route.',
    priority: 'high',
    ...overrides,
  };
}

export async function submitSupportRequest(
  app: FastifyInstance,
  overrides: Partial<SupportRequestSeed> = {},
): Promise<{ statusCode: number; body: Record<string, unknown> }> {
  const payload = makeSupportRequest(overrides);
  const res = await app.inject({
    method: 'POST',
    url: '/api/support-requests',
    payload,
  });
  return {
    statusCode: res.statusCode,
    body: res.statusCode === 0 ? {} : (JSON.parse(res.body) as Record<string, unknown>),
  };
}

// ─── CMS ─────────────────────────────────────────────────────────────────────

export interface CmsPageSeed {
  slug: string;
  locale: string;
  data: Record<string, unknown>;
  status?: 'draft' | 'published' | 'archived';
  defaultLocale?: string;
  metadata?: { title?: string; description?: string; keywords?: string[]; ogImage?: string };
}

export function makeCmsPage(overrides: Partial<CmsPageSeed> = {}): CmsPageSeed {
  const n = seq();
  return {
    slug: `test-page-${n}`,
    locale: 'en',
    data: { heading: `Test Page ${n}`, body: 'Sample content.' },
    ...overrides,
  };
}

/** PATCH upsert — creates the page + locale translation in one call. */
export async function upsertCmsPage(
  app: FastifyInstance,
  adminToken: string,
  overrides: Partial<CmsPageSeed> = {},
): Promise<{ statusCode: number; body: Record<string, unknown> }> {
  const { slug, ...payload } = makeCmsPage(overrides);
  const res = await app.inject({
    method: 'PATCH',
    url: `/api/cms/${slug}`,
    headers: { Authorization: `Bearer ${adminToken}` },
    payload,
  });
  return {
    statusCode: res.statusCode,
    body: res.statusCode === 0 ? {} : (JSON.parse(res.body) as Record<string, unknown>),
  };
}
