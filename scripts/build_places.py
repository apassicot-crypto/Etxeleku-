"""Descarga los mapas de OpenStreetMap de varios países (Geofabrik), saca de ellos las áreas de AC,
vaciados, puntos de agua y parkings para autocaravana, y los guarda en trocitos de 1x1 grado en
data/places/. Así la app no depende de ningún servidor externo para mostrar los lugares.
Necesita osmium-tool y curl."""
import datetime, json, os, subprocess, sys

REGIONS = ['spain', 'portugal', 'andorra', 'france', 'monaco', 'italy', 'switzerland', 'austria', 'germany',
           'belgium', 'luxembourg', 'netherlands', 'slovenia', 'croatia', 'greece', 'great-britain',
           'ireland-and-northern-ireland', 'denmark']
KEEP = {'name', 'fee', 'charge', 'opening_hours', 'capacity', 'maxstay', 'description', 'access', 'motorhome',
        'power_supply', 'toilets', 'shower', 'drinking_water', 'water_point', 'sanitary_dump_station',
        'sanitary_dump_station:grey_water', 'sanitary_dump_station:chemical_toilet', 'sanitary_dump_station:black_water',
        'grey_water', 'chemical_toilet', 'internet_access', 'website', 'amenity', 'tourism'}
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
OUT = os.path.join(ROOT, 'data', 'places')
TMP = os.environ.get('RUNNER_TEMP', '/tmp')


def wanted(t):
    if t.get('amenity') in ('sanitary_dump_station', 'water_point') or t.get('tourism') == 'caravan_site':
        return True
    return t.get('amenity') == 'parking' and t.get('motorhome') in ('yes', 'designated')


def coords(g):
    c = g['coordinates']
    if isinstance(c[0], (int, float)):
        return [c]
    while isinstance(c[0][0], list):
        c = [p for part in c for p in part]
    return c


def run(*cmd):
    print('$', ' '.join(cmd), flush=True)
    subprocess.run(cmd, check=True)


def extract(region, outfile):
    """Saca los lugares de un país y los guarda en outfile (lista JSON)."""
    pbf, flt, gj = (os.path.join(TMP, n) for n in ('r.osm.pbf', 'f.osm.pbf', 'f.geojsonseq'))
    run('curl', '-sSfL', '--retry', '8', '--retry-all-errors', '--retry-delay', '30', '-o', pbf, f'https://download.geofabrik.de/europe/{region}-latest.osm.pbf')
    run('osmium', 'tags-filter', pbf, 'nwr/amenity=sanitary_dump_station,water_point', 'nwr/tourism=caravan_site',
        'nwr/motorhome=yes,designated', '-o', flt, '--overwrite')
    os.remove(pbf)
    run('osmium', 'export', flt, '-f', 'geojsonseq', '-x', 'print_record_separator=false', '-a', 'type,id',
        '--geometry-types=point,linestring,polygon', '-o', gj, '--overwrite')
    items = []
    with open(gj) as fh:
        for line in fh:
            line = line.strip().lstrip('\x1e')
            if not line:
                continue
            f = json.loads(line)
            p = f['properties']
            if not wanted(p):
                continue
            cs = coords(f['geometry'])
            lon = sum(c[0] for c in cs) / len(cs)
            lat = sum(c[1] for c in cs) / len(cs)
            t = {k: (v[:200] if k == 'description' else v) for k, v in p.items() if k in KEEP}
            items.append([p['@type'][0] + str(p['@id']), round(lat, 5), round(lon, 5), t])
    with open(outfile, 'w') as fh:
        json.dump(items, fh, ensure_ascii=False)
    print(f'{region}: {len(items)} lugares', flush=True)


def merge(folder):
    """Junta los países en trocitos de 1x1 grado dentro de data/places."""
    tiles, seen, total, done = {}, set(), 0, []
    for name in sorted(os.listdir(folder)):
        if not name.endswith('.json'):
            continue
        done.append(name[:-5])
        for key, lat, lon, t in json.load(open(os.path.join(folder, name))):
            if key in seen:
                continue
            seen.add(key)
            tiles.setdefault(f'{int(lat // 1)}_{int(lon // 1)}', []).append([key, lat, lon, t])
            total += 1
    if total < 1000:
        sys.exit(f'Muy pocos lugares ({total}); no se guarda nada.')
    os.makedirs(OUT, exist_ok=True)
    for f in os.listdir(OUT):
        os.remove(os.path.join(OUT, f))
    for k, v in tiles.items():
        with open(os.path.join(OUT, k + '.json'), 'w') as fh:
            json.dump(v, fh, ensure_ascii=False, separators=(',', ':'))
    with open(os.path.join(OUT, 'index.json'), 'w') as fh:
        json.dump({'updated': datetime.date.today().isoformat(), 'total': total, 'regions': done,
                   'tiles': sorted(tiles)}, fh)
    print('total', total, 'trozos', len(tiles), 'países', ', '.join(done))


if __name__ == '__main__':
    if sys.argv[1] == 'extract':
        extract(sys.argv[2], sys.argv[3])
    else:
        merge(sys.argv[2])
