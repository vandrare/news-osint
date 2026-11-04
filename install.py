#!/usr/bin/env python3
"""Install a user-owned launcher and application menu entry."""
from pathlib import Path
import shlex

root = Path(__file__).resolve().parent
launcher = Path.home() / '.local/bin/news-osint'
desktop = Path.home() / '.local/share/applications/news-osint.desktop'
launcher.parent.mkdir(parents=True, exist_ok=True)
desktop.parent.mkdir(parents=True, exist_ok=True)
launcher.write_text('#!/bin/sh\nexec python3 ' + shlex.quote(str(root / 'launch.py')) + ' "$@"\n')
launcher.chmod(0o755)
desktop.write_text('[Desktop Entry]\nType=Application\nName=News-OSINT\n'
                   'Comment=Your local news and geographic research desk\n'
                   f'Exec={launcher}\nIcon={root}/static/icon.svg\n'
                   'Terminal=false\nCategories=Network;News;\nStartupWMClass=news-osint\n')
print('Installed News-OSINT. Launch from the application menu or run news-osint.')
