"""Descarga de OpenStreetMap (Overpass) las áreas de AC, vaciados, puntos de agua y parkings
de Europa y los guarda en trocitos de 1x1 grado en data/places/, para que la app no dependa
de un servidor externo mientras se viaja."""
import json, os, sys, time, urllib.parse, urllib.request, datetime

SERVERS = ['https://overpass-api.de/api/interpreter',
           'https://overpass.private.coffee/api/interpreter',
           'https://overpass.kumi.systems/api/interpreter']
KEEP = {'name', 'fee', 'charge', 'opening_hours', 'capacity', 'maxstay', 'description', 'access', 'motorhome',
        'power_supply', 'toilets', 'shower', 'drinking_water', 'water_point', 'sanitary_dump_station',
        'sanitary_dump_station:grey_water', 'sanitary_dump_station:chemical_toilet', 'sanitary_dump_station:black_water',
        'grey_water', 'chemical_toilet', 'internet_access', 'website', 'amenity', 'tourism'}
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data', 'places')
LAT0, LAT1, LON0, LON1, STEP = 34, 72, -25, 45, 5


def query(s, w, n, e):
    b = f'({s},{w},{n},{e})'
    return f'''[out:json][timeout:180];(
nwr["amenity"="sanitary_dump_station"]{b};
nwr["amenity"="water_point"]{b};
nwr["tourism"="caravan_site"]{b};
nwr["amenity"="parking"]["motorhome"~"^(yes|designated)$"]{b};
);out center tags;'''


def fetch(q):
    last = None
    for attempt in range(4):
        for url in SERVERS:
            try:
                req = urllib.request.Request(url, data=urllib.parse.urlencode({'data': q}).encode(),
                                             headers={'User-Agent': 'etxeleku-rutas/1.0'})
                with urllib.request.urlopen(req, timeout=240) as r:
                    return json.load(r)['elements']
            except Exception as ex:  # servidor ocupado: probar otro
                last = ex
                print('  fallo', url, ex, flush=True)
                time.sleep(5)
        time.sleep(30 * (attempt + 1))
    raise RuntimeError(f'Overpass no responde: {last}')


def main():
    tiles, seen, total = {}, set(), 0
    for s in range(LAT0, LAT1, STEP):
        for w in range(LON0, LON1, STEP):
            els = fetch(query(s, w, s + STEP, w + STEP))
            print(f'caja {s},{w}: {len(els)}', flush=True)
            for el in els:
                key = el['type'][0] + str(el['id'])
                if key in seen:
                    continue
                seen.add(key)
                lat = el.get('lat', el.get('center', {}).get('lat'))
                lon = el.get('lon', el.get('center', {}).get('lon'))
                if lat is None:
                    continue
                t = {k: (v[:200] if k == 'description' else v) for k, v in el.get('tags', {}).items() if k in KEEP}
                tiles.setdefault(f'{int(lat // 1)}_{int(lon // 1)}', []).append([key, round(lat, 5), round(lon, 5), t])
                total += 1
            time.sleep(2)
    if total < 1000:
        sys.exit(f'Muy pocos lugares ({total}); no se guarda nada.')
    os.makedirs(OUT, exist_ok=True)
    for f in os.listdir(OUT):
        os.remove(os.path.join(OUT, f))
    for k, v in tiles.items():
        with open(os.path.join(OUT, k + '.json'), 'w') as fh:
            json.dump(v, fh, ensure_ascii=False, separators=(',', ':'))
    with open(os.path.join(OUT, 'index.json'), 'w') as fh:
        json.dump({'updated': datetime.date.today().isoformat(), 'total': total, 'tiles': sorted(tiles)}, fh)
    print('total', total, 'trozos', len(tiles))


if __name__ == '__main__':
    main()
