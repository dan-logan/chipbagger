// Google Analytics via Firebase, public site only. Skipped locally and against the emulators; failures never affect the page.
import { SDK_URL, appConfig, isConfigured, useEmulators } from './firebase-config.js';

const isLocal = ['localhost', '127.0.0.1'].includes(location.hostname);

if (isConfigured && appConfig.measurementId && !useEmulators && !isLocal) {
  try {
    const [{ initializeApp, getApps }, { getAnalytics, isSupported }] = await Promise.all([
      import(`${SDK_URL}/firebase-app.js`),
      import(`${SDK_URL}/firebase-analytics.js`),
    ]);
    if (await isSupported()) getAnalytics(getApps()[0] || initializeApp(appConfig));
  } catch (err) {
    console.warn('Analytics not loaded', err);
  }
}
