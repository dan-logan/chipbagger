// Firebase web app settings: Firebase console → Project settings → General → Your apps → SDK setup and configuration.
// These values are public by design; firestore.rules and storage.rules decide who can read and write.
// While projectId is empty, the public site keeps reading data/bags.csv.
export const firebaseConfig = {
  apiKey: '',
  authDomain: '',
  projectId: '',
  storageBucket: '',
  appId: '',
};

export const SDK_URL = 'https://www.gstatic.com/firebasejs/12.19.0';

// Local testing against the Firebase emulators: http://localhost:8000/?emulators (see README).
export const useEmulators = ['localhost', '127.0.0.1'].includes(location.hostname) &&
  new URLSearchParams(location.search).has('emulators');

export const appConfig = useEmulators
  ? { apiKey: 'demo-key', authDomain: 'localhost', projectId: 'demo-chipbagger', storageBucket: 'demo-chipbagger.appspot.com' }
  : firebaseConfig;

export const isConfigured = Boolean(appConfig.projectId);
