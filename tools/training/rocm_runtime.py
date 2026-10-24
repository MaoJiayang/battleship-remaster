import json
import os
import sys
from pathlib import Path


def configure_headers():
    root = Path(sys.prefix).resolve().parent
    manifest = root / "rocm-headers.json"
    if not manifest.exists():
        return None
    configuration = json.loads(manifest.read_text(encoding="utf-8"))
    directories = [(root / name).resolve(strict=True) for name in configuration["include_directories"]]
    if any(not directory.is_relative_to(root) or " " in str(directory) for directory in directories):
        raise ValueError("标准头文件目录必须位于集中训练目录内，且路径不能含空格。")
    options = " ".join(f"-I{directory.as_posix()}" for directory in directories)
    current = os.environ.get("HIPRTC_COMPILE_OPTIONS_APPEND", "")
    if options not in current:
        os.environ["HIPRTC_COMPILE_OPTIONS_APPEND"] = f"{current} {options}".strip()
    return configuration
