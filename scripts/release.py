#!/usr/bin/env python3
"""Stamp a new version on every page so phones load the latest files.

Browsers keep copies of the site's files for a while. Each page loads its CSS
and JavaScript with ?v=<version>, and an import map adds the same version to
the shared modules, so a new version means fresh files everywhere.

Usage: python3 scripts/release.py            (uses today's date + time)
       python3 scripts/release.py 20261031a  (explicit version)
"""
import glob
import json
import re
import sys
from datetime import datetime, timezone, timedelta

SHARED = ['js/config.js', 'js/api.js', 'js/ui.js', 'js/posts.js']

version = sys.argv[1] if len(sys.argv) > 1 else datetime.now(timezone(timedelta(hours=5, minutes=30))).strftime('%Y%m%d%H%M')
imports = {f'./{m}': f'./{m}?v={version}' for m in SHARED}
importmap = f'  <script type="importmap">{json.dumps({"imports": imports})}</script>\n'

for page in sorted(glob.glob('*.html')):
    html = open(page).read()
    html = re.sub(r'  <script type="importmap">.*?</script>\n', '', html)
    html = re.sub(r'href="css/style\.css(\?v=[^"]*)?"', f'href="css/style.css?v={version}"', html)
    html = re.sub(r'src="(js/pages/[a-z]+\.js)(\?v=[^"]*)?"', rf'src="\1?v={version}"', html)
    # The import map must come before any module script.
    html = html.replace('  <link rel="stylesheet"', importmap + '  <link rel="stylesheet"', 1)
    open(page, 'w').write(html)
    print(f'{page}: v={version}')
