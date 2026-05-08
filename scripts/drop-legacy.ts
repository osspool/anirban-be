/**
 * One-shot legacy-data cleanup.
 *
 * Drops the BA `organization` plugin's collections — `organization`,
 * `member` (singular), `invitation`. The new design uses the plain
 * `Member` arc resource at `members` (plural), so the singular
 * collection is orphan data that no code reads anymore.
 *
 * Idempotent: silently skips collections that already don't exist.
 *
 * Run with:
 *   npx tsx scripts/drop-legacy.ts             # dry-run, prints plan
 *   npx tsx scripts/drop-legacy.ts --apply     # actually drops
 */

import '../src/config/env.js';
import mongoose from 'mongoose';
import config from '../src/config/index.js';

const LEGACY_COLLECTIONS = ['organization', 'member', 'invitation'] as const;

async function main() {
  const apply = process.argv.includes('--apply');

  await mongoose.connect(config.database.uri);
  const db = mongoose.connection.db!;
  const present = new Set((await db.listCollections().toArray()).map((c) => c.name));

  // biome-ignore lint/suspicious/noConsole: script
  console.log(
    `\n[drop-legacy] Database: ${db.databaseName}\n[drop-legacy] Mode: ${apply ? 'APPLY' : 'DRY-RUN (pass --apply to drop)'}\n`,
  );

  for (const name of LEGACY_COLLECTIONS) {
    if (!present.has(name)) {
      // biome-ignore lint/suspicious/noConsole: script
      console.log(`  - ${name.padEnd(15)} → not present, skipping`);
      continue;
    }
    const count = await db.collection(name).countDocuments();
    if (apply) {
      await db.collection(name).drop();
      // biome-ignore lint/suspicious/noConsole: script
      console.log(`  ✓ ${name.padEnd(15)} → DROPPED (${count} rows)`);
    } else {
      // biome-ignore lint/suspicious/noConsole: script
      console.log(`  ~ ${name.padEnd(15)} → would drop (${count} rows)`);
    }
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  // biome-ignore lint/suspicious/noConsole: script
  console.error(err);
  process.exit(1);
});
