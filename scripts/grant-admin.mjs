// Give a Google account permission to use /admin (sets the `admin` custom claim).
// The account must have signed in to /admin once first.
//   node grant-admin.mjs you@gmail.com            grant
//   node grant-admin.mjs you@gmail.com --revoke   remove
import { getAuth } from 'firebase-admin/auth';
import { app } from './firebase-app.mjs';

const email = process.argv[2];
const revoke = process.argv.includes('--revoke');
if (!email || email.startsWith('--')) {
  console.error('Usage: node grant-admin.mjs <email> [--revoke]');
  process.exit(1);
}

const auth = getAuth(app);
try {
  const user = await auth.getUserByEmail(email);
  const claims = { ...(user.customClaims || {}) };
  if (revoke) delete claims.admin; else claims.admin = true;
  await auth.setCustomUserClaims(user.uid, claims);
  console.log(`${revoke ? 'Revoked' : 'Granted'} admin for ${email}. Reload /admin/ to pick it up.`);
} catch (err) {
  if (err.code === 'auth/user-not-found') {
    console.error(`No account for ${email} yet. Sign in to /admin with it once, then run this again.`);
    process.exit(1);
  }
  throw err;
}
