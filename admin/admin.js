// Chip Bagger admin: Google sign-in, then add, edit, rate and (soft-)delete bags.
// Access is enforced by firestore.rules / storage.rules (the `admin` custom claim); the checks here are only for the UI.
import { SDK_URL, appConfig, isConfigured, useEmulators } from '../js/firebase-config.js';

const PHOTO_MAX = 1200;   // longest side of the stored photo, px
const THUMB_MAX = 360;    // longest side of the thumbnail, px

const $ = sel => document.querySelector(sel);
const el = (tag, attrs = {}, ...children) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    node.append(c.nodeType ? c : document.createTextNode(c));
  }
  return node;
};

const NEW_PLACE = '__new__';

const state = {
  bags: [],
  places: {},
  brands: {},
  current: null,      // bag being edited, null when adding
  photo: null,        // newly picked File
  previewUrl: null,
  busy: false,
};

let fb;  // Firebase modules and handles, set in start()

// ---------- views & messages ----------

function show(view) {
  document.querySelectorAll('.view').forEach(v => { v.hidden = v.id !== `view-${view}`; });
  window.scrollTo(0, 0);
}

let statusTimer;
function flash(message, isError = false) {
  const box = $('#status');
  box.textContent = message;
  box.classList.toggle('error', isError);
  box.hidden = false;
  clearTimeout(statusTimer);
  if (!isError) statusTimer = setTimeout(() => { box.hidden = true; }, 4000);
}

function fail(err, what) {
  console.error(err);
  const denied = err && (err.code === 'permission-denied' || err.code === 'storage/unauthorized');
  flash(`${what} failed: ${denied ? 'permission denied.' : err.message || err}`, true);
}

// ---------- data ----------

const isRated = b => b.collectability != null && b.curb_appeal != null;
const millis = t => (t && t.toMillis ? t.toMillis() : 0);
const fmt = n => n == null ? '–' : String(n);

async function loadBags() {
  const { getDocs, collection } = fb.fs;
  const snap = await getDocs(collection(fb.db, 'bags'));
  state.bags = snap.docs.map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => millis(b.createdAt) - millis(a.createdAt));
}

async function loadOrigins() {
  try {
    const origins = await fetch('../data/origins.json', { cache: 'no-cache' }).then(r => r.json());
    state.places = origins.places || {};
    state.brands = origins.brands || {};
  } catch (err) {
    console.error('origins.json failed to load', err);
  }
  try {
    const snap = await fb.fs.getDocs(fb.fs.collection(fb.db, 'places'));
    snap.docs.forEach(d => { state.places[d.id] = d.data(); });
  } catch (err) {
    console.error('places failed to load', err);
  }
}

function brandDefaultPlace(brand) {
  const entry = state.brands[brand];
  const place = entry && state.places[entry.place];
  return place ? place.name : null;
}

// ---------- list ----------

function renderList() {
  const q = $('#search').value.trim().toLowerCase();
  const filter = $('#filter').value;
  const list = state.bags.filter(b => {
    if (filter === 'deleted' ? b.active : !b.active) return false;
    if (filter === 'unrated' && isRated(b)) return false;
    return !q || `${b.brand} ${b.flavor} ${b.notes || ''}`.toLowerCase().includes(q);
  });
  const total = state.bags.filter(b => b.active).length;
  const unrated = state.bags.filter(b => b.active && !isRated(b)).length;
  $('#list-count').textContent = `${list.length} shown · ${total} active · ${unrated} need rating`;
  $('#bag-list').replaceChildren(...list.map(b => el('li', {},
    el('a', { class: 'bag-row', href: `#bag/${b.id}` },
      b.thumbUrl || b.photoUrl
        ? el('img', { src: b.thumbUrl || b.photoUrl, alt: '', loading: 'lazy' })
        : el('div', { class: 'img-missing' }, '🥔'),
      el('span', { class: 'bag-row-text' },
        el('strong', {}, b.brand),
        el('span', {}, b.flavor || ' '),
        el('span', { class: 'bag-row-scores' },
          pill('Collect', b.collectability, 'pill-collect'),
          pill('Curb', b.curb_appeal, 'pill-curb')))))));
  if (!list.length) $('#bag-list').replaceChildren(el('li', { class: 'muted' }, 'No bags here.'));
}

function pill(label, value, cls) {
  return el('span', { class: `pill ${cls}${value == null ? ' pill-empty' : ''}` },
    el('span', { class: 'pill-label' }, label), ' ', fmt(value));
}

// ---------- editor ----------

function setRating(field, value) {
  const row = document.querySelector(`.rating[data-field="${field}"]`);
  row.classList.toggle('unset', value == null);
  row.querySelector('input').value = value ?? 5;
  row.querySelector('output').textContent = fmt(value);
}

function getRating(field) {
  const row = document.querySelector(`.rating[data-field="${field}"]`);
  return row.classList.contains('unset') ? null : Number(row.querySelector('input').value);
}

function setPreview(src) {
  const box = $('#photo-preview');
  box.replaceChildren(src ? el('img', { src, alt: 'Bag photo' }) : '🥔');
  $('#photo-label').textContent = src ? 'Replace photo' : 'Take or choose photo';
}

function renderMadeIn() {
  const select = $('#f-made-in');
  const keep = select.value;
  const def = brandDefaultPlace($('#f-brand').value.trim());
  const places = Object.entries(state.places).sort((a, b) => a[1].name.localeCompare(b[1].name));
  select.replaceChildren(
    el('option', { value: '' }, `Brand default (${def || 'unknown'})`),
    ...places.map(([key, p]) => el('option', { value: key }, p.name)),
    el('option', { value: NEW_PLACE }, '+ Add new location…'));
  select.value = keep;
  if (select.value !== keep) select.value = '';
  $('#new-place').hidden = select.value !== NEW_PLACE;
}

const slugify = s => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

async function lookupPlace() {
  const name = $('#np-name').value.trim();
  if (!name) { flash('Enter a location name first.', true); return; }
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&addressdetails=1&q=${encodeURIComponent(name)}`;
    const [hit] = await fetch(url).then(r => r.json());
    if (!hit) { flash('No match found. Enter coordinates manually.', true); return; }
    $('#np-lat').value = Number(hit.lat).toFixed(4);
    $('#np-lng').value = Number(hit.lon).toFixed(4);
    if (!$('#np-country').value.trim() && hit.address && hit.address.country) $('#np-country').value = hit.address.country;
  } catch (err) {
    flash('Lookup failed. Enter coordinates manually.', true);
  }
}

// Creates places/{key} for a location typed into the form and returns its key.
async function saveNewPlace() {
  const name = $('#np-name').value.trim();
  const country = $('#np-country').value.trim();
  const lat = parseFloat($('#np-lat').value);
  const lng = parseFloat($('#np-lng').value);
  const key = slugify(name);
  if (!name || !key) throw new Error('Enter a name for the new location.');
  if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) {
    throw new Error('Enter valid coordinates for the new location, or use Look up coordinates.');
  }
  if (!state.places[key]) {
    const place = { name, country, lat, lng };
    await fb.fs.setDoc(fb.fs.doc(fb.db, 'places', key), place);
    state.places[key] = place;
  }
  return key;
}

function openEditor(bag) {
  state.current = bag;
  state.photo = null;
  if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
  state.previewUrl = null;
  $('#photo').value = '';

  $('#edit-title').textContent = bag ? `${bag.brand}${bag.flavor ? ` · ${bag.flavor}` : ''}` : 'Add bag';
  $('#f-brand').value = bag ? bag.brand : '';
  $('#f-flavor').value = bag ? bag.flavor || '' : '';
  $('#f-notes').value = bag ? bag.notes || '' : '';
  renderMadeIn();
  $('#f-made-in').value = bag && bag.made_in && state.places[bag.made_in] ? bag.made_in : '';
  for (const id of ['#np-name', '#np-country', '#np-lat', '#np-lng']) $(id).value = '';
  $('#new-place').hidden = true;
  setRating('collectability', bag ? bag.collectability ?? null : null);
  setRating('curb_appeal', bag ? bag.curb_appeal ?? null : null);
  setPreview(bag ? bag.photoUrl || bag.thumbUrl : null);

  const deleted = Boolean(bag && !bag.active);
  $('#deleted-banner').hidden = !deleted;
  $('#delete').hidden = !bag || deleted;
  $('#restore').hidden = !deleted;
  $('#save-next').hidden = deleted;
  $('#edit-meta').textContent = bag && bag.updatedAt
    ? `Last saved ${bag.updatedAt.toDate().toLocaleString()}` : '';

  const brands = [...new Set(state.bags.map(b => b.brand))].sort((a, b) => a.localeCompare(b));
  $('#brand-options').replaceChildren(...brands.map(b => el('option', { value: b })));
  show('edit');
}

function setBusy(on, label) {
  state.busy = on;
  ['#save', '#save-next', '#delete', '#restore'].forEach(s => { $(s).disabled = on; });
  $('#save').textContent = on && label ? label : 'Save';
}

// Re-encode as JPEG at most `maxSide` px on the longest side. Browsers apply the EXIF
// orientation when drawing, and the canvas output carries no EXIF (so no GPS location).
async function resizeImage(file, maxSide, quality) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = el('canvas', {
      width: Math.round(img.naturalWidth * scale),
      height: Math.round(img.naturalHeight * scale),
    });
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (!blob) throw new Error('Could not process the photo.');
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function uploadImage(path, blob) {
  const { ref, uploadBytes, getDownloadURL } = fb.st;
  const r = ref(fb.storage, path);
  await uploadBytes(r, blob, { contentType: 'image/jpeg', cacheControl: 'public, max-age=31536000, immutable' });
  return getDownloadURL(r);
}

async function refreshBag(id) {
  const snap = await fb.fs.getDoc(fb.fs.doc(fb.db, 'bags', id));
  const fresh = { id, ...snap.data() };
  const i = state.bags.findIndex(b => b.id === id);
  if (i >= 0) state.bags[i] = fresh; else state.bags.unshift(fresh);
  return fresh;
}

async function save(goToNext) {
  if (state.busy) return;
  const brand = $('#f-brand').value.trim();
  if (!brand) { flash('Brand is required.', true); $('#f-brand').focus(); return; }

  const { doc, collection, setDoc, updateDoc, serverTimestamp } = fb.fs;
  const isNew = !state.current;
  const ref = isNew ? doc(collection(fb.db, 'bags')) : doc(fb.db, 'bags', state.current.id);
  let madeIn = $('#f-made-in').value;
  const data = {
    brand,
    flavor: $('#f-flavor').value.trim(),
    notes: $('#f-notes').value.trim(),
    made_in: madeIn,
    collectability: getRating('collectability'),
    curb_appeal: getRating('curb_appeal'),
    updatedAt: serverTimestamp(),
  };

  setBusy(true, 'Saving…');
  try {
    if (madeIn === NEW_PLACE) {
      madeIn = await saveNewPlace();
      data.made_in = madeIn;
    }
    let oldPaths = [];
    if (state.photo) {
      setBusy(true, 'Uploading photo…');
      const stamp = Date.now();
      const photoPath = `bags/${ref.id}-${stamp}.jpg`;
      const thumbPath = `thumbs/${ref.id}-${stamp}.jpg`;
      const [photo, thumb] = await Promise.all([
        resizeImage(state.photo, PHOTO_MAX, 0.85),
        resizeImage(state.photo, THUMB_MAX, 0.78),
      ]);
      const [photoUrl, thumbUrl] = await Promise.all([uploadImage(photoPath, photo), uploadImage(thumbPath, thumb)]);
      Object.assign(data, { photoUrl, thumbUrl, photoPath, thumbPath });
      if (!isNew) oldPaths = [state.current.photoPath, state.current.thumbPath].filter(Boolean);
      setBusy(true, 'Saving…');
    }
    if (isNew) await setDoc(ref, { ...data, active: true, createdAt: serverTimestamp() });
    else await updateDoc(ref, data);
    // The replaced photo is no longer referenced; removing it is best-effort.
    oldPaths.forEach(p => fb.st.deleteObject(fb.st.ref(fb.storage, p)).catch(err => console.warn('Old photo not removed', p, err)));

    const saved = await refreshBag(ref.id);
    flash(isNew ? `Added ${saved.brand} ${saved.flavor}.` : 'Saved.');
    if (goToNext) {
      const next = state.bags.find(b => b.active && !isRated(b) && b.id !== saved.id);
      if (next) { location.hash = `#bag/${next.id}`; return; }
      flash('Saved. Every active bag is rated.');
    }
    location.hash = '#';
  } catch (err) {
    fail(err, 'Save');
  } finally {
    setBusy(false);
  }
}

async function setActive(active) {
  const bag = state.current;
  if (!bag || state.busy) return;
  if (!active && !confirm(`Delete "${bag.brand} ${bag.flavor}"?\n\nIt will be hidden from the site. You can restore it from the Deleted filter.`)) return;
  const { doc, updateDoc, serverTimestamp, deleteField } = fb.fs;
  setBusy(true);
  try {
    await updateDoc(doc(fb.db, 'bags', bag.id), {
      active,
      deletedAt: active ? deleteField() : serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    await refreshBag(bag.id);
    flash(active ? `Restored ${bag.brand} ${bag.flavor}.` : `Deleted ${bag.brand} ${bag.flavor}.`);
    location.hash = '#';
  } catch (err) {
    fail(err, active ? 'Restore' : 'Delete');
  } finally {
    setBusy(false);
  }
}

// ---------- routing ----------

function route() {
  if (!fb || !fb.isAdmin) return;
  const hash = location.hash.slice(1);
  if (hash === 'new') return openEditor(null);
  if (hash.startsWith('bag/')) {
    const bag = state.bags.find(b => b.id === hash.slice(4));
    if (bag) return openEditor(bag);
    flash('That bag was not found.', true);
  }
  state.current = null;
  renderList();
  show('list');
}

// ---------- auth & startup ----------

async function onUser(user) {
  $('#account').hidden = !user;
  fb.isAdmin = false;
  if (!user) { show('signin'); return; }
  $('#account-email').textContent = user.email;
  const token = await user.getIdTokenResult(true);
  if (token.claims.admin !== true) {
    show('denied');
    return;
  }
  fb.isAdmin = true;
  show('loading');
  try {
    await Promise.all([loadBags(), loadOrigins()]);
  } catch (err) {
    fail(err, 'Loading bags');
    return;
  }
  route();
}

async function start() {
  if (!isConfigured) { show('setup'); return; }
  const [{ initializeApp }, auth, fs, st] = await Promise.all([
    import(`${SDK_URL}/firebase-app.js`),
    import(`${SDK_URL}/firebase-auth.js`),
    import(`${SDK_URL}/firebase-firestore.js`),
    import(`${SDK_URL}/firebase-storage.js`),
  ]);
  const app = initializeApp(appConfig);
  fb = { auth, fs, st, authInstance: auth.getAuth(app), db: fs.getFirestore(app), storage: st.getStorage(app), isAdmin: false };
  if (useEmulators) {
    auth.connectAuthEmulator(fb.authInstance, 'http://127.0.0.1:9099', { disableWarnings: true });
    fs.connectFirestoreEmulator(fb.db, '127.0.0.1', 8080);
    st.connectStorageEmulator(fb.storage, '127.0.0.1', 9199);
  }

  $('#sign-in').addEventListener('click', async () => {
    try {
      await auth.signInWithPopup(fb.authInstance, new auth.GoogleAuthProvider());
    } catch (err) {
      if (err.code !== 'auth/popup-closed-by-user' && err.code !== 'auth/cancelled-popup-request') fail(err, 'Sign-in');
    }
  });
  $('#sign-out').addEventListener('click', () => auth.signOut(fb.authInstance));

  $('#search').addEventListener('input', renderList);
  $('#filter').addEventListener('change', renderList);
  $('#f-brand').addEventListener('input', renderMadeIn);
  $('#f-made-in').addEventListener('change', () => { $('#new-place').hidden = $('#f-made-in').value !== NEW_PLACE; });
  $('#np-lookup').addEventListener('click', lookupPlace);
  $('#photo').addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    state.photo = file;
    if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
    state.previewUrl = URL.createObjectURL(file);
    setPreview(state.previewUrl);
  });
  document.querySelectorAll('.rating').forEach(row => {
    const field = row.dataset.field;
    const input = row.querySelector('input');
    ['input', 'change'].forEach(type => input.addEventListener(type, () => setRating(field, Number(input.value))));
    row.querySelector('.rating-clear').addEventListener('click', () => setRating(field, null));
  });
  $('#bag-form').addEventListener('submit', e => { e.preventDefault(); save(false); });
  $('#save-next').addEventListener('click', () => save(true));
  $('#delete').addEventListener('click', () => setActive(false));
  $('#restore').addEventListener('click', () => setActive(true));
  window.addEventListener('hashchange', route);

  auth.onAuthStateChanged(fb.authInstance, user => {
    onUser(user).catch(err => fail(err, 'Sign-in check'));
  });
}

start().catch(err => fail(err, 'Starting the admin'));
