# Chip Bagger

A static site for Dan's potato chip bag collection ([@chip.bagger](https://www.instagram.com/chip.bagger/) on Instagram): every bag, a leaderboard for **collectability** and **curb appeal**, and a **chip map** of where the bags come from. No build step; it runs on GitHub Pages as-is.

## Run locally

```sh
python3 -m http.server
# open http://localhost:8000
```

(Opening `index.html` straight from disk won't load the data; browsers block `fetch` on `file://`.)

## Deploy on GitHub Pages

Settings → Pages → Source: **Deploy from a branch** → Branch: `main`, folder `/ (root)`. The site appears at `https://chipbagger.fun/` (custom domain) and is also accessible at `https://dan-logan.github.io/chipbagger/`.

## Data

Bags live in Firebase: **Firestore** (one document per bag in the `bags` collection) and **Storage** (photos in `bags/`, thumbnails in `thumbs/`). The public site reads only bags with `active == true`; deleting a bag in the admin just sets `active` to false, and it can be restored.

Until `js/firebase-config.js` is filled in, the site falls back to `data/bags.csv` and `images/`. Those stay in the repo as a backup until the migration is confirmed.

| File | What it holds |
| --- | --- |
| `js/firebase-config.js` | Firebase web app settings (public by design; the rules control access). |
| `firestore.rules`, `storage.rules` | Who can read and write. Anyone can read active bags and photos; only accounts with the `admin` claim can see deleted bags or change anything. Hard deletes are refused. |
| `admin/` | The admin page at `/admin/` (not linked from the site, marked `noindex`). |
| `scripts/` | `migrate.mjs` (one-time import of the CSV and photos) and `grant-admin.mjs` (gives an account admin access). |
| `data/origins.json` | Map locations (`places`) and which place each brand maps to (`brands`). `byNote` switches a brand's place when a bag's notes mention a word, e.g. Lay's bags marked "China" or "Taiwan". |
| `data/bags.csv`, `images/` | The pre-Firebase data. Only used while Firebase isn't configured. |

### Admin

Open `https://chipbagger.fun/admin/` and sign in with Google. From there you can add a bag (take or choose a photo; the phone shrinks it, makes the thumbnail and drops the photo's EXIF/GPS data before uploading), edit any bag, rate it (1–10 sliders; **Save & next** jumps to the next unrated bag), and delete or restore it (the **Deleted** filter lists deleted bags).

The admin is an installable app (PWA). On the phone, open `/admin/` in Chrome and choose **Install app** / **Add to Home screen**; it then launches full-screen from its own icon. Files: `admin/manifest.webmanifest`, `admin/sw.js`, `admin/icon-*.png`.

### Firebase setup (one time)

1. **Create the project.** [Firebase console](https://console.firebase.google.com/) → Add project → `chipbagger`. Analytics isn't needed.
2. **Upgrade to Blaze** (Storage requires it). Then in Google Cloud Billing → Budgets & alerts, add a budget of $1 so you get an email if it ever costs anything.
3. **Authentication** → Get started → Sign-in method → enable **Google**. Under Settings → Authorized domains, add `chipbagger.fun` and `dan-logan.github.io`.
4. **Firestore Database** → Create database → production mode → pick a US location.
5. **Storage** → Get started → production mode, same location.
6. **Rules.** Paste `firestore.rules` into Firestore → Rules and `storage.rules` into Storage → Rules, and publish both. (Or, with the Firebase CLI: `firebase deploy --only firestore:rules,storage --project <project-id>`.)
7. **Web app config.** Project settings → General → Your apps → add a Web app (no hosting). Copy `apiKey`, `authDomain`, `projectId`, `storageBucket` and `appId` into `js/firebase-config.js` and commit.
8. **Service-account key** (for the scripts, on your computer only). Project settings → Service accounts → Generate new private key. Keep the file outside the repo, and never commit it.
9. **Import the existing bags** (needs Node 20+):
   ```sh
   cd scripts
   npm install
   export GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json
   node migrate.mjs --dry-run   # check the list
   node migrate.mjs             # copies 170 bags and their photos; safe to re-run
   ```
10. **Make yourself admin.** Sign in once at `/admin/` (it will say "No access"), then run `node grant-admin.mjs you@gmail.com` and reload the page. The admin page deliberately shows no setup hints to anyone without access.

After that, check the public site shows every bag. Once you're happy, `data/bags.csv` and `images/bags`, `images/thumbs` can be removed from the repo.

### Testing locally with the emulators

```sh
npm install -g firebase-tools
firebase emulators:start --project demo-chipbagger      # needs Java
# in another terminal:
cd scripts && FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_STORAGE_EMULATOR_HOST=127.0.0.1:9199 \
  FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 GCLOUD_PROJECT=demo-chipbagger \
  node migrate.mjs --bucket demo-chipbagger.appspot.com
python3 -m http.server   # from the repo root
```

Then open `http://localhost:8000/?emulators` and `http://localhost:8000/admin/?emulators`. Grant admin with the same environment variables and `node grant-admin.mjs <emulator account email>`.

### Origins

A bag's location comes from its **Made in** setting (a key from `places` in `origins.json`) if set, otherwise from its brand. The brand locations are each company's home base or main plant, not necessarily the exact plant printed on every bag. Brands with no entry show up under "Origin unknown" on the map page.

## Credits

Colors and logo (`images/brand/logo.svg`) follow the @chip.bagger Instagram logo: navy `#334788`, orange `#f4a641`. They're set as variables at the top of `css/style.css`.

Map: [Leaflet](https://leafletjs.com/) (vendored in `vendor/leaflet`, BSD-2-Clause). The map uses no tile server and no API key: country and US state outlines are bundled in `vendor/geo` (from [world-atlas](https://github.com/topojson/world-atlas) and [us-atlas](https://github.com/topojson/us-atlas), Natural Earth / US Census data, ISC license) and drawn with [topojson-client](https://github.com/topojson/topojson-client) (ISC).
