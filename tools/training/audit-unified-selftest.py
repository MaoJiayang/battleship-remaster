import argparse
import copy
import hashlib
import json
import runpy
import tempfile
from pathlib import Path

import numpy as np


def main():
    parser = argparse.ArgumentParser(description="用真实冷启动分片验证数据审计能拒绝语义错误。")
    parser.add_argument("data", type=Path)
    arguments = parser.parse_args()
    audit = runpy.run_path(str(Path(__file__).with_name("audit-unified-data.py")))["audit"]
    original = json.loads((arguments.data / "manifest.json").read_text(encoding="utf-8"))
    entry = original["shards"][0]
    with np.load(arguments.data / entry["file"], allow_pickle=False) as archive:
        arrays = {key: archive[key] for key in archive.files}
    changes = {
        "future-history": lambda data: data["length"].__setitem__(0, data["length"][0] + 1),
        "cross-split": lambda data: data["validation"].__setitem__(0, not data["validation"][0]),
        "wrong-winner": lambda data: data["return"].__setitem__(0, 1 - data["return"][0]),
        "illegal-action": lambda data: data["action"].__setitem__(0, data["ownCounts"][0] * original["layout"]["height"] * original["layout"]["width"])
    }
    audit(arguments.data)
    try:
        audit(arguments.data, "wrong-rules")
    except ValueError:
        pass
    else:
        raise RuntimeError("数据审计漏过了规则版本错误。")
    with tempfile.TemporaryDirectory(prefix="naval-unified-audit-") as directory:
        root = Path(directory).resolve()
        if root.parent != Path(tempfile.gettempdir()).resolve():
            raise RuntimeError("临时测试路径不在预期目录。")
        for name, change in changes.items():
            target = root / name
            target.mkdir()
            modified = {key: value.copy() for key, value in arrays.items()}
            change(modified)
            np.savez_compressed(target / entry["file"], **modified)
            manifest = copy.deepcopy(original)
            manifest["shards"] = [manifest["shards"][0]]
            manifest["arguments"]["batches"] = 1
            manifest["shards"][0]["sha256"] = hashlib.sha256((target / entry["file"]).read_bytes()).hexdigest()
            (target / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
            try:
                audit(target)
            except ValueError:
                continue
            raise RuntimeError(f"数据审计漏过语义错误：{name}")
    print("UNIFIED DATA AUDIT SELFTEST OK: 规则、历史、分割、胜负及非法行动")


if __name__ == "__main__":
    main()
