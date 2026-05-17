/**
 * Foundation stats — single composite summary for public hero blocks.
 *
 * Returns every counter the marketing site needs in one shot:
 *
 *   {
 *     totalMembers:      number,  // public-listed only
 *     totalChapters:     number,  // active status only
 *     distinctDivisions: number,  // union of divisions covered by members OR chapters
 *     distinctDistricts: number,  // members with a non-null districtLabel
 *     byGender: { female, male, other },
 *   }
 *
 * Two Mongo aggregation pipelines (one per collection) — cheaper than
 * issuing 4+ HTTP calls from the FE and composing client-side. Mounted at
 * `GET /api/members/summary` by `member.resource.ts`.
 *
 * If both collections are empty, every counter is zero — the FE renders
 * the labels with `0` rather than collapsing the hero strip.
 */

import Member from '#resources/member/member.model.js';
import Chapter from '#resources/chapter/chapter.model.js';

export interface FoundationSummary {
  totalMembers: number;
  totalChapters: number;
  distinctDivisions: number;
  distinctDistricts: number;
  byGender: { female: number; male: number; other: number };
  /** Per-division member counts, descending by count. Members with no
   *  division are excluded. */
  byDivision: Array<{ division: string; count: number }>;
  /** Per-district member counts, descending. Members with no district excluded. */
  byDistrict: Array<{ districtLabel: string; count: number }>;
}

interface MemberAggResult {
  totalMembers: { count: number }[];
  byDivision: { _id: string | null; count: number }[];
  byDistrict: { _id: string | null; count: number }[];
  byGender: { _id: string | null; count: number }[];
}

interface ChapterAggResult {
  totalChapters: { count: number }[];
  chapterDivisions: { _id: string | null }[];
}

export async function getFoundationSummary(): Promise<FoundationSummary> {
  // Single $facet per collection runs all sub-pipelines in one round trip.
  // `match: isPubliclyListed:true` keeps unlisted survivors out of public
  // counts; same gate the public list endpoint uses.
  const [memberAgg, chapterAgg] = await Promise.all([
    Member.aggregate<MemberAggResult>([
      { $match: { isPubliclyListed: true } },
      {
        $facet: {
          totalMembers: [{ $count: 'count' }],
          // Group with `count` so we get both the breakdown AND the
          // distinct-division count (= byDivision.length) from one facet.
          byDivision: [
            { $match: { division: { $ne: null } } },
            { $group: { _id: '$division', count: { $sum: 1 } } },
            { $sort: { count: -1 } },
          ],
          byDistrict: [
            { $match: { districtLabel: { $ne: null } } },
            { $group: { _id: '$districtLabel', count: { $sum: 1 } } },
            { $sort: { count: -1 } },
          ],
          byGender: [{ $group: { _id: '$gender', count: { $sum: 1 } } }],
        },
      },
    ]),
    Chapter.aggregate<ChapterAggResult>([
      { $match: { status: 'active' } },
      {
        $facet: {
          totalChapters: [{ $count: 'count' }],
          chapterDivisions: [
            { $match: { division: { $ne: null } } },
            { $group: { _id: '$division' } },
          ],
        },
      },
    ]),
  ]);

  const m = memberAgg[0] ?? {
    totalMembers: [],
    byDivision: [],
    byDistrict: [],
    byGender: [],
  };
  const c = chapterAgg[0] ?? { totalChapters: [], chapterDivisions: [] };

  const female = m.byGender.find((b) => b._id === 'female')?.count ?? 0;
  const male = m.byGender.find((b) => b._id === 'male')?.count ?? 0;
  const other = m.byGender
    .filter((b) => b._id !== 'female' && b._id !== 'male' && b._id != null)
    .reduce((s, b) => s + b.count, 0);

  const divisions = new Set<string>();
  m.byDivision.forEach((d) => d._id && divisions.add(d._id));
  c.chapterDivisions.forEach((d) => d._id && divisions.add(d._id));

  return {
    totalMembers: m.totalMembers[0]?.count ?? 0,
    totalChapters: c.totalChapters[0]?.count ?? 0,
    distinctDivisions: divisions.size,
    distinctDistricts: m.byDistrict.length,
    byGender: { female, male, other },
    byDivision: m.byDivision
      .filter((d): d is { _id: string; count: number } => d._id != null)
      .map((d) => ({ division: d._id, count: d.count })),
    byDistrict: m.byDistrict
      .filter((d): d is { _id: string; count: number } => d._id != null)
      .map((d) => ({ districtLabel: d._id, count: d.count })),
  };
}
