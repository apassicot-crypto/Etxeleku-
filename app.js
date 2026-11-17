/* Etxeleku Rutas: rutas seguras para autocaravana con datos abiertos (OpenStreetMap). */
'use strict';

// ---------- Configuración ----------
const DEFAULT_VEHICLE = { height: 3.10, width: 2.70, length: 7.30, weight: 3.5, maxPrice: 5 };
const VALHALLA = 'https://valhalla1.openstreetmap.de/route';
const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const OVERPASS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

// ---------- Utilidades ----------
const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sin almacenamiento */ } },
};
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtKm = (km) => km < 10 ? km.toFixed(1).replace('.', ',') + ' km' : Math.round(km) + ' km';
const fmtTime = (s) => { const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60); return h ? `${h} h ${m} min` : `${m} min`; };
const fmtM = (n) => n.toFixed(2).replace('.', ',') + ' m';

let toastTimer;
function toast(msg, ms = 2800) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); if (ms) toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

let vehicle = { ...DEFAULT_VEHICLE, ...store.get('vehicle', {}) };

// ---------- Mapa ----------
const last = store.get('view', { lat: 43.0, lon: -2.0, z: 8 });
const map = L.map('map', { zoomControl: false }).setView([last.lat, last.lon], last.z);
L.control.zoom({ position: 'bottomright' }).addTo(map);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
}).addTo(map);
map.on('moveend', () => { const c = map.getCenter(); store.set('view', { lat: c.lat, lon: c.lng, z: map.getZoom() }); });

const placesLayer = L.layerGroup().addTo(map);
const limitsLayer = L.layerGroup().addTo(map);
const routeLayer = L.layerGroup().addTo(map);
let meMarker = null;
let myPos = null;

// ---------- Panel inferior ----------
// Un toque abre o cierra el panel. También se puede deslizar hacia abajo o hacia arriba.
function setSheet(open) {
  $('#sheet').classList.toggle('collapsed', !open);
  $('#handleText').textContent = open ? '▼ Cerrar panel' : '▲ Abrir panel';
}
const sheetOpen = () => !$('#sheet').classList.contains('collapsed');
function openSheet() { setSheet(true); }
function closeSheet() { setSheet(false); }
$('#sheetHandle').onclick = () => setSheet(!sheetOpen());
let touchY = null;
$('#sheet').addEventListener('touchstart', (e) => { touchY = e.touches[0].clientY; }, { passive: true });
$('#sheet').addEventListener('touchend', (e) => {
  if (touchY == null) return; const dy = e.changedTouches[0].clientY - touchY; touchY = null;
  const tab = $$('.tab').find((t) => !t.hidden);
  if (dy > 60 && (!tab || tab.scrollTop <= 0)) closeSheet(); else if (dy < -60 && !sheetOpen()) openSheet();
});
function showTab(name) {
  $$('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  $$('.tab').forEach((t) => { t.hidden = t.id !== 'tab-' + name; });
  openSheet();
}
$$('#tabs button[data-tab]').forEach((b) => {
  // Tocar la pestaña que ya está abierta cierra el panel.
  b.onclick = () => { if (b.classList.contains('active') && sheetOpen()) closeSheet(); else showTab(b.dataset.tab); };
});

// Pestaña Google: abre Google Maps con el mismo destino (o la zona que estás mirando).
$('#tabGoogle').onclick = () => {
  const ll = (p) => `${p.lat},${p.lon}`;
  let url;
  if (points.to) {
    url = `https://www.google.com/maps/dir/?api=1&destination=${ll(points.to)}&travelmode=driving`;
    if (points.from && points.from.name !== 'Mi posición') url += `&origin=${ll(points.from)}`;
    toast('Ojo: Google no sabe la altura de Etxeleku. Si hay dudas, manda la ruta de esta app.', 4000);
  } else {
    const c = map.getCenter();
    url = `https://www.google.com/maps/@?api=1&map_action=map&center=${c.lat.toFixed(5)},${c.lng.toFixed(5)}&zoom=${map.getZoom()}`;
  }
  window.open(url, '_blank', 'noopener');
};

// ---------- Posición ----------
function locate(fly = true) {
  return new Promise((resolve) => {
    if (!navigator.geolocation) { toast('Este móvil no da la posición'); return resolve(null); }
    toast('Buscando tu posición…', 0);
    navigator.geolocation.getCurrentPosition((p) => {
      myPos = { lat: p.coords.latitude, lon: p.coords.longitude };
      if (meMarker) meMarker.setLatLng([myPos.lat, myPos.lon]);
      else meMarker = L.circleMarker([myPos.lat, myPos.lon], { radius: 9, color: '#fff', weight: 3, fillColor: '#1a73e8', fillOpacity: 1 }).addTo(map).bindTooltip('Estás aquí');
      if (fly) map.setView([myPos.lat, myPos.lon], Math.max(map.getZoom(), 12));
      toast('Posición encontrada'); resolve(myPos);
    }, () => { toast('No he podido obtener tu posición. Revisa el permiso de ubicación.'); resolve(null); },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 });
  });
}
$('#btnLocate').onclick = () => locate(true);

function startTracking() {
  if (!navigator.geolocation) return;
  let first = true;
  navigator.geolocation.watchPosition((p) => {
    myPos = { lat: p.coords.latitude, lon: p.coords.longitude };
    if (meMarker) meMarker.setLatLng([myPos.lat, myPos.lon]);
    else meMarker = L.circleMarker([myPos.lat, myPos.lon], { radius: 10, color: '#fff', weight: 3, fillColor: '#1a73e8', fillOpacity: 1 }).addTo(map).bindTooltip('Estás aquí');
    if (first) {
      first = false;
      map.setView([myPos.lat, myPos.lon], 13);
      if (!points.from) setPoint('from', { ...myPos, name: 'Mi posición' });
    }
  }, () => { toast('Activa el permiso de ubicación para ver dónde estás'); },
  { enableHighAccuracy: true, timeout: 20000, maximumAge: 30000 });
}

// ---------- Búsqueda de lugares (Nominatim) ----------
const points = { from: null, to: null };
let suggestFor = null;

async function geocode(q) {
  const url = `${NOMINATIM}?format=jsonv2&limit=6&accept-language=es&q=${encodeURIComponent(q)}`;
  const r = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!r.ok) throw new Error('geocode');
  return (await r.json()).map((x) => ({ lat: +x.lat, lon: +x.lon, name: x.display_name }));
}
async function showSuggestions(which) {
  const q = $('#' + which).value.trim();
  if (!q) return;
  suggestFor = which;
  const ul = $('#suggest');
  ul.innerHTML = '<li>Buscando…</li>'; ul.hidden = false;
  try {
    const res = await geocode(q);
    if (!res.length) { ul.innerHTML = '<li>No encuentro ese lugar</li>'; return; }
    ul.innerHTML = '';
    res.forEach((p) => {
      const li = document.createElement('li'); li.textContent = p.name;
      li.onclick = () => { setPoint(which, p); ul.hidden = true; if (points.to && (points.from || myPos)) route(); };
      ul.appendChild(li);
    });
  } catch { ul.innerHTML = '<li>Sin conexión con el buscador. Prueba de nuevo.</li>'; }
}
function setPoint(which, p) {
  points[which] = p;
  $('#' + which).value = p.name.split(',').slice(0, 2).join(',');
}
['from', 'to'].forEach((w) => {
  const el = $('#' + w);
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); showSuggestions(w); } });
  el.addEventListener('input', () => { points[w] = null; });
});
$('#fromMe').onclick = async () => { const p = await locate(false); if (p) setPoint('from', { ...p, name: 'Mi posición' }); };

// Tocar el mapa: ir aquí / salir de aquí
map.on('click', (e) => {
  const p = { lat: e.latlng.lat, lon: e.latlng.lng, name: `Punto ${e.latlng.lat.toFixed(4)}, ${e.latlng.lng.toFixed(4)}` };
  const div = document.createElement('div');
  div.innerHTML = '<div class="links"><button data-w="to">Ir aquí</button><button data-w="from">Salir de aquí</button></div>';
  const pop = L.popup().setLatLng(e.latlng).setContent(div).openOn(map);
  div.querySelectorAll('button').forEach((b) => {
    b.onclick = () => { setPoint(b.dataset.w, p); map.closePopup(pop); showTab('ruta'); if (points.to && (points.from || myPos)) route(); };
  });
});

// ---------- Rutas (Valhalla, perfil camión con las medidas de Etxeleku) ----------
function decodePolyline6(str) {
  let i = 0, lat = 0, lon = 0; const out = [];
  while (i < str.length) {
    let b, shift = 0, res = 0;
    do { b = str.charCodeAt(i++) - 63; res |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lat += (res & 1) ? ~(res >> 1) : (res >> 1);
    shift = 0; res = 0;
    do { b = str.charCodeAt(i++) - 63; res |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lon += (res & 1) ? ~(res >> 1) : (res >> 1);
    out.push([lat / 1e6, lon / 1e6]);
  }
  return out;
}

let currentRoute = null; // [[lat,lon], ...]

async function route() {
  $('#suggest').hidden = true;
  const info = $('#routeInfo');
  try {
    if (!points.from) {
      if ($('#from').value.trim()) { await showSuggestions('from'); toast('Elige el punto de salida de la lista'); return; }
      const p = myPos || await locate(false);
      if (!p) { toast('Indica desde dónde sales'); return; }
      setPoint('from', { ...p, name: 'Mi posición' });
    }
    if (!points.to) {
      if ($('#to').value.trim()) { await showSuggestions('to'); toast('Elige el destino de la lista'); return; }
      toast('Indica a dónde vas'); return;
    }
    info.innerHTML = '<p class="hint">Calculando una ruta por donde cabe Etxeleku…</p>';
    const body = {
      locations: [{ lat: points.from.lat, lon: points.from.lon }, { lat: points.to.lat, lon: points.to.lon }],
      costing: 'truck',
      costing_options: { truck: {
        height: vehicle.height, width: vehicle.width, length: vehicle.length, weight: vehicle.weight,
        axle_load: Math.min(vehicle.weight, 2.5), hazmat: false,
        use_tolls: $('#avoidTolls').checked ? 0 : 0.5,
      } },
      directions_options: { language: 'es-ES', units: 'kilometers' },
    };
    const r = await fetch(`${VALHALLA}?json=${encodeURIComponent(JSON.stringify(body))}`);
    const data = await r.json();
    if (!r.ok || !data.trip) {
      info.innerHTML = `<p class="warn">No encuentro una ruta por donde quepa Etxeleku entre esos dos puntos. ${esc(data.error || '')}</p>`;
      return;
    }
    drawRoute(data.trip);
  } catch (e) {
    console.error(e);
    info.innerHTML = '<p class="warn">No he podido conectar con el servidor de rutas. Revisa la conexión y prueba otra vez.</p>';
  }
}

function drawRoute(trip) {
  routeLayer.clearLayers();
  const coords = trip.legs.flatMap((l) => decodePolyline6(l.shape));
  currentRoute = coords;
  L.polyline(coords, { color: '#ffffff', weight: 9, opacity: .9 }).addTo(routeLayer);
  const line = L.polyline(coords, { color: '#1f6f5c', weight: 6 }).addTo(routeLayer);
  L.circleMarker(coords[0], { radius: 7, color: '#fff', weight: 3, fillColor: '#1f6f5c', fillOpacity: 1 }).addTo(routeLayer);
  L.circleMarker(coords[coords.length - 1], { radius: 8, color: '#fff', weight: 3, fillColor: '#c0392b', fillOpacity: 1 }).addTo(routeLayer);
  map.fitBounds(line.getBounds(), { padding: [30, 30] });
  $('#btnAlongRoute').disabled = false;
  toast(`Ruta lista: ${fmtKm(trip.summary.length)}, ${fmtTime(trip.summary.time)}. Abre el panel para ver los detalles.`, 4500);
  if (innerWidth < 760) closeSheet();

  const steps = trip.legs.flatMap((l) => l.maneuvers);
  $('#routeInfo').innerHTML = `
    <div class="summary"><span>${fmtKm(trip.summary.length)}</span><span>${fmtTime(trip.summary.time)}</span></div>
    <p class="hint">Ruta calculada como vehículo de ${fmtM(vehicle.height)} de alto, ${fmtM(vehicle.width)} de ancho, ${fmtM(vehicle.length)} de largo y ${String(vehicle.weight).replace('.', ',')} t.</p>
    <div id="routeCheck"><p class="hint">Comprobando puentes y límites en el camino…</p></div>
    <ol class="steps">${steps.map((m) => `<li><span>${esc(m.instruction)}</span><small>${m.length ? fmtKm(m.length) : ''}</small></li>`).join('')}</ol>`;
  showAlongRoute();
  checkRouteLimits(coords);
}

$('#btnRoute').onclick = route;
$('#btnClear').onclick = () => {
  routeLayer.clearLayers(); currentRoute = null; points.from = points.to = null; alongRoute = false; loadedBounds = null; autoPlaces();
  $('#from').value = ''; $('#to').value = ''; $('#routeInfo').innerHTML = ''; $('#btnAlongRoute').disabled = true;
};

// ---------- Overpass (datos de OpenStreetMap) ----------
async function overpass(query) {
  let lastErr;
  for (const url of OVERPASS) {
    const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), 25000);
    try {
      const r = await fetch(url, { method: 'POST', body: 'data=' + encodeURIComponent(query), signal: ctrl.signal,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
      if (r.ok) { const j = await r.json(); clearTimeout(timer); return j.elements || []; }
      lastErr = new Error('overpass ' + r.status);
    } catch (e) { lastErr = e; }
    clearTimeout(timer);
  }
  throw lastErr;
}

// Simplifica la línea (Douglas-Peucker) para poder preguntar a Overpass "alrededor de la ruta".
function simplify(pts, tol) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop(); let max = 0, idx = -1;
    const [y1, x1] = pts[a], [y2, x2] = pts[b]; const dx = x2 - x1, dy = y2 - y1; const len = dx * dx + dy * dy;
    for (let i = a + 1; i < b; i++) {
      const [y, x] = pts[i];
      let t = len ? ((x - x1) * dx + (y - y1) * dy) / len : 0; t = Math.max(0, Math.min(1, t));
      const ex = x1 + t * dx - x, ey = y1 + t * dy - y; const d = ex * ex + ey * ey;
      if (d > max) { max = d; idx = i; }
    }
    if (max > tol * tol && idx > 0) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
function routeLine(maxPts) {
  let tol = 0.0001, s = simplify(currentRoute, tol);
  while (s.length > maxPts) { tol *= 2; s = simplify(currentRoute, tol); }
  return s.map(([a, b]) => `${a.toFixed(5)},${b.toFixed(5)}`).join(',');
}
const bboxStr = () => { const b = map.getBounds(); return `${b.getSouth()},${b.getWest()},${b.getNorth()},${b.getEast()}`; };

// ---------- Lugares: vaciado, agua, áreas, parkings ----------
const KINDS = {
  dump: { icon: '🚰', label: 'Vaciado / llenado' },
  water: { icon: '💧', label: 'Agua potable' },
  area: { icon: '🚐', label: 'Área AC / camping' },
  parking: { icon: '🅿️', label: 'Parking apto AC' },
};
function placesQuery(filter) {
  return `[out:json][timeout:40];(
    nwr["amenity"="sanitary_dump_station"]${filter};
    nwr["amenity"="water_point"]${filter};
    nwr["tourism"="caravan_site"]${filter};
    nwr["amenity"="parking"]["motorhome"~"^(yes|designated)$"]${filter};
  );out center tags;`;
}
function kindOf(t) {
  if (t.amenity === 'sanitary_dump_station') return 'dump';
  if (t.amenity === 'water_point') return 'water';
  if (t.tourism === 'caravan_site') return 'area';
  return 'parking';
}
function parsePrice(charge) {
  if (!charge) return null;
  const m = String(charge).replace(',', '.').match(/(\d+(?:\.\d+)?)/);
  return m ? parseFloat(m[1]) : null;
}
function priceInfo(t) {
  const fee = (t.fee || '').toLowerCase();
  const price = parsePrice(t.charge) ?? (/\d/.test(t.fee || '') ? parsePrice(t.fee) : null);
  if (fee === 'no' || fee === 'free' || price === 0) return { cls: 'free', text: 'Gratis' };
  if (fee === 'donation') return { cls: 'cheap', text: 'Donativo' };
  if (price != null) return { cls: price <= vehicle.maxPrice ? 'cheap' : 'paid', text: esc(t.charge || t.fee) };
  if (fee === 'yes' || fee) return { cls: 'paid', text: 'De pago' };
  return { cls: 'unknown', text: 'Precio sin datos' };
}
function servicesOf(t, kind) {
  const s = [];
  const yes = (k) => t[k] && t[k] !== 'no';
  if (kind === 'dump' || yes('sanitary_dump_station')) s.push('Vaciado');
  if (yes('sanitary_dump_station:grey_water') || yes('grey_water')) s.push('Aguas grises');
  if (yes('sanitary_dump_station:chemical_toilet') || yes('chemical_toilet') || yes('sanitary_dump_station:black_water')) s.push('WC químico');
  if (kind === 'water' || yes('water_point') || yes('drinking_water')) s.push('Agua');
  if (yes('power_supply')) s.push('Electricidad');
  if (yes('toilets')) s.push('WC');
  if (yes('shower')) s.push('Duchas');
  if (yes('internet_access')) s.push('Wifi');
  return [...new Set(s)];
}

let lastPlaces = [];
let placesShown = null;

// Lugares guardados en la propia web, en trozos de 1x1 grado (se actualizan con GitHub Actions).
const TYPES = { n: 'node', w: 'way', r: 'relation' };
let tileIndex;            // undefined = sin mirar, null = no hay datos guardados
const tileCache = new Map();
async function getTileIndex() {
  if (tileIndex !== undefined) return tileIndex;
  try {
    const r = await fetch('data/places/index.json', { cache: 'no-cache' });
    const j = r.ok ? await r.json() : null;
    tileIndex = j ? { ...j, set: new Set(j.tiles) } : null;
  } catch { tileIndex = null; }
  return tileIndex;
}
async function getTile(key) {
  if (!tileCache.has(key)) {
    tileCache.set(key, fetch(`data/places/${key}.json`).then((r) => (r.ok ? r.json() : [])).then((arr) => arr.map(([k, lat, lon, tags]) => ({
      type: TYPES[k[0]], id: +k.slice(1), lat, lon, tags,
    }))).catch(() => { tileCache.delete(key); throw new Error('tile'); }));
  }
  return tileCache.get(key);
}
async function tilesIn(keys) {
  const idx = await getTileIndex();
  const wanted = [...keys].filter((k) => idx.set.has(k));
  return (await Promise.all(wanted.map(getTile))).flat();
}
function keysForBounds(b) {
  const keys = new Set();
  for (let la = Math.floor(b.getSouth()); la <= Math.floor(b.getNorth()); la++)
    for (let lo = Math.floor(b.getWest()); lo <= Math.floor(b.getEast()); lo++) keys.add(`${la}_${lo}`);
  return keys;
}
async function placesInBounds(b) {
  if (!(await getTileIndex())) return overpass(placesQuery(boxFilter(b)));  // sin datos guardados: servidor
  return (await tilesIn(keysForBounds(b))).filter((e) => b.contains([e.lat, e.lon]));
}

// Lugares a lo largo de la ruta: a menos de 3 km del camino, con el km en el que quedan.
async function placesAlongRoute(coords, maxKm = 3) {
  const line = simplify(coords, 0.0005);
  const lat0 = line[0][0] * Math.PI / 180, kx = 111.32 * Math.cos(lat0), ky = 110.57;
  const P = line.map(([la, lo]) => [lo * kx, la * ky]);
  const cum = [0]; for (let i = 1; i < P.length; i++) cum.push(cum[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
  let all;
  if (await getTileIndex()) {
    const keys = new Set();
    for (const [la, lo] of coords) for (const d of [-0.05, 0.05]) { keys.add(`${Math.floor(la + d)}_${Math.floor(lo)}`); keys.add(`${Math.floor(la)}_${Math.floor(lo + d)}`); }
    all = await tilesIn(keys);
  } else {
    all = await overpass(placesQuery(`(around:${maxKm * 1000},${routeLine(400)})`));
  }
  const out = [];
  for (const e of all) {
    const la = e.lat ?? e.center?.lat, lo = e.lon ?? e.center?.lon; if (la == null) continue;
    const x = lo * kx, y = la * ky; let best = Infinity, at = 0;
    for (let i = 1; i < P.length; i++) {
      const [x1, y1] = P[i - 1], [x2, y2] = P[i]; const dx = x2 - x1, dy = y2 - y1; const L2 = dx * dx + dy * dy;
      let t = L2 ? ((x - x1) * dx + (y - y1) * dy) / L2 : 0; t = Math.max(0, Math.min(1, t));
      const d = Math.hypot(x1 + t * dx - x, y1 + t * dy - y);
      if (d < best) { best = d; at = cum[i - 1] + t * Math.sqrt(L2); }
    }
    if (best <= maxKm) out.push({ ...e, _km: at });
  }
  return out;
}
async function showAlongRoute() {
  if (!currentRoute) return;
  const coords = currentRoute;
  alongRoute = true;
  status('Buscando áreas, agua y parkings en toda la ruta…');
  try {
    const els = await placesAlongRoute(coords);
    if (currentRoute !== coords) return;
    lastPlaces = els;
    const n = renderPlaces(els);
    status(n ? `${n} lugares a lo largo de la ruta` : 'No hay lugares registrados junto a esta ruta', n ? 'ok' : '');
  } catch (e) { console.error(e); status('No he podido cargar los lugares de la ruta. Pulsa "Buscar a lo largo de la ruta" para reintentar.', 'err'); }
}
function renderPlaces(elements) {
  placesLayer.clearLayers();
  const enabled = new Set($$('.filters input[data-kind]').filter((i) => i.checked).map((i) => i.dataset.kind));
  const onlyFree = $('#onlyFree').checked;
  const seen = new Set();
  const items = [];
  for (const el of elements) {
    const t = el.tags || {}; const lat = el.lat ?? el.center?.lat; const lon = el.lon ?? el.center?.lon;
    if (lat == null || t.access === 'private' || t.access === 'no' || t.motorhome === 'no') continue;
    const key = `${el.type}${el.id}`; if (seen.has(key)) continue; seen.add(key);
    const kind = kindOf(t); if (!enabled.has(kind)) continue;
    const price = priceInfo(t);
    if (onlyFree && !(price.cls === 'free' || price.cls === 'cheap')) continue;
    items.push({ el, t, lat, lon, kind, price, km: el._km });
  }
  const order = { free: 0, cheap: 1, unknown: 2, paid: 3 };
  if (items.length && items[0].km != null) items.sort((a, b) => a.km - b.km);
  else items.sort((a, b) => order[a.price.cls] - order[b.price.cls]);
  const ul = $('#placeList'); ul.innerHTML = '';
  for (const it of items) {
    const { t, lat, lon, kind, price } = it;
    const name = t.name || KINDS[kind].label;
    const icon = L.divIcon({ className: '', html: `<div class="pin ${price.cls}"><span>${KINDS[kind].icon}</span></div>`, iconSize: [50, 50], iconAnchor: [25, 60], popupAnchor: [0, -56] });
    const svc = servicesOf(t, kind);
    const html = `<h3>${KINDS[kind].icon} ${esc(name)}</h3>
      <div><span class="badge ${price.cls}">${price.text}</span>${esc(KINDS[kind].label)}</div>
      ${svc.length ? `<div class="svc">${svc.map(esc).join(' · ')}</div>` : ''}
      ${t.opening_hours ? `<div>Horario: ${esc(t.opening_hours)}</div>` : ''}
      ${t.capacity ? `<div>Plazas: ${esc(t.capacity)}</div>` : ''}
      ${t.maxstay ? `<div>Estancia máx.: ${esc(t.maxstay)}</div>` : ''}
      ${t.description ? `<div class="svc">${esc(t.description)}</div>` : ''}
      <div class="links">
        <button class="go">Ruta segura hasta aquí</button>
        <a class="alt" target="_blank" rel="noopener" href="https://www.openstreetmap.org/${it.el.type}/${it.el.id}">Ver datos</a>
        <a class="alt" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=${lat},${lon}">Ver en Google</a>
      </div>`;
    const m = L.marker([lat, lon], { icon }).addTo(placesLayer).bindPopup(html);
    m.on('popupopen', (e) => {
      const b = e.popup.getElement().querySelector('.go');
      if (b) b.onclick = () => { setPoint('to', { lat, lon, name }); showTab('ruta'); route(); };
    });
    const li = document.createElement('li');
    li.innerHTML = `<div class="t">${it.km != null ? `<span class="km">km ${Math.round(it.km)}</span>` : ''}${KINDS[kind].icon} ${esc(name)}</div><div class="s"><span class="badge ${price.cls}">${price.text}</span>${svc.map(esc).join(' · ')}</div>`;
    li.onclick = () => { map.setView([lat, lon], Math.max(map.getZoom(), 14)); m.openPopup(); if (innerWidth < 760) closeSheet(); };
    ul.appendChild(li);
  }
  placesShown = items.length ? items : null;
  return items.length;
}
let loadedBounds = null;   // zona ya cargada automáticamente
let alongRoute = false;     // si se buscó a lo largo de la ruta, no se sustituye al mover el mapa
async function searchPlaces(filter, where, auto = false) {
  if (!auto) toast(`Buscando lugares ${where}…`, 0);
  try {
    lastPlaces = await overpass(placesQuery(filter));
    const n = renderPlaces(lastPlaces);
    if (!auto) { toast(n ? `${n} lugares encontrados` : 'No hay lugares con esos filtros aquí'); showTab('lugares'); }
    return true;
  } catch (e) { console.error(e); if (!auto) toast('El servidor de mapas está ocupado. Prueba en un momento.'); return false; }
}
function status(msg, kind = '') {
  const el = $('#placesStatus'); el.textContent = msg; el.className = kind; el.hidden = !msg;
}
// Caja de búsqueda alrededor del centro: como mínimo ~25 km de lado, aunque el mapa esté muy cerca.
function searchBox(minHalfDeg) {
  const v = map.getBounds().pad(0.5); const c = map.getCenter();
  const hLat = Math.max((v.getNorth() - v.getSouth()) / 2, minHalfDeg);
  const hLon = Math.max((v.getEast() - v.getWest()) / 2, minHalfDeg * 1.4);
  return L.latLngBounds([c.lat - hLat, c.lng - hLon], [c.lat + hLat, c.lng + hLon]);
}
const boxFilter = (b) => `(${b.getSouth().toFixed(4)},${b.getWest().toFixed(4)},${b.getNorth().toFixed(4)},${b.getEast().toFixed(4)})`;
async function loadBox(b) {
  try { lastPlaces = await placesInBounds(b); renderPlaces(lastPlaces); return true; }
  catch (e) { console.error(e); return false; }
}
let autoTimer, autoBusy = false;
function autoPlaces() {
  clearTimeout(autoTimer);
  autoTimer = setTimeout(async () => {
    if (alongRoute || autoBusy) return;
    if (map.getZoom() < 9) { status('Acerca el mapa para ver áreas y parkings'); return; }
    if (loadedBounds && loadedBounds.contains(map.getBounds())) return;
    autoBusy = true;
    try {
      status('Cargando áreas y parkings…');
      let b = searchBox(0.12);
      let ok = await loadBox(b);
      if (ok && !placesShown) {
        status('No hay nada cerca, busco más lejos…');
        b = searchBox(0.45);
        ok = await loadBox(b);
        if (ok && placesShown) map.fitBounds(L.latLngBounds(placesShown.map((x) => [x.lat, x.lon])).extend(map.getCenter()), { padding: [40, 40], maxZoom: 13 });
      }
      if (!ok) { status('El servidor de datos no responde. Reintento en 20 s…', 'err'); autoTimer = setTimeout(autoPlaces, 20000); return; }
      loadedBounds = b;
      status(placesShown ? `${placesShown.length} lugares en el mapa` : 'No hay áreas ni parkings registrados por aquí', placesShown ? 'ok' : '');
    } finally { autoBusy = false; }
  }, 700);
}
map.on('moveend', autoPlaces);
$('#btnSearchHere').onclick = () => {
  if (map.getZoom() < 9) { toast('Acerca un poco más el mapa para buscar'); return; }
  alongRoute = false; loadedBounds = null; autoPlaces();
  toast('Buscando lugares en esta zona…');
};
$('#btnAlongRoute').onclick = () => { showAlongRoute(); showTab('lugares'); };
$$('.filters input').forEach((i) => { i.onchange = () => renderPlaces(lastPlaces); });

// ---------- Límites: altura, ancho, peso ----------
function parseLimit(v, kind) {
  if (!v) return null;
  const s = String(v).trim().toLowerCase();
  if (/^(none|default|below_default|unsigned|no_sign)/.test(s)) return null;
  const ft = s.match(/^(\d+)'\s*(\d+)?/);
  if (ft) return (+ft[1] * 12 + (+ft[2] || 0)) * 0.0254;
  const m = s.replace(',', '.').match(/(\d+(?:\.\d+)?)\s*(m|t|kg|st|lbs)?/);
  if (!m) return null;
  let n = parseFloat(m[1]);
  if (kind === 'weight' && m[2] === 'kg') n /= 1000;
  return n;
}
function limitProblems(t) {
  const out = [];
  const h = parseLimit(t.maxheight || t['maxheight:physical'], 'height');
  const w = parseLimit(t.maxwidth || t['maxwidth:physical'], 'width');
  const wt = parseLimit(t.maxweight, 'weight');
  if (h != null && h < vehicle.height + 0.15) out.push({ txt: `↕ ${fmtM(h)}`, bad: h < vehicle.height, what: 'altura' });
  if (w != null && w < vehicle.width + 0.10) out.push({ txt: `↔ ${fmtM(w)}`, bad: w < vehicle.width, what: 'ancho' });
  if (wt != null && wt < vehicle.weight) out.push({ txt: `${String(wt).replace('.', ',')} t`, bad: true, what: 'peso' });
  return out;
}
const limitsQuery = (filter) => `[out:json][timeout:40];(
  nwr["maxheight"]${filter}; nwr["maxheight:physical"]${filter}; nwr["maxwidth"]${filter}; nwr["maxweight"]${filter};
);out center tags;`;

function drawLimits(elements) {
  limitsLayer.clearLayers();
  let bad = 0, tight = 0;
  for (const el of elements) {
    const t = el.tags || {}; const lat = el.lat ?? el.center?.lat; const lon = el.lon ?? el.center?.lon;
    if (lat == null) continue;
    const probs = limitProblems(t); if (!probs.length) continue;
    const isBad = probs.some((p) => p.bad); isBad ? bad++ : tight++;
    const icon = L.divIcon({ className: '', html: `<div class="limit" style="${isBad ? '' : 'background:#d48806'}">${probs.map((p) => p.txt).join('<br>')}</div>`, iconSize: [54, 20], iconAnchor: [27, 10] });
    L.marker([lat, lon], { icon }).addTo(limitsLayer).bindPopup(
      `<h3>${isBad ? '⛔ Etxeleku NO pasa' : '⚠️ Muy justo'}</h3>
       ${probs.map((p) => `<div>Límite de ${p.what}: <b>${p.txt}</b></div>`).join('')}
       ${t.name ? `<div>${esc(t.name)}</div>` : ''}
       <div class="links"><a class="alt" target="_blank" rel="noopener" href="https://www.openstreetmap.org/${el.type}/${el.id}">Ver datos</a></div>`);
  }
  return { bad, tight };
}
$('#btnLimits').onclick = async () => {
  const btn = $('#btnLimits');
  if (btn.classList.contains('on')) { limitsLayer.clearLayers(); btn.classList.remove('on'); return; }
  if (map.getZoom() < 12) { toast('Acerca más el mapa (nivel de pueblo o barrio) para ver los límites'); return; }
  toast('Buscando puentes bajos y calles estrechas…', 0);
  try {
    const { bad, tight } = drawLimits(await overpass(limitsQuery(`(${bboxStr()})`)));
    btn.classList.add('on');
    toast(bad + tight ? `${bad} sitios por donde no pasas y ${tight} muy justos` : 'Ningún límite conocido por debajo de Etxeleku en esta zona', 4000);
  } catch { toast('El servidor de mapas está ocupado. Prueba en un momento.'); }
};

async function checkRouteLimits(coords) {
  const box = $('#routeCheck'); if (!box) return;
  try {
    const els = await overpass(limitsQuery(`(around:12,${routeLine(1500)})`));
    const { bad, tight } = drawLimits(els);
    if (currentRoute !== coords) return;
    if (bad) box.innerHTML = `<p class="warn">⚠️ Hay ${bad} límite(s) por debajo de Etxeleku muy cerca de la ruta (en rojo en el mapa). Suelen estar en calles paralelas, pero míralos antes de salir.</p>`;
    else if (tight) box.innerHTML = `<p class="ok">✅ Sin límites por debajo de Etxeleku. Hay ${tight} paso(s) muy justo(s) cerca (en naranja).</p>`;
    else box.innerHTML = '<p class="ok">✅ Comprobado: no hay puentes, túneles ni calles con límites por debajo de Etxeleku en esta ruta (según OpenStreetMap).</p>';
  } catch {
    box.innerHTML = '<p class="hint">No he podido hacer la comprobación extra de límites (el servidor está ocupado). La ruta ya está calculada con tus medidas.</p>';
  }
}

// ---------- Vehículo ----------
function fillVehicle() {
  $('#vHeight').value = vehicle.height; $('#vWidth').value = vehicle.width; $('#vLength').value = vehicle.length;
  $('#vWeight').value = vehicle.weight; $('#vMaxPrice').value = vehicle.maxPrice;
}
$('#btnSaveVehicle').onclick = () => {
  const n = (id, d) => { const v = parseFloat(String($(id).value).replace(',', '.')); return isFinite(v) && v > 0 ? v : d; };
  vehicle = { height: n('#vHeight', vehicle.height), width: n('#vWidth', vehicle.width), length: n('#vLength', vehicle.length),
    weight: n('#vWeight', vehicle.weight), maxPrice: n('#vMaxPrice', vehicle.maxPrice) };
  store.set('vehicle', vehicle); fillVehicle(); toast('Medidas guardadas');
};
$('#btnResetVehicle').onclick = () => { vehicle = { ...DEFAULT_VEHICLE }; store.set('vehicle', vehicle); fillVehicle(); toast('Medidas de Etxeleku restauradas'); };
fillVehicle();

// ---------- App instalable / sin conexión ----------
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

// Al abrir la app: buscar tu posición y los lugares de alrededor.
startTracking();
autoPlaces();
