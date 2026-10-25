import hashlib
import json
import os
import subprocess
from pathlib import Path


HISTORY_FEATURES = 258
HISTORY_SCHEMA = "naval-public-events-v1"


def validation_group(seed, index):
    return int(hashlib.sha256(f"expert|{seed}|{index}".encode()).hexdigest(), 16) % 5 == 0


def source_hash():
    root = Path(__file__).resolve().parents[2]
    filenames = sorted((root / "src").rglob("*.js")) + sorted(Path(__file__).parent.glob("*.py"))
    filenames += sorted(Path(__file__).parent.glob("*.mjs")) + sorted((root / "tools/sim").glob("*.mjs"))
    digest = hashlib.sha256()
    for filename in filenames:
        digest.update(filename.relative_to(root).as_posix().encode())
        digest.update(filename.read_bytes())
    return digest.hexdigest()


class Environment:
    def __init__(self, encoding="legacy"):
        self.encoding = encoding
        self.process = subprocess.Popen(["node", str(Path(__file__).with_name("policy-environment.mjs"))],
                                        stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, encoding="utf-8",
                                        creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)

    def call(self, request):
        if request.get("type") == "reset":
            request = {**request, "encoding": self.encoding}
        self.process.stdin.write(json.dumps(request) + "\n")
        self.process.stdin.flush()
        line = self.process.stdout.readline()
        if not line:
            raise RuntimeError("模拟环境提前退出。")
        result = json.loads(line)
        if "error" in result:
            raise RuntimeError(result["error"])
        return result

    def close(self):
        self.process.stdin.close()
        try:
            self.process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            self.process.kill()
            self.process.wait()
