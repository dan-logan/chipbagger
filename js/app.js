(() => {
  'use strict';

  const RATINGS_KEY = 'chipbagger.ratings.v1';
  const CSV_COLUMNS = ['brand', 'flavor', 'notes', 'picture', 'collectability', 'curb_appeal', 'made_in'];
  const BOARD_SIZE = 10;

  const state = {
    bags: [],
    places: {},
    brands: {},
    localRatings: loadLocalRatings(),
    rateMode: false,
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

  function loadLocalRatings() {
    try { return JSON.parse(localStorage.getItem(RATINGS_KEY)) || {}; } catch { return {}; }
  }
  function saveLocalRatings() {
    try { localStorage.setItem(RATINGS_KEY, JSON.stringify(state.localRatings)); } catch { /* storage unavailable */ }
  }

  const imageFile = picture => (picture || '').split('/').pop();
  const imageUrl = (picture, full) => picture ? `images/${full ? 'bags' : 'thumbs'}/` + encodeURIComponent(imageFile(picture)) : '';

  function parseScore(v) {
    const n = parseFloat(v);
    return Number.isFinite(n) && n > 0 ? Math.min(10, n) : null;
  }

  function score(bag, field) {
    const local = state.localRatings[bag.key];
    if (local && local[field] != null) return local[field];
    return bag[field];
  }

  function overall(bag) {
    const a = score(bag, 'collectability'), b = score(bag, 'curb_appeal');
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

  async function loadData() {
    const [csvText, origins] = await Promise.all([
      fetch('data/bags.csv', { cache: 'no-cache' }).then(r => r.text()),
      fetch('data/origins.json', { cache: 'no-cache' }).then(r => r.json()),
    ]);
    state.places = origins.places || {};
    state.brands = origins.brands || {};
    state.bags = CSV.parse(csvText).map((row, i) => ({
      ...row,
      order: i,
      key: imageFile(row.picture) || `${row.brand}|${row.flavor}`,
      collectability: parseScore(row.collectability),
      curb_appeal: parseScore(row.curb_appeal),
    }));
    state.bags.forEach(b => { b.place = placeFor(b); });
  }

  // ---------- shared pieces ----------

  function bagImage(bag, cls = '', full = false) {
    const img = el('img', { src: imageUrl(bag.picture, full), alt: `${bag.brand} ${bag.flavor} bag`, loading: 'lazy', class: cls });
    // New photos may not have a thumbnail yet: fall back to the full image, then to a placeholder.
    img.addEventListener('error', function onError() {
      if (!full && !img.dataset.triedFull) { img.dataset.triedFull = '1'; img.src = imageUrl(bag.picture, true); return; }
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
    const byScore = f => (a, b) => (score(b, f) ?? -1) - (score(a, f) ?? -1) || a.brand.localeCompare(b.brand);
    list.sort({
      added: (a, b) => b.order - a.order,
      brand: (a, b) => a.brand.localeCompare(b.brand) || a.flavor.localeCompare(b.flavor),
      collectability: byScore('collectability'),
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
          scorePill('Collect', score(bag, 'collectability'), 'pill-collect'),
          scorePill('Curb', score(bag, 'curb_appeal'), 'pill-curb')),
      ))));
  }

  // ---------- bag detail ----------

  function openBag(bag) {
    const detail = $('#bag-detail');
    const ratingInput = (field, label) => {
      const current = score(bag, field);
      const out = el('output', {}, fmt(current));
      const input = el('input', {
        type: 'range', min: 1, max: 10, step: 1, value: current ?? 5, 'aria-label': label,
        oninput: e => { out.textContent = e.target.value; },
        onchange: e => {
          state.localRatings[bag.key] = { ...(state.localRatings[bag.key] || {}), [field]: Number(e.target.value) };
          saveLocalRatings();
          refreshScores();
        },
      });
      return el('label', { class: 'rate-row' }, el('span', {}, label), input, out);
    };

    detail.replaceChildren(
      el('div', { class: 'detail' },
        el('div', { class: 'detail-img' }, bagImage(bag, '', true)),
        el('div', { class: 'detail-body' },
          el('div', { class: 'card-brand' }, bag.brand),
          el('h2', {}, bag.flavor),
          bag.notes ? el('p', { class: 'muted' }, bag.notes) : null,
          el('dl', { class: 'facts' },
            el('dt', {}, 'Made in'), el('dd', {}, bag.place ? bag.place.name : 'Unknown'),
            el('dt', {}, 'Collectability'), el('dd', {}, scoreBar(score(bag, 'collectability'), 'bar-collect')),
            el('dt', {}, 'Curb appeal'), el('dd', {}, scoreBar(score(bag, 'curb_appeal'), 'bar-curb')),
          ),
          state.rateMode ? el('div', { class: 'rate-box' },
            el('strong', {}, 'Rate this bag'),
            ratingInput('collectability', 'Collectability'),
            ratingInput('curb_appeal', 'Curb appeal')) : null,
        )));
    const dlg = $('#bag-dialog');
    dlg.dataset.key = bag.key;
    if (!dlg.open) dlg.showModal();
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
      listEl.replaceChildren(el('li', { class: 'empty' }, 'No ratings yet. Turn on “Rate bags” to start scoring.'));
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
    renderBoard($('#board-collectability'), 'collectability', b => score(b, 'collectability'), 'bar-collect');
    renderBoard($('#board-curb'), 'curb', b => score(b, 'curb_appeal'), 'bar-curb');
    renderBoard($('#board-overall'), 'overall', overall, 'bar-overall');
    renderBrandBoard();
  }

  function setRateMode(on) {
    state.rateMode = on;
    $('#rate-toggle').textContent = on ? 'Done rating' : 'Rate bags';
    $('#rate-toggle').classList.toggle('btn-active', on);
    $('#rate-export').hidden = !on;
    $('#rate-help').hidden = !on;
    document.body.classList.toggle('rating', on);
  }

  function exportCsv() {
    const rows = state.bags.map(b => ({
      brand: b.brand, flavor: b.flavor, notes: b.notes, picture: b.picture, made_in: b.made_in,
      collectability: score(b, 'collectability') ?? '',
      curb_appeal: score(b, 'curb_appeal') ?? '',
    }));
    const blob = new Blob([CSV.stringify(rows, CSV_COLUMNS)], { type: 'text/csv' });
    const a = el('a', { href: URL.createObjectURL(blob), download: 'bags.csv' });
    document.body.append(a); a.click(); a.remove();
  }

  function refreshScores() {
    renderStats();
    renderGrid();
    renderLeaderboard();
    const dlg = $('#bag-dialog');
    if (dlg.open) {
      // Update the facts bars without rebuilding the open sliders.
      const bars = dlg.querySelectorAll('.facts .scorebar');
      const key = dlg.dataset.key;
      const bag = state.bags.find(b => b.key === key);
      if (bag && bars.length === 2) {
        bars[0].replaceWith(scoreBar(score(bag, 'collectability'), 'bar-collect'));
        bars[1].replaceWith(scoreBar(score(bag, 'curb_appeal'), 'bar-curb'));
      }
    }
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
      groups.forEach(g => {
        const r = 6 + 16 * Math.sqrt(g.bags.length / max);
        const marker = L.circleMarker([g.place.lat, g.place.lng], {
          radius: r, color: pin.pinStroke, weight: 3, fillColor: pin.pinFill, fillOpacity: 0.95,
        }).addTo(state.map);
        marker.bindTooltip(`${g.place.name}: ${g.bags.length} bag${g.bags.length > 1 ? 's' : ''}`);
        marker.bindPopup(() => popupFor(g), { maxWidth: 320, minWidth: 240 });
      });
      const bounds = L.latLngBounds(groups.map(g => [g.place.lat, g.place.lng]));
      if (bounds.isValid()) state.map.fitBounds(bounds.pad(0.15));
    }

    $('#place-list').replaceChildren(
      el('h2', {}, 'Places'),
      el('ul', { class: 'places' }, ...groups.map(g => el('li', {},
        el('button', {
          class: 'link', type: 'button',
          onclick: () => { if (state.map) { state.map.setView([g.place.lat, g.place.lng], 6); state.map.getContainer().scrollIntoView({ behavior: 'smooth', block: 'center' }); } },
        }, g.place.name),
        el('span', { class: 'muted' }, ` · ${[...new Set(g.bags.map(b => b.brand))].join(', ')} · ${g.bags.length}`)))),
      unknown.length ? el('p', { class: 'muted small' },
        `Origin unknown for ${unknown.length} bag${unknown.length > 1 ? 's' : ''}: ${[...new Set(unknown.map(b => b.brand))].join(', ')}.`) : null,
    );
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

    $('#search').addEventListener('input', renderGrid);
    $('#brand-filter').addEventListener('change', renderGrid);
    $('#sort').addEventListener('change', renderGrid);
    $('#rate-toggle').addEventListener('click', () => setRateMode(!state.rateMode));
    $('#rate-export').addEventListener('click', exportCsv);
    $('#bag-dialog').addEventListener('click', e => { if (e.target.id === 'bag-dialog') e.target.close(); });

    const params = new URLSearchParams(location.search);
    if (params.has('rate')) setRateMode(true);

    window.addEventListener('hashchange', showTab);
    showTab();
  }

  init();
})();
