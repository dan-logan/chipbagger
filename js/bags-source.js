// Public read of the collection: only active bags (soft-deleted ones are hidden, and firestore.rules refuses them).
import { SDK_URL, appConfig, isConfigured, useEmulators } from './firebase-config.js';

export { isConfigured };

export async function fetchBags() {
  const [{ initializeApp }, fs] = await Promise.all([
    import(`${SDK_URL}/firebase-app.js`),
    import(`${SDK_URL}/firebase-firestore-lite.js`),
  ]);
  const db = fs.getFirestore(initializeApp(appConfig));
  if (useEmulators) fs.connectFirestoreEmulator(db, '127.0.0.1', 8080);
  const snap = await fs.getDocs(fs.query(fs.collection(db, 'bags'), fs.where('active', '==', true)));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}
