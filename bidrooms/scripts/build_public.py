"""Compilación mecánica: recursos con dirección por contenido y rutas estables."""
import hashlib
import json
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parents[1]
manifest = json.loads((ROOT/'data/manifest.json').read_text())
assets = {}
for name in ['app.js','theme.css','navigation.js','config.js','needs.js']:
    raw = (ROOT/'assets'/name).read_bytes()
    # SHA de blob Git: misma identidad que la usada al conservar estos recursos.
    digest = hashlib.sha1(b'blob '+str(len(raw)).encode()+b'\0'+raw).hexdigest()
    stem, extension = name.rsplit('.',1)
    target = f'{stem}.{digest}.{extension}'
    assets[name] = target
    (ROOT/'assets'/target).write_bytes(raw)
manifest['assets'] = ['assets/'+x for x in assets.values()]
(ROOT/'data/manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
for html in ROOT.rglob('index.html'):
    if 'backend' in html.parts:
        continue
    value = html.read_text()
    value = re.sub(r'<meta name="bidrooms-build" content="[^"]*">','',value)
    value = value.replace('</head>',f'<meta name="bidrooms-build" content="{manifest["build_id"]}"></head>')
    for source, target in assets.items():
        stem, extension = source.rsplit('.',1)
        value = re.sub(r'assets/'+re.escape(stem)+r'(?:\.[a-f0-9]{40})?\.'+extension,'assets/'+target,value)
    if 'navigation.' not in value:
        match = re.search(r'<script src="([^"]*assets/)app\.[a-f0-9]{40}\.js"></script>',value)
        if match:
            value = value.replace('</body>','<script src="'+match[1]+assets['navigation.js']+'"></script></body>')
    html.write_text(value)
print('BIDROOMS_BUILD',manifest['build_id'],manifest['assets'])
