"""Build an offline, searchable model catalogue from original Kenney CC0 packs.

Only self-contained static GLBs and one original isometric thumbnail per model ship.
Archives are fetched on demand in the app, never all decompressed at startup.
Original downloads stay in .cache; every shipped bank and source archive has a hash.
"""
from __future__ import annotations

import concurrent.futures
import hashlib
import http.cookiejar
import io
import json
import posixpath
from pathlib import Path
import re
import struct
import urllib.request
import zipfile
from importlib.util import module_from_spec, spec_from_file_location

_spec = spec_from_file_location('game_assets', Path(__file__).with_name('vendor-game-assets.py'))
_vendor = module_from_spec(_spec)
_spec.loader.exec_module(_vendor)

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / '.cache/catalog-research'
OUT = ROOT / 'apps/web/public/models/catalog'
PACKS = {
    'nature-kit': ('Natureza', 'Natureza'),
    'mini-forest': ('Mini Floresta', 'Natureza'),
    'modular-cave-kit': ('Cavernas modulares', 'Natureza'),
    'graveyard-kit': ('Cemitério', 'Masmorras'),
    'modular-dungeon-kit': ('Masmorras modulares', 'Masmorras'),
    'mini-dungeon': ('Mini Masmorra', 'Masmorras'),
    'castle-kit': ('Castelos', 'Fantasia'),
    'fantasy-town-kit': ('Vila de fantasia', 'Fantasia'),
    'pirate-kit': ('Piratas', 'Fantasia'),
    'survival-kit': ('Sobrevivência', 'Aventura'),
    'platformer-kit': ('Plataformas', 'Aventura'),
    'furniture-kit': ('Móveis', 'Interiores'),
    'food-kit': ('Comida', 'Interiores'),
    'mini-shop': ('Mini Loja', 'Interiores'),
    'mini-arcade': ('Fliperamas', 'Interiores'),
    'city-kit-commercial': ('Cidade comercial', 'Cidade'),
    'city-kit-suburban': ('Subúrbio', 'Cidade'),
    'city-kit-industrial': ('Indústria', 'Cidade'),
    'city-kit-roads': ('Ruas', 'Cidade'),
    'factory-kit': ('Fábricas', 'Cidade'),
    'car-kit': ('Carros', 'Veículos'),
    'watercraft-kit': ('Embarcações', 'Veículos'),
    'train-kit': ('Trens', 'Veículos'),
    'racing-kit': ('Corridas', 'Veículos'),
    'space-kit': ('Espaço', 'Ficção científica'),
    'space-station-kit': ('Estações espaciais', 'Ficção científica'),
    'modular-space-kit': ('Módulos espaciais', 'Ficção científica'),
    'blaster-kit': ('Armas de energia', 'Equipamento'),
    'holiday-kit': ('Festas', 'Decoração'),
    'toy-car-kit': ('Carros de brinquedo', 'Veículos'),
    'tower-defense-kit': ('Defesa de torres', 'Fantasia'),
    'building-kit': ('Edifícios', 'Cidade'),
    'retro-fantasy-kit': ('Fantasia retrô', 'Fantasia'),
    'retro-urban-kit': ('Cidade retrô', 'Cidade'),
}


def process(slug: str):
    title, category = PACKS[slug]
    source = f'https://kenney.nl/assets/{slug}'
    cached = CACHE / f'{slug}.zip'
    if not cached.exists():
        opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
        opener.addheaders = [('User-Agent', 'Forma-CC0-library/1.0'), ('Referer', source)]
        page = opener.open(source, timeout=30).read().decode()
        if 'creativecommons.org/publicdomain/zero/' not in page:
            raise ValueError(f'{slug}: source does not declare CC0')
        link = json.load(opener.open('https://kenney.nl/download-link/' + f'assets/{slug}'.encode().hex(), timeout=30))['url']
        payload = opener.open(link, timeout=90).read()
        cached.write_bytes(payload)
    original = cached.read_bytes()
    archive = zipfile.ZipFile(io.BytesIO(original))
    licenses = [n for n in archive.namelist() if n.lower().endswith('license.txt')]
    if not licenses or not any('CC0' in archive.read(n).decode(errors='replace') for n in licenses):
        raise ValueError(f'{slug}: missing original CC0 license')
    entries, skipped, thumbnails = [], [], {}
    for name in archive.namelist():
        if name.lower().startswith('previews/') and name.lower().endswith('.png'):
            thumbnails[Path(name).stem.lower()] = name
        if name.lower().endswith(('_ne.png', '_se.png')):
            key = Path(name).stem[:-3].lower()
            if key not in thumbnails or name.lower().endswith('_ne.png'):
                thumbnails[key] = name
    destination = io.BytesIO()
    with zipfile.ZipFile(destination, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as bank:
        for name in licenses:
            bank.writestr('LICENSE.txt', archive.read(name)); break
        for item in archive.infolist():
            if not item.filename.lower().endswith('.glb'):
                continue
            payload = archive.read(item.filename)
            doc = json.loads(payload[20:20 + struct.unpack_from('<I', payload, 12)[0]])
            # Animated imports require a rig adapter, not a misleading frozen character.
            if doc.get('skins') or doc.get('animations'):
                skipped.append(item.filename); continue
            json_length=struct.unpack_from('<I',payload,12)[0]
            binary=payload[28+json_length:]
            for image in doc.get('images', []):
                if 'uri' not in image or image['uri'].startswith('data:'):
                    continue
                uri=image.pop('uri')
                if '://' in uri:
                    raise ValueError(f'{slug}: remote image dependency {uri}')
                path=posixpath.normpath(posixpath.join(posixpath.dirname(item.filename),uri))
                if path not in archive.namelist():
                    matches=[n for n in archive.namelist() if Path(n).name == Path(uri).name]
                    if len(matches)!=1:
                        raise ValueError(f'{slug}: ambiguous missing image {uri}')
                    path=matches[0]
                image_data=archive.read(path)
                binary+=b'\0'*(-len(binary)%4)
                image['bufferView']=len(doc['bufferViews']);image['mimeType']='image/png' if path.lower().endswith('.png') else 'image/jpeg'
                doc['bufferViews'].append({'buffer':0,'byteOffset':len(binary),'byteLength':len(image_data)})
                binary+=image_data
            payload=_vendor.pack_glb(doc,binary)
            stem = Path(item.filename).stem
            entry = f'{stem}.glb'
            if any(x['entry'] == entry for x in entries):
                continue
            bank.writestr(entry, payload)
            thumbnail = thumbnails.get(stem.lower())
            if thumbnail:
                bank.writestr(f'{stem}.png', archive.read(thumbnail))
            label = re.sub(r'(?<=[a-z])(?=[A-Z])', ' ', stem).replace('_', ' ').replace('-', ' ')
            entries.append({'id': f'kenney:{slug}:{stem}', 'name': label[0].upper()+label[1:], 'pack': slug, 'entry': entry, 'thumbnail': f'{stem}.png' if thumbnail else None, 'bytes': len(payload), 'sha256': hashlib.sha256(payload).hexdigest()})
    payload = destination.getvalue()
    (OUT / f'{slug}.zip').write_bytes(payload)
    print(f'{slug}: {len(entries)} models, {len(payload):,} bank bytes, {len(skipped)} unsupported animated files excluded', flush=True)
    return {'id': slug, 'name': title, 'category': category, 'style': 'Estilizado', 'author': 'Kenney', 'license': 'CC0-1.0', 'source': source, 'file': f'{slug}.zip', 'bytes': len(payload), 'sha256': hashlib.sha256(payload).hexdigest(), 'sourceArchiveSha256': hashlib.sha256(original).hexdigest(), 'models': len(entries), 'excludedAnimated': len(skipped)}, entries


def main():
    CACHE.mkdir(parents=True, exist_ok=True); OUT.mkdir(parents=True, exist_ok=True)
    with concurrent.futures.ThreadPoolExecutor(4) as pool:
        results = list(pool.map(process, PACKS))
    packs, groups = zip(*results)
    models = [model for group in groups for model in group]
    manifest = {'version': 1, 'license': 'CC0-1.0', 'packs': packs, 'models': models}
    (OUT / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, separators=(',', ':'))+'\n', encoding='utf-8')
    print(f'TOTAL: {len(models)} importable models; {sum(pack["bytes"] for pack in packs):,} archive bytes', flush=True)


if __name__ == '__main__':
    main()
