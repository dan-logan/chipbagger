// One-time rename of the `collectability` score to `originality` on every bag in Firestore.
//   node rename-originality.mjs --dry-run   show which bags would change
//   node rename-originality.mjs             rename (bags already renamed are skipped; safe to re-run)
// Run it before deploying the firestore.rules that only accept `originality`.
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { app, PROJECT_ID } from './firebase-app.mjs';

const dryRun = process.argv.includes('--dry-run');
const db = getFirestore(app);

const snap = await db.collection('bags').get();
const todo = snap.docs.filter(d => 'collectability' in d.data());
console.log(`Project ${PROJECT_ID}: ${snap.size} bags, ${todo.length} to rename${dryRun ? ' (dry run)' : ''}`);

// Firestore batches hold at most 500 writes.
for (let i = 0; i < todo.length; i += 500) {
  const batch = db.batch();
  for (const d of todo.slice(i, i + 500)) {
    const data = d.data();
    const originality = data.originality ?? data.collectability ?? null;
    if (dryRun) { console.log(`  ${d.id}: ${originality ?? 'unrated'}`); continue; }
    batch.update(d.ref, { originality, collectability: FieldValue.delete() });
  }
  if (!dryRun) await batch.commit();
}

console.log(dryRun ? 'Dry run, nothing written.' : `Done: ${todo.length} renamed.`);
