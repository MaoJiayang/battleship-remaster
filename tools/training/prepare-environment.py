import argparse
import struct
import subprocess
import sys
import venv
from pathlib import Path


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description="在指定目录配置隔离的 PyTorch＋ROCm 环境，普通依赖使用阿里源，AMD 专用包使用官方源。")
    parser.add_argument("--root", required=True, type=Path, help="统一存放解释器、虚拟环境及结果的目录")
    arguments = parser.parse_args()
    environment_root = arguments.root.resolve(strict=True)
    expected_python = environment_root / "python312" / "python.exe"
    if sys.version_info[:2] != (3, 12) or struct.calcsize("P") != 8:
        raise RuntimeError("需要 Python 3.12（64 位）。")
    if Path(sys.executable).resolve() != expected_python.resolve():
        raise RuntimeError(f"请使用集中目录内的解释器运行：{expected_python}")

    virtual_directory = environment_root / "venv-rocm"
    virtual_python = virtual_directory / "Scripts" / "python.exe"
    cache_directory = environment_root / "pip-cache"
    log_directory = environment_root / "logs"
    result_directory = environment_root / "results"
    for directory in (cache_directory, log_directory, result_directory):
        directory.mkdir(exist_ok=True)
    if not virtual_python.exists():
        venv.EnvBuilder(with_pip=True).create(virtual_directory)

    mirror_url = "https://mirrors.aliyun.com/pypi/simple/"
    (virtual_directory / "pip.ini").write_text(
        f"[global]\nindex-url = {mirror_url}\ncache-dir = {cache_directory}\ndisable-pip-version-check = true\n",
        encoding="utf-8",
    )
    script_directory = Path(__file__).resolve().parent
    subprocess.run(
        [str(virtual_python), "-m", "pip", "--isolated", "--cache-dir", str(cache_directory),
         "--log", str(log_directory / "pip-install.log"), "install", "--index-url", mirror_url,
         "-r", str(script_directory / "requirements-common.txt")],
        check=True,
    )
    subprocess.run(
        [str(virtual_python), "-m", "pip", "--isolated", "--cache-dir", str(cache_directory),
         "--log", str(log_directory / "pip-rocm-install.log"), "install", "--index-url", mirror_url,
         "--no-deps", "--no-build-isolation", "--timeout", "120",
         "-r", str(script_directory / "requirements-rocm.txt")],
        check=True,
    )
    subprocess.run([str(virtual_python), "-m", "pip", "check"], check=True)
    installed = subprocess.run([str(virtual_python), "-m", "pip", "freeze"], check=True, capture_output=True, text=True)
    (environment_root / "requirements-installed.txt").write_text(installed.stdout, encoding="utf-8")
    subprocess.run(
        [str(virtual_python), str(script_directory / "check-environment.py"), "--backend", "rocm", "--attention-smoke", "--output",
         str(result_directory / "environment-check.json")],
        check=True,
    )


if __name__ == "__main__":
    main()
