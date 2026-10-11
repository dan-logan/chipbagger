// One-time copy of data/bags.csv and images/bags/ into Firestore and Firebase Storage.
//   node migrate.mjs --dry-run     show what would be imported
//   node migrate.mjs               import (bags already in Firestore are skipped)
//   node migrate.mjs --force       re-import and overwrite bags already in Firestore
//   --bucket <name>                Storage bucket, if not <project-id>.firebasestorage.app
// Photos are re-encoded: resized, rotated upright, and stripped of EXIF data (including GPS location).
import { readFile, access } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import vm from 'node:vm';
import sharp from 'sharp';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { app, PROJECT_ID } from './firebase-app.mjs';

const PHOTO_MAX = 1200;
const THUMB_MAX = 360;

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const force = args.includes('--force');
const bucketArg = args.includes('--bucket') ? args[args.indexOf('--bucket') + 1] : null;
const bucketName = bucketArg || `${PROJECT_ID}.firebasestorage.app`;

const root = new URL('../', import.meta.url);

// Reuse the site's CSV parser (js/csv.js assigns window.CSV).
async function loadCsvParser() {
  const context = { window: {} };
  vm.runInNewContext(await readFile(new URL('js/csv.js', root), 'utf8'), context);
  return context.window.CSV;
}

const slug = s => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);

function score(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) && n >= 1 && n <= 10 ? n : null;
}

async function exists(url) {
  try { await access(url); return true; } catch { return false; }
}

function downloadUrl(path, token) {
  const host = process.env.FIREBASE_STORAGE_EMULATOR_HOST
    ? `http://${process.env.FIREBASE_STORAGE_EMULATOR_HOST}` : 'https://firebasestorage.googleapis.com';
  return `${host}/v0/b/${bucketName}/o/${encodeURIComponent(path)}?alt=media&token=${token}`;
}

async function upload(bucket, path, buffer) {
  const token = randomUUID();
  await bucket.file(path).save(buffer, {
    resumable: false,
    contentType: 'image/jpeg',
    metadata: { cacheControl: 'public, max-age=31536000, immutable', metadata: { firebaseStorageDownloadTokens: token } },
  });
  return downloadUrl(path, token);
}

const resize = (input, max, quality) => sharp(input).rotate()
  .resize(max, max, { fit: 'inside', withoutEnlargement: true })
  .jpeg({ quality, mozjpeg: true })
  .toBuffer();

async function main() {
  const CSV = await loadCsvParser();
  const rows = CSV.parse(await readFile(new URL('data/bags.csv', root), 'utf8'));
  const db = getFirestore(app);
  const bucket = getStorage(app).bucket(bucketName);
  console.log(`Project ${PROJECT_ID}, bucket ${bucketName}: ${rows.length} bags in data/bags.csv${dryRun ? ' (dry run)' : ''}`);

  // Keep the CSV order as "newest added" order: later rows get later createdAt values.
  const base = Date.now() - rows.length * 1000;
  const used = new Set();
  const counts = { imported: 0, skipped: 0, noPhoto: 0 };

  for (const [i, row] of rows.entries()) {
    let id = slug(`${row.brand} ${row.flavor}`) || `bag-${i + 1}`;
    for (let n = 2; used.has(id); n++) id = `${slug(`${row.brand} ${row.flavor}`)}-${n}`;
    used.add(id);

    const ref = db.collection('bags').doc(id);
    if (!force && !dryRun && (await ref.get()).exists) { counts.skipped++; continue; }

    const file = (row.picture || '').split('/').pop();
    const photoFile = file ? new URL(`images/bags/${file}`, root) : null;
    const hasPhoto = photoFile && await exists(photoFile);
    if (!hasPhoto) { counts.noPhoto++; console.warn(`  no photo for ${id}${file ? ` (${file})` : ''}`); }

    const data = {
      brand: row.brand,
      flavor: row.flavor || '',
      notes: row.notes || '',
      made_in: row.made_in || '',
      originality: score(row.originality),
      curb_appeal: score(row.curb_appeal),
      active: true,
      createdAt: Timestamp.fromMillis(base + i * 1000),
      updatedAt: Timestamp.now(),
    };

    if (dryRun) { console.log(`  ${id}${hasPhoto ? '' : ' (no photo)'}`); counts.imported++; continue; }

    if (hasPhoto) {
      const original = await readFile(photoFile);
      const photoPath = `bags/${id}.jpg`;
      const thumbPath = `thumbs/${id}.jpg`;
      const [photo, thumb] = await Promise.all([resize(original, PHOTO_MAX, 85), resize(original, THUMB_MAX, 78)]);
      const [photoUrl, thumbUrl] = await Promise.all([upload(bucket, photoPath, photo), upload(bucket, thumbPath, thumb)]);
      Object.assign(data, { photoUrl, thumbUrl, photoPath, thumbPath });
    }
    await ref.set(data);
    counts.imported++;
    console.log(`  ${i + 1}/${rows.length} ${id}`);
  }

  console.log(`Done: ${counts.imported} ${dryRun ? 'to import' : 'imported'}, ${counts.skipped} already there, ${counts.noPhoto} without a photo.`);
}

main().catch(err => { console.error(err); process.exit(1); });
