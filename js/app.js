(() => {
  'use strict';

  const BOARD_SIZE = 10;

  const state = {
    bags: [],
    places: {},
    brands: {},
    map: null,
    boardExpanded: {},
  };

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

  // ---------- data ----------

  // CSV rows name a photo in images/; Firestore bags carry their own Storage URLs.
  const imagePath = (picture, dir) => picture ? `images/${dir}/` + encodeURIComponent(picture.split('/').pop()) : '';

  function parseScore(v) {
    const n = parseFloat(v);
    return Number.isFinite(n) && n > 0 ? Math.min(10, n) : null;
  }

  function overall(bag) {
    const a = bag.originality, b = bag.curb_appeal;
    return a != null && b != null ? (a + b) / 2 : null;
  }

  function placeFor(bag) {
    if (bag.made_in && state.places[bag.made_in]) return { key: bag.made_in, ...state.places[bag.made_in] };
    const brand = state.brands[bag.brand];
    if (!brand) return null;
    let key = brand.place;
    if (brand.byNote) {
      const hay = `${bag.notes} ${bag.flavor}`.toLowerCase();
      for (const [needle, alt] of Object.entries(brand.byNote)) {
        if (hay.includes(needle.toLowerCase())) { key = alt; break; }
      }
    }
    return key && state.places[key] ? { key, ...state.places[key] } : null;
  }

  async function loadBagRows() {
    const source = await import('./bags-source.js');
    if (source.isConfigured) {
      return (await source.fetchBags()).map(b => ({ ...b, order: b.createdAt ? b.createdAt.toMillis() : 0 }));
    }
    // Firebase isn't set up yet: read the CSV in the repo.
    const text = await fetch('data/bags.csv', { cache: 'no-cache' }).then(r => r.text());
    return CSV.parse(text).map((row, i) => ({
      ...row, order: i, photoUrl: imagePath(row.picture, 'bags'), thumbUrl: imagePath(row.picture, 'thumbs'),
    }));
  }

  async function loadData() {
    const [rows, origins] = await Promise.all([
      loadBagRows(),
      fetch('data/origins.json', { cache: 'no-cache' }).then(r => r.json()),
    ]);
    state.places = origins.places || {};
    state.brands = origins.brands || {};
    try {
      const source = await import('./bags-source.js');
      if (source.isConfigured) Object.assign(state.places, await source.fetchPlaces());
    } catch (err) {
      console.warn('Custom places not loaded', err);
    }
    state.bags = rows.map(row => ({
      ...row,
      brand: row.brand || '',
      flavor: row.flavor || '',
      notes: row.notes || '',
      made_in: row.made_in || '',
      originality: parseScore(row.originality),
      curb_appeal: parseScore(row.curb_appeal),
    }));
    state.bags.forEach(b => { b.place = placeFor(b); });
  }

  // ---------- shared pieces ----------

  // Some ad blockers (e.g. Proton VPN's NetShield) block firebasestorage.googleapis.com, so Storage photos are
  // requested through our own subdomain first (cloudflare/image-proxy.js), then directly if that fails.
  const IMAGE_PROXY = 'https://img.chipbagger.fun';
  function imageSources(url) {
    if (!url) return [];
    const m = /^https:\/\/firebasestorage\.googleapis\.com\/v0\/b\/[^/]+\/o\/([^?#]+)/.exec(url);
    if (!m) return [url];
    const path = decodeURIComponent(m[1]).split('/').map(encodeURIComponent).join('/');
    return [`${IMAGE_PROXY}/${path}`, url];
  }

  function bagImage(bag, cls = '', full = false) {
    // A photo may not have a thumbnail yet: fall back to the full image, then to a placeholder.
    const srcs = full ? imageSources(bag.photoUrl) : [...imageSources(bag.thumbUrl), ...imageSources(bag.photoUrl)];
    if (!srcs.length) return el('div', { class: `img-missing ${cls}` }, '🥔');
    // The detail view is shown at once inside a <dialog>; lazy loading there can leave the image unfetched.
    const img = el('img', { src: srcs[0], alt: `${bag.brand} ${bag.flavor} bag`, loading: full ? 'eager' : 'lazy', class: cls });
    let tried = 0;
    img.addEventListener('error', function onError() {
      if (++tried < srcs.length) { img.src = srcs[tried]; return; }
      img.removeEventListener('error', onError);
      img.replaceWith(el('div', { class: `img-missing ${cls}` }, '🥔'));
    });
    return img;
  }

  const fmt = n => n == null ? '–' : (Math.round(n * 10) / 10).toString();

  function scorePill(label, value, cls) {
    return el('span', { class: `pill ${cls}${value == null ? ' pill-empty' : ''}`, title: label },
      el('span', { class: 'pill-label' }, label), ' ', fmt(value));
  }

  function renderStats() {
    const bags = state.bags;
    const brands = new Set(bags.map(b => b.brand));
    const countries = new Set(bags.map(b => b.place && b.place.country).filter(Boolean));
    const rated = bags.filter(b => overall(b) != null).length;
    const stat = (n, label) => el('div', { class: 'stat' }, el('strong', {}, String(n)), el('span', {}, label));
    $('#stats').replaceChildren(
      stat(bags.length, 'bags'),
      stat(brands.size, 'brands'),
      stat(countries.size, countries.size === 1 ? 'country' : 'countries'),
      stat(rated, 'fully rated'),
    );
  }

  // ---------- collection ----------

  function renderBrandFilter() {
    const counts = {};
    state.bags.forEach(b => { counts[b.brand] = (counts[b.brand] || 0) + 1; });
    const sel = $('#brand-filter');
    Object.keys(counts).sort((a, b) => a.localeCompare(b)).forEach(brand => {
      sel.append(el('option', { value: brand }, `${brand} (${counts[brand]})`));
    });
  }

  function renderGrid() {
    const q = $('#search').value.trim().toLowerCase();
    const brand = $('#brand-filter').value;
    const sort = $('#sort').value;
    let list = state.bags.filter(b =>
      (!brand || b.brand === brand) &&
      (!q || `${b.brand} ${b.flavor} ${b.notes} ${b.place ? b.place.name : ''}`.toLowerCase().includes(q)));
    const byScore = f => (a, b) => (b[f] ?? -1) - (a[f] ?? -1) || a.brand.localeCompare(b.brand);
    list.sort({
      added: (a, b) => b.order - a.order,
      brand: (a, b) => a.brand.localeCompare(b.brand) || a.flavor.localeCompare(b.flavor),
      originality: byScore('originality'),
      curb: byScore('curb_appeal'),
    }[sort]);

    $('#result-count').textContent = `${list.length} of ${state.bags.length} bags`;
    $('#grid').replaceChildren(...list.map(bag => el('button', { class: 'card', type: 'button', onclick: () => openBag(bag) },
      el('div', { class: 'card-img' }, bagImage(bag)),
      el('div', { class: 'card-body' },
        el('div', { class: 'card-brand' }, bag.brand),
        el('div', { class: 'card-flavor' }, bag.flavor),
        bag.notes ? el('div', { class: 'card-notes' }, bag.notes) : null,
        el('div', { class: 'card-scores' },
          scorePill('Originality', bag.originality, 'pill-originality'),
          scorePill('Curb', bag.curb_appeal, 'pill-curb')),
      ))));
  }

  // ---------- bag detail ----------

  function openBag(bag) {
    $('#bag-detail').replaceChildren(
      el('div', { class: 'detail' },
        el('div', { class: 'detail-img' }, bagImage(bag, '', true)),
        el('div', { class: 'detail-body' },
          el('div', { class: 'card-brand' }, bag.brand),
          el('h2', {}, bag.flavor),
          bag.notes ? el('p', { class: 'muted' }, bag.notes) : null,
          el('dl', { class: 'facts' },
            el('dt', {}, 'Made in'), el('dd', {}, bag.place ? bag.place.name : 'Unknown'),
            el('dt', {}, 'Originality'), el('dd', {}, scoreBar(bag.originality, 'bar-originality')),
            el('dt', {}, 'Curb appeal'), el('dd', {}, scoreBar(bag.curb_appeal, 'bar-curb')),
          ),
          scoreGuide(),
        )));
    const dlg = $('#bag-dialog');
    if (!dlg.open) dlg.showModal();
  }

  function scoreGuide() {
    const term = (name, intro, items) => el('div', { class: 'guide-term' },
      el('h3', {}, name),
      el('p', {}, intro),
      items ? el('ul', {}, items.map(([label, text]) => el('li', {}, el('strong', {}, label + ': '), text))) : null);
    return el('details', { class: 'score-guide' },
      el('summary', {}, 'What do Originality and Curb Appeal mean?'),
      term('Curb Appeal', 'Shelf presence: whether the bag grabs you from six feet away. It includes:', [
        ['Artistry', 'illustration, photography, overall visual craft.'],
        ['Typography & logo', 'lettering, wordmark, how well the type is handled.'],
        ['Color', 'palette strength and how well it signals the flavor.'],
        ['Back-of-bag', 'copy, brand story, extra art.'],
      ]),
      term('Originality', 'How much the bag stands apart from the generic chip-bag look. It includes:', [
        ['Distinct identity', 'a look, concept, or brand voice you wouldn’t mistake for any other bag.'],
        ['Flavor naming', 'creativity of the name (“Mama Zuma’s Revenge” vs. “Original”).'],
        ['Collabs & special editions', 'limited runs and crossovers like Rap Snacks or Wawa Hoagiefest, judged by how inventive they are rather than how scarce.'],
        ['Regional character', 'a bag that clearly reflects where it’s from, whether a local or international market.'],
      ]));
  }

  function scoreBar(value, cls) {
    return el('span', { class: 'scorebar' },
      el('span', { class: `scorebar-track` }, el('span', { class: `scorebar-fill ${cls}`, style: `width:${(value || 0) * 10}%` })),
      el('span', { class: 'scorebar-num' }, value == null ? 'Not rated' : `${fmt(value)}/10`));
  }

  // ---------- leaderboard ----------

  function boardRow(rank, bag, value, cls) {
    return el('li', { class: 'board-row' },
      el('span', { class: `rank rank-${rank}` }, String(rank)),
      el('button', { class: 'board-bag', type: 'button', onclick: () => openBag(bag) },
        bagImage(bag, 'thumb'),
        el('span', { class: 'board-name' }, el('strong', {}, bag.brand), el('span', {}, bag.flavor))),
      el('span', { class: 'board-score' },
        el('span', { class: 'mini-track' }, el('span', { class: `mini-fill ${cls}`, style: `width:${value * 10}%` })),
        el('b', {}, fmt(value))));
  }

  function renderBoard(listEl, id, valueOf, cls) {
    const ranked = state.bags
      .map(b => ({ b, v: valueOf(b) }))
      .filter(x => x.v != null)
      .sort((x, y) => y.v - x.v || x.b.brand.localeCompare(y.b.brand));
    if (!ranked.length) {
      listEl.replaceChildren(el('li', { class: 'empty' }, 'No ratings yet.'));
      return;
    }
    const shown = state.boardExpanded[id] ? ranked : ranked.slice(0, BOARD_SIZE);
    // Standard competition ranking: ties share a rank.
    let lastV = null, lastRank = 0;
    const rows = shown.map((x, i) => {
      const rank = x.v === lastV ? lastRank : i + 1;
      lastV = x.v; lastRank = rank;
      return boardRow(rank, x.b, x.v, cls);
    });
    if (ranked.length > BOARD_SIZE) {
      rows.push(el('li', { class: 'board-more' }, el('button', {
        class: 'link', type: 'button',
        onclick: () => { state.boardExpanded[id] = !state.boardExpanded[id]; renderLeaderboard(); },
      }, state.boardExpanded[id] ? 'Show top 10' : `Show all ${ranked.length}`)));
    }
    listEl.replaceChildren(...rows);
  }

  function renderBrandBoard() {
    const groups = {};
    state.bags.forEach(b => {
      const v = overall(b);
      if (v == null) return;
      (groups[b.brand] = groups[b.brand] || []).push(v);
    });
    const ranked = Object.entries(groups)
      .filter(([, vs]) => vs.length >= 2)
      .map(([brand, vs]) => ({ brand, n: vs.length, v: vs.reduce((a, c) => a + c, 0) / vs.length }))
      .sort((a, b) => b.v - a.v)
      .slice(0, BOARD_SIZE);
    const list = $('#board-brands');
    if (!ranked.length) { list.replaceChildren(el('li', { class: 'empty' }, 'Needs at least two fully rated bags from a brand.')); return; }
    list.replaceChildren(...ranked.map((r, i) => el('li', { class: 'board-row' },
      el('span', { class: `rank rank-${i + 1}` }, String(i + 1)),
      el('span', { class: 'board-name' }, el('strong', {}, r.brand), el('span', {}, `${r.n} rated bags`)),
      el('span', { class: 'board-score' },
        el('span', { class: 'mini-track' }, el('span', { class: 'mini-fill bar-overall', style: `width:${r.v * 10}%` })),
        el('b', {}, fmt(r.v))))));
  }

  function renderLeaderboard() {
    renderBoard($('#board-originality'), 'originality', b => b.originality, 'bar-originality');
    renderBoard($('#board-curb'), 'curb', b => b.curb_appeal, 'bar-curb');
    renderBoard($('#board-overall'), 'overall', overall, 'bar-overall');
    renderBrandBoard();
  }

  // ---------- map ----------

  function renderMap() {
    const byPlace = {};
    const unknown = [];
    state.bags.forEach(b => {
      if (!b.place) { unknown.push(b); return; }
      (byPlace[b.place.key] = byPlace[b.place.key] || { place: b.place, bags: [] }).bags.push(b);
    });
    const groups = Object.values(byPlace).sort((a, b) => b.bags.length - a.bags.length);

    if (!state.map && window.L) {
      // No tile server: the base map is drawn from bundled country/state outlines,
      // so it needs no API key and no third-party requests.
      state.map = L.map('chip-map', { scrollWheelZoom: false, zoomSnap: 0.5, minZoom: 0, maxZoom: 9, attributionControl: true })
        .setView([35, -40], 2);
      state.map.attributionControl.setPrefix(false).addAttribution('Outlines: <a href="https://www.naturalearthdata.com/">Natural Earth</a>');
      state.map.createPane('basemap').style.zIndex = 200;
      drawBaseMap(state.map);
      const max = Math.max(...groups.map(g => g.bags.length));
      const pin = mapColors();
      // Largest first, so smaller dots sit on top and win taps where they overlap.
      groups.forEach(g => {
        const r = 6 + 16 * Math.sqrt(g.bags.length / max);
        const ll = [g.place.lat, g.place.lng];
        // Small dots are too small to tap on a phone, so each dot gets an invisible
        // hit circle at least MIN_HIT_RADIUS px that carries the tooltip and popup.
        const hit = L.circleMarker(ll, {
          radius: Math.max(r, MIN_HIT_RADIUS), stroke: false, fillColor: pin.pinFill, fillOpacity: 0,
        }).addTo(state.map);
        L.circleMarker(ll, {
          radius: r, color: pin.pinStroke, weight: 3, fillColor: pin.pinFill, fillOpacity: 0.95, interactive: false,
        }).addTo(state.map);
        hit.bindTooltip(`${g.place.name}: ${g.bags.length} bag${g.bags.length > 1 ? 's' : ''}`);
        hit.bindPopup(() => popupFor(g), { maxWidth: 320, minWidth: 240 });
      });
      const bounds = L.latLngBounds(groups.map(g => [g.place.lat, g.place.lng]));
      if (bounds.isValid()) state.map.fitBounds(bounds.pad(0.15));
    }

    const sorted = groups.map(g => ({ g, k: placeSortKey(g.place) }))
      .sort((a, b) => compareKeys(a.k, b.k));
    const byContinent = [];
    sorted.forEach(({ g, k }) => {
      const last = byContinent[byContinent.length - 1];
      if (last && last.continent === k[0]) last.groups.push(g);
      else byContinent.push({ continent: k[0], groups: [g] });
    });

    $('#place-list').replaceChildren(
      el('h2', {}, 'Places'),
      ...byContinent.map(c => el('section', {},
        el('h3', { class: 'continent' }, c.continent),
        el('ul', { class: 'places' }, ...c.groups.map(g => el('li', {},
        el('button', {
          class: 'link', type: 'button',
          onclick: () => { if (state.map) { state.map.setView([g.place.lat, g.place.lng], 6); state.map.getContainer().scrollIntoView({ behavior: 'smooth', block: 'center' }); } },
        }, g.place.name),
        el('span', { class: 'muted' }, ` · ${[...new Set(g.bags.map(b => b.brand))].join(', ')} · ${g.bags.length}`)))))),
      unknown.length ? el('p', { class: 'muted small' },
        `Origin unknown for ${unknown.length} bag${unknown.length > 1 ? 's' : ''}: ${[...new Set(unknown.map(b => b.brand))].join(', ')}.`) : '',
    );
  }

  const MIN_HIT_RADIUS = 18;

  const CONTINENTS = {
    'North America': ['USA', 'United States', 'Canada', 'Mexico', 'Guatemala', 'Belize', 'Honduras', 'El Salvador',
      'Nicaragua', 'Costa Rica', 'Panama', 'Cuba', 'Jamaica', 'Haiti', 'Dominican Republic', 'Puerto Rico', 'Bahamas',
      'Trinidad and Tobago', 'Barbados'],
    'South America': ['Argentina', 'Bolivia', 'Brazil', 'Chile', 'Colombia', 'Ecuador', 'Guyana', 'Paraguay', 'Peru',
      'Suriname', 'Uruguay', 'Venezuela'],
    'Europe': ['United Kingdom', 'Ireland', 'France', 'Spain', 'Portugal', 'Germany', 'Italy', 'Netherlands', 'Belgium',
      'Luxembourg', 'Switzerland', 'Austria', 'Denmark', 'Norway', 'Sweden', 'Finland', 'Iceland', 'Poland', 'Czechia',
      'Czech Republic', 'Slovakia', 'Hungary', 'Romania', 'Bulgaria', 'Greece', 'Croatia', 'Slovenia', 'Serbia',
      'Bosnia and Herzegovina', 'Montenegro', 'North Macedonia', 'Albania', 'Estonia', 'Latvia', 'Lithuania', 'Ukraine',
      'Belarus', 'Moldova', 'Russia', 'Malta', 'Cyprus', 'Monaco', 'Andorra', 'San Marino', 'Liechtenstein'],
    'Asia': ['China', 'Taiwan', 'Japan', 'South Korea', 'North Korea', 'Mongolia', 'Hong Kong', 'Macau', 'Philippines',
      'Vietnam', 'Thailand', 'Cambodia', 'Laos', 'Myanmar', 'Malaysia', 'Singapore', 'Indonesia', 'Brunei',
      'Timor-Leste', 'India', 'Pakistan', 'Bangladesh', 'Sri Lanka', 'Nepal', 'Bhutan', 'Maldives', 'Afghanistan',
      'Kazakhstan', 'Uzbekistan', 'Turkmenistan', 'Kyrgyzstan', 'Tajikistan', 'Iran', 'Iraq', 'Syria', 'Lebanon',
      'Jordan', 'Israel', 'Palestine', 'Saudi Arabia', 'Yemen', 'Oman', 'United Arab Emirates', 'Qatar', 'Bahrain',
      'Kuwait', 'Turkey', 'Türkiye', 'Georgia', 'Armenia', 'Azerbaijan'],
    'Africa': ['Egypt', 'Libya', 'Tunisia', 'Algeria', 'Morocco', 'Sudan', 'Ethiopia', 'Kenya', 'Tanzania', 'Uganda',
      'Rwanda', 'Nigeria', 'Ghana', 'Senegal', "Côte d'Ivoire", 'Ivory Coast', 'Cameroon', 'South Africa', 'Namibia',
      'Botswana', 'Zimbabwe', 'Zambia', 'Mozambique', 'Madagascar', 'Mauritius', 'Angola'],
    'Oceania': ['Australia', 'New Zealand', 'Fiji', 'Papua New Guinea', 'Samoa', 'Tonga'],
  };
  const CONTINENT_OF = {};
  Object.entries(CONTINENTS).forEach(([c, list]) => list.forEach(n => { CONTINENT_OF[n.toLowerCase()] = c; }));

  // [continent, country, state/province, city] parsed from a place's "City, Region, Country" name.
  function placeSortKey(place) {
    const country = place.country || '';
    const continent = CONTINENT_OF[country.toLowerCase()] || 'Other';
    const parts = place.name.replace(/\s*\([^)]*\)/g, '').split(',').map(x => x.trim()).filter(Boolean);
    const isCountry = x => x.toLowerCase() === country.toLowerCase() || CONTINENT_OF[x.toLowerCase()];
    if (parts.length > 1 && isCountry(parts[parts.length - 1])) parts.pop();
    if (parts.length === 1 && isCountry(parts[0])) parts.pop();
    const city = parts.length ? parts[0] : '';
    const region = parts.slice(1).join(', ');
    return [continent, country, region, city];
  }

  function compareKeys(a, b) {
    for (let i = 0; i < a.length; i++) {
      if (a[i] === b[i]) continue;
      if (i === 0 && (a[i] === 'Other' || b[i] === 'Other')) return a[i] === 'Other' ? 1 : -1;
      const c = a[i].localeCompare(b[i], undefined, { sensitivity: 'base' });
      if (c) return c;
    }
    return 0;
  }

  function mapColors() {
    const css = getComputedStyle(document.documentElement);
    const v = name => css.getPropertyValue(name).trim();
    return {
      water: v('--map-water'), land: v('--map-land'), border: v('--map-border'),
      pinFill: v('--orange'), pinStroke: v('--navy-strong'),
    };
  }

  // Shapes that cross the 180° line (Russia, Fiji) jump from +180 to -180 mid-ring,
  // which Leaflet draws as a band across the whole map. Keep each ring continuous instead.
  function unwrapDateline(geom) {
    if (!geom) return;
    const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.type === 'MultiPolygon' ? geom.coordinates : [];
    polys.forEach(rings => rings.forEach(ring => {
      for (let i = 1; i < ring.length; i++) {
        const d = ring[i][0] - ring[i - 1][0];
        if (d > 180) ring[i][0] -= 360;
        else if (d < -180) ring[i][0] += 360;
      }
    }));
  }

  async function drawBaseMap(map) {
    if (!window.topojson) return;
    const c = mapColors();
    map.getContainer().style.background = c.water;
    const renderer = L.canvas({ pane: 'basemap', padding: 0.5 });
    const style = { renderer, color: c.border, weight: 0.8, fillColor: c.land, fillOpacity: 1, interactive: false };
    try {
      const [world, us] = await Promise.all(
        ['vendor/geo/countries-50m.json', 'vendor/geo/states-10m.json'].map(u => fetch(u).then(r => r.json())));
      const countries = topojson.feature(world, world.objects.countries);
      countries.features = countries.features.filter(f => f.properties.name !== 'Antarctica');
      countries.features.forEach(f => unwrapDateline(f.geometry));
      L.geoJSON(countries, { style }).addTo(map);
      L.geoJSON(topojson.mesh(us, us.objects.states, (a, b) => a !== b), {
        style: { renderer, color: c.border, weight: 0.5, opacity: 0.8, fill: false, interactive: false },
      }).addTo(map);
    } catch (err) {
      console.error('Base map failed to load', err);
    }
  }

  function popupFor(g) {
    const box = el('div', { class: 'popup' },
      el('strong', {}, g.place.name),
      el('div', { class: 'muted small' }, `${g.bags.length} bag${g.bags.length > 1 ? 's' : ''}`),
      el('div', { class: 'popup-grid' }, ...g.bags.slice(0, 24).map(b =>
        el('button', { class: 'popup-bag', type: 'button', title: `${b.brand} – ${b.flavor}`, onclick: () => openBag(b) }, bagImage(b, 'thumb')))),
      g.bags.length > 24 ? el('div', { class: 'muted small' }, `+${g.bags.length - 24} more`) : null);
    return box;
  }

  // ---------- routing ----------

  function showTab() {
    const tab = (location.hash || '#collection').slice(1);
    const valid = ['collection', 'leaderboard', 'map'].includes(tab) ? tab : 'collection';
    document.querySelectorAll('[data-panel]').forEach(p => { p.hidden = p.dataset.panel !== valid; });
    document.querySelectorAll('[data-tab]').forEach(a => a.setAttribute('aria-current', a.dataset.tab === valid ? 'page' : 'false'));
    if (valid === 'map') {
      renderMap();
      setTimeout(() => state.map && state.map.invalidateSize(), 0);
    }
  }

  // ---------- init ----------

  async function init() {
    try {
      await loadData();
    } catch (err) {
      $('main').prepend(el('p', { class: 'notice' }, 'Could not load the collection data. If you opened index.html directly from disk, serve the folder instead (for example: python3 -m http.server).'));
      console.error(err);
      return;
    }
    renderStats();
    renderBrandFilter();
    renderGrid();
    renderLeaderboard();
    $('#score-guide').replaceChildren(scoreGuide());

    $('#search').addEventListener('input', renderGrid);
    $('#brand-filter').addEventListener('change', renderGrid);
    $('#sort').addEventListener('change', renderGrid);
    $('#bag-dialog').addEventListener('click', e => { if (e.target.id === 'bag-dialog') e.target.close(); });

    window.addEventListener('hashchange', showTab);
    showTab();
  }

  init();
})();
