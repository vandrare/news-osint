#!/usr/bin/env python3
"""Install and enable the optional Omarchy desktop activity orb."""
import datetime
import json
import os
from pathlib import Path
import shutil
import subprocess
import time


def main():
    if not shutil.which('omarchy') or not shutil.which('omarchy-shell'):
        raise SystemExit('The desktop orb requires Omarchy with omarchy-shell / Quickshell.')
    source = Path(__file__).resolve().parent / 'desktop/ollama-orb'
    target = Path.home() / '.config/omarchy/plugins/local.news-osint.ollama-orb'
    subprocess.run(['omarchy', 'plugin', 'validate', str(source)], check=True)
    if target.exists() or target.is_symlink():
        if target.resolve() != source:
            raise SystemExit(f'{target} already exists and belongs to another installation.')
    else:
        target.parent.mkdir(parents=True, exist_ok=True)
        target.symlink_to(source, target_is_directory=True)
    state = Path(os.environ.get('NEWS_OSINT_STATE', Path.home() / '.local/state/news-osint'))
    state.mkdir(parents=True, exist_ok=True)
    activity = state / 'ollama-activity.json'
    if not activity.exists():
        activity.write_text(json.dumps({'active': False, 'at': 0}))
    def find_entry():
        result = subprocess.run(['omarchy', 'plugin', 'list', '--json'], capture_output=True, text=True)
        if result.returncode:
            return None
        try:
            return next((item for item in json.loads(result.stdout) if item.get('id') == 'local.news-osint.ollama-orb'), None)
        except ValueError:
            return None
    entry = find_entry()
    if not entry:
        # Rescan may close its own IPC connection during hot-reload. Check the
        # resulting catalog rather than requiring a synchronous IPC answer.
        subprocess.run(['omarchy-shell', '-q', 'shell', 'rescanPlugins'])
        for _ in range(40):
            entry = find_entry()
            if entry:
                break
            time.sleep(.2)
        else:
            raise SystemExit('Omarchy did not discover the plugin. Try again after the shell finishes reloading.')
    if not entry.get('enabled'):
        settings = Path.home() / '.config/omarchy/shell.json'
        if settings.exists():
            stamp = datetime.datetime.now().strftime('%Y%m%d-%H%M%S')
            shutil.copy2(settings, settings.with_name('shell.json.news-osint-orb-backup-' + stamp))
        result = subprocess.run(['omarchy', 'plugin', 'enable', 'local.news-osint.ollama-orb'], capture_output=True, text=True)
        if result.returncode:
            # Shell hot-reload may close IPC after the enable has taken effect.
            catalog = subprocess.check_output(['omarchy', 'plugin', 'list', '--json'], text=True)
            if not any(item.get('id') == 'local.news-osint.ollama-orb' and item.get('enabled') for item in json.loads(catalog)):
                raise SystemExit(result.stderr or 'The orb could not be enabled.')
    print('Ollama orb installed: 400 × 400, bottom-right; hidden until News-OSINT runs inference.')


if __name__ == '__main__':
    main()
