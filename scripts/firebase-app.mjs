// Shared setup for the admin scripts. Credentials come from a service-account key:
//   GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json
// Against the emulators, set FIRESTORE_EMULATOR_HOST etc. and GCLOUD_PROJECT instead.
import { readFileSync } from 'node:fs';
import { initializeApp } from 'firebase-admin/app';

function projectId() {
  if (process.env.GCLOUD_PROJECT) return process.env.GCLOUD_PROJECT;
  const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!keyPath) {
    console.error('Set GOOGLE_APPLICATION_CREDENTIALS to your service-account key file (see README).');
    process.exit(1);
  }
  return JSON.parse(readFileSync(keyPath, 'utf8')).project_id;
}

export const PROJECT_ID = projectId();
export const app = initializeApp({ projectId: PROJECT_ID });
