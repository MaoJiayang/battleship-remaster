import argparse
import json
import os
import time
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description="验证原生显卡 GRU、等价实现及标准头文件搜索路径，仅影响当前进程。")
    parser.add_argument("--includes", type=Path, nargs="*", default=[])
    parser.add_argument("--output", type=Path, required=True)
    arguments = parser.parse_args()
    if arguments.output.exists():
        parser.error("输出必须是新文件。")
    if arguments.includes:
        directories = [directory.resolve(strict=True) for directory in arguments.includes]
        if any(" " in str(directory) for directory in directories):
            raise ValueError("HIPRTC 头文件目录请使用无空格路径。")
        os.environ["HIPRTC_COMPILE_OPTIONS_APPEND"] = " ".join(f'-I{directory.as_posix()}' for directory in directories)
    else:
        from rocm_runtime import configure_headers
        configure_headers()
    import torch
    torch.set_num_threads(2)
    torch.manual_seed(240124)
    devices = [index for index in range(torch.cuda.device_count()) if "9060 XT" in torch.cuda.get_device_name(index)]
    if len(devices) != 1:
        raise RuntimeError("需要唯一的 RX 9060 XT。")
    device = torch.device("cuda", devices[0])
    report = {"torch": torch.__version__, "device": torch.cuda.get_device_name(device),
              "compiler_options": os.environ.get("HIPRTC_COMPILE_OPTIONS_APPEND", ""), "cases": []}
    try:
        for batch, steps in ((1, 1), (32, 40)):
            cpu = torch.nn.GRU(16, 16, batch_first=True)
            native = torch.nn.GRU(16, 16, batch_first=True).to(device)
            native.load_state_dict(cpu.state_dict())
            source = torch.randn(batch, steps, 16)
            reference, _ = cpu(source)
            reference.square().mean().backward()
            inputs = source.to(device)
            started = time.perf_counter()
            actual, _ = native(inputs)
            actual.square().mean().backward()
            torch.cuda.synchronize(device)
            first_seconds = time.perf_counter() - started
            error = (actual.cpu() - reference).abs().max().item()
            gradient_error = max((parameter.grad.cpu() - target.grad).abs().max().item()
                                 for parameter, target in zip(native.parameters(), cpu.parameters()))
            if error > 1e-4 or gradient_error > 1e-4:
                raise RuntimeError("原生 GRU 与 CPU 前后向不一致。")
            optimizer = torch.optim.AdamW(native.parameters(), lr=0.001, foreach=False)
            started = time.perf_counter()
            for update in range(20):
                optimizer.zero_grad(set_to_none=True)
                prediction, _ = native(inputs)
                prediction.square().mean().backward()
                optimizer.step()
            torch.cuda.synchronize(device)
            report["cases"].append({"batch": batch, "steps": steps, "maximum_error": error,
                                    "gradient_error": gradient_error, "cold_seconds": first_seconds,
                                    "twenty_updates_seconds": time.perf_counter() - started})
        report["ok"] = True
    except Exception as error:
        report.update(ok=False, error=str(error))
        raise
    finally:
        arguments.output.write_text(json.dumps(report, indent=2), encoding="utf-8")
        print(json.dumps(report), flush=True)


if __name__ == "__main__":
    main()
