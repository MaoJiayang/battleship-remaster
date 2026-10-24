import argparse
import hashlib
import json
import re
import subprocess
import sys
import tarfile
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description="从用户已有的微软工具链归档补齐私有标准头文件，不修改系统 PATH 或驱动。")
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--archive", type=Path, required=True)
    parser.add_argument("--sha256", required=True)
    parser.add_argument("--msvc", required=True)
    parser.add_argument("--sdk", required=True)
    arguments = parser.parse_args()
    if not all(re.fullmatch(r"[0-9.]+", value) for value in (arguments.msvc, arguments.sdk)):
        parser.error("工具链版本只能包含数字与点。")
    root = arguments.root.resolve(strict=True)
    archive = arguments.archive.resolve(strict=True)
    if not archive.is_relative_to(root) or Path(sys.prefix).resolve() != root / "venv-rocm":
        raise RuntimeError("请使用集中目录的 ROCm 虚拟环境，归档也应位于该目录内。")
    digest = hashlib.file_digest(archive.open("rb"), "sha256").hexdigest()
    if digest != arguments.sha256.lower():
        raise ValueError("标准头文件归档校验失败。")
    target = root / "toolchain-headers" / f"msvc-{arguments.msvc}-sdk-{arguments.sdk}"
    if not target.exists():
        target.mkdir(parents=True)
        with tarfile.open(archive) as contents:
            for member in contents:
                if not (target / member.name).resolve().is_relative_to(target.resolve()):
                    raise ValueError("归档路径超出指定目录。")
            contents.extractall(target, filter="data")
    for relative in ("include/type_traits", "include/vcruntime.h", "ucrt/corecrt.h", "shared/sal.h"):
        if not (target / relative).is_file():
            raise FileNotFoundError(f"标准头文件不完整：{relative}")
    includes = [target / name for name in ("include", "ucrt", "shared")]
    result = root / "results" / f"gru-msvc-{arguments.msvc}-sdk-{arguments.sdk}.json"
    if not result.exists():
        subprocess.run([sys.executable, str(Path(__file__).with_name("check-gru-backend.py")), "--includes",
                        *map(str, includes), "--output", str(result)], check=True)
    validation = json.loads(result.read_text(encoding="utf-8"))
    if validation.get("ok") is not True:
        raise RuntimeError("原生 GRU 验证未通过，未启用头文件配置。")
    configuration = {"source": "user-local Microsoft Visual Studio Build Tools 2022 and Windows SDK",
                     "msvc": arguments.msvc, "sdk": arguments.sdk, "archive_sha256": digest,
                     "include_directories": [directory.relative_to(root).as_posix() for directory in includes],
                     "validation": result.relative_to(root).as_posix()}
    manifest = root / "rocm-headers.json"
    if manifest.exists() and json.loads(manifest.read_text(encoding="utf-8")) != configuration:
        raise RuntimeError("已有不同的头文件配置，请先核对后再更新。")
    manifest.write_text(json.dumps(configuration, indent=2), encoding="utf-8")
    print(json.dumps(configuration), flush=True)


if __name__ == "__main__":
    main()
