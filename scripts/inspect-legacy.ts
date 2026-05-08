/**
 * One-shot DB inspector — counts rows in BA's legacy `organization` /
 * `member` (singular) / `invitation` collections and the canonical
 * `members` (plural, ours) collection so we can decide what to drop.
 *
 * Run with:
 *   npx tsx scripts/inspect-legacy.ts
 *
 * No writes. Read-only.
 */

import '../src/config/env.js';
import mongoose from 'mongoose';
import config from '../src/config/index.js';

async function main() {
  await mongoose.connect(config.database.uri);
  const db = mongoose.connection.db!;
  const cols = (await db.listCollections().toArray()).map((c) => c.name).sort();

  // biome-ignore lint/suspicious/noConsole: script
  console.log(`\nDatabase: ${db.databaseName}`);
  // biome-ignore lint/suspicious/noConsole: script
  console.log(`Collections: ${cols.join(', ')}\n`);

  const targets = [
    'organization', // legacy BA org plugin
    'member', // legacy BA member (singular)
    'invitation', // legacy BA invitation
    'members', // current plain Member resource (plural)
    'membershiprequests',
    'supportrequests',
    'user',
    'session',
    'account',
    'verification',
  ];
  for (const name of targets) {
    if (!cols.includes(name)) {
      // biome-ignore lint/suspicious/noConsole: script
      console.log(`  ${name.padEnd(22)} → (missing)`);
      continue;
    }
    const count = await db.collection(name).countDocuments();
    // biome-ignore lint/suspicious/noConsole: script
    console.log(`  ${name.padEnd(22)} → ${count} rows`);
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  // biome-ignore lint/suspicious/noConsole: script
  console.error(err);
  process.exit(1);
});
