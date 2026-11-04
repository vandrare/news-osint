#!/usr/bin/env python3
"""Start the private local backend once, then open a standalone Chromium window."""
import fcntl
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time
import urllib.request

ROOT = Path(__file__).resolve().parent
STATE = Path.home() / '.local/state/news-osint'
PORT = 47831
URL = f'http://127.0.0.1:{PORT}'


def healthy():
    try:
        with urllib.request.urlopen(URL + '/api/health', timeout=1) as r:
            return json.load(r).get('app') == 'news-osint'
    except Exception:
        return False


def main():
    STATE.mkdir(parents=True, exist_ok=True)
    with (STATE / 'launch.lock').open('w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if not healthy():
            with (STATE / 'server.log').open('a') as log:
                process = subprocess.Popen([sys.executable, str(ROOT / 'server.py'), '--port', str(PORT)],
                                           stdin=subprocess.DEVNULL, stdout=log, stderr=log,
                                           start_new_session=True, cwd=ROOT)
            for _ in range(50):
                if healthy():
                    break
                if process.poll() is not None:
                    raise SystemExit('News-OSINT could not start. See ' + str(STATE / 'server.log'))
                time.sleep(.1)
            else:
                raise SystemExit('News-OSINT startup timed out. See ' + str(STATE / 'server.log'))
    if '--server-only' in sys.argv:
        print(URL)
        return
    browser = shutil.which('chromium') or shutil.which('google-chrome')
    if browser:
        subprocess.Popen([browser, '--app=' + URL, '--class=news-osint',
                          '--user-data-dir=' + str(STATE / 'browser'), '--no-first-run',
                          '--window-size=1500,1000'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                         start_new_session=True)
    else:
        import webbrowser
        webbrowser.open(URL)


if __name__ == '__main__':
    main()
