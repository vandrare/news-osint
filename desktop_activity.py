"""Crash-expiring desktop activity signal; contains no article text."""
import json
import os
from pathlib import Path
import threading
import time


class ActivityPulse:
    def __init__(self, state_dir, model, mode):
        self.path = Path(state_dir) / 'ollama-activity.json'
        self.model = model
        self.mode = mode
        self.stage = 'loading'
        self.stop_event = threading.Event()
        self.thread = None

    def write(self, active):
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            value = dict(active=active, at=time.time(), pid=os.getpid(), model=self.model,
                         mode=self.mode, stage=self.stage)
            temporary = self.path.with_suffix('.tmp')
            temporary.write_text(json.dumps(value))
            temporary.replace(self.path)
        except OSError:
            # The optional desktop indicator must never interrupt analysis.
            pass

    def heartbeat(self):
        while not self.stop_event.wait(1):
            self.write(True)

    def __enter__(self):
        self.write(True)
        self.thread = threading.Thread(target=self.heartbeat, name='ollama-orb', daemon=True)
        self.thread.start()
        return self

    def update(self, event):
        self.stage = event.get('stage', self.stage)

    def __exit__(self, *args):
        self.stop_event.set()
        self.thread.join()
        self.write(False)
