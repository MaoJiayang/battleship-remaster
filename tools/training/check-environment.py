import argparse
import copy
import importlib.metadata
import json
import math
import platform
import sys
import time
import warnings
from pathlib import Path

import torch


def create_network():
    return torch.nn.Sequential(
        torch.nn.Linear(64, 64),
        torch.nn.ReLU(),
        torch.nn.Linear(64, 32),
        torch.nn.ReLU(),
        torch.nn.Linear(32, 1),
    )


def check_training(reference, features, labels, device):
    network = copy.deepcopy(reference).to(device)
    device_features = features.to(device)
    device_labels = labels.to(device)
    criterion = torch.nn.BCEWithLogitsLoss()
    optimizer = torch.optim.AdamW(network.parameters(), lr=0.01, foreach=False)
    with torch.no_grad():
        logits = network(device_features).cpu()
        reference_logits = reference(features)
        maximum_error = (logits - reference_logits).abs().max().item()
        initial_loss = criterion(network(device_features), device_labels).item()
    if maximum_error > 0.0005:
        raise RuntimeError(f"前向计算与 CPU 不一致，最大差值为 {maximum_error}")

    for training_step in range(5):
        optimizer.zero_grad(set_to_none=True)
        loss = criterion(network(device_features), device_labels)
        loss.backward()
        optimizer.step()
    loss.item()
    started = time.perf_counter()
    for training_step in range(60):
        optimizer.zero_grad(set_to_none=True)
        loss = criterion(network(device_features), device_labels)
        loss.backward()
        optimizer.step()
    with torch.no_grad():
        final_loss = criterion(network(device_features), device_labels).item()
    elapsed_ms = (time.perf_counter() - started) * 1000
    if not math.isfinite(final_loss) or final_loss >= initial_loss:
        raise RuntimeError(f"训练损失未下降：{initial_loss} → {final_loss}")
    return {
        "initial_loss": initial_loss,
        "final_loss": final_loss,
        "forward_maximum_error": maximum_error,
        "training_steps": 60,
        "training_ms": elapsed_ms,
        "samples_per_second": 60 * len(features) / (elapsed_ms / 1000),
    }


def select_accelerator(backend):
    if backend == "directml":
        import torch_directml

        devices = [torch_directml.device_name(index).rstrip("\x00") for index in range(torch_directml.device_count())]
        matches = [index for index, name in enumerate(devices) if "9060 XT" in name]
        if len(matches) != 1:
            raise RuntimeError(f"需要唯一的 RX 9060 XT，当前设备为：{devices}")
        return torch_directml.device(matches[0]), devices, devices[matches[0]]
    if backend == "rocm":
        if not torch.version.hip or not torch.cuda.is_available():
            raise RuntimeError("当前 PyTorch 没有可用的 ROCm 显卡后端。")
        devices = [torch.cuda.get_device_name(index) for index in range(torch.cuda.device_count())]
        matches = [index for index, name in enumerate(devices) if "9060 XT" in name]
        if len(matches) != 1:
            raise RuntimeError(f"需要唯一的 RX 9060 XT，当前设备为：{devices}")
        return torch.device("cuda", matches[0]), devices, devices[matches[0]]
    return None, [], None


def check_attention(device):
    torch.manual_seed(240125)
    reference = torch.nn.MultiheadAttention(32, 2, dropout=0, batch_first=True)
    network = copy.deepcopy(reference).to(device)
    features = torch.randn(4, 16, 32)
    with torch.no_grad():
        expected, _ = reference(features, features, features, need_weights=False)
    device_features = features.to(device)
    actual, _ = network(device_features, device_features, device_features, need_weights=False)
    maximum_error = (actual.detach().cpu() - expected).abs().max().item()
    loss = actual.square().mean()
    loss.backward()
    finite_gradients = all(
        parameter.grad is not None and torch.isfinite(parameter.grad).all().item()
        for parameter in network.parameters()
    )
    if maximum_error > 0.0005 or not finite_gradients:
        raise RuntimeError(f"注意力验证失败：最大差值 {maximum_error}，梯度有限 {finite_gradients}")
    return {"embedding": 32, "heads": 2, "tokens": 16, "forward_maximum_error": maximum_error, "finite_gradients": finite_gradients}


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description="验证小型胜率网络的前向、反向与参数更新；使用合成数据，不评价棋力或手机性能。")
    parser.add_argument("--output", type=Path, help="保存验证结果的 JSON 路径")
    parser.add_argument("--backend", choices=("cpu", "directml", "rocm"), default="rocm", help="选择训练后端，显卡后端同时与 CPU 对照")
    parser.add_argument("--batch-size", type=int, default=1024, help="合成数据的批量大小")
    parser.add_argument("--attention-smoke", action="store_true", help="额外验证 32 维双头注意力的前向与反向计算")
    arguments = parser.parse_args()
    if arguments.batch_size <= 0:
        parser.error("批量大小必须大于零。")
    accelerator, devices, selected_device = select_accelerator(arguments.backend)
    torch.set_num_threads(1)
    torch.manual_seed(240124)
    network = create_network()
    features = torch.randn(arguments.batch_size, 64)
    labels = (features[:, :1] + 0.5 * features[:, 1:2] > 0).float()
    report = {
        "purpose": "合成数据环境验证，不是棋力或手机性能验收",
        "python": platform.python_version(),
        "torch": torch.__version__,
        "backend": arguments.backend,
        "parameters": sum(parameter.numel() for parameter in network.parameters()),
        "cpu_threads": torch.get_num_threads(),
        "batch_size": len(features),
        "cpu": check_training(network, features, labels, torch.device("cpu")),
    }
    if accelerator is not None:
        if arguments.backend == "directml":
            report["torch_directml"] = importlib.metadata.version("torch-directml")
        else:
            report["hip"] = torch.version.hip
        report["devices"] = devices
        report["selected_device"] = selected_device
        with warnings.catch_warnings(record=True) as captured:
            warnings.simplefilter("always")
            report[arguments.backend] = check_training(network, features, labels, accelerator)
            if arguments.attention_smoke:
                report["attention"] = check_attention(accelerator)
        report["warnings"] = list(dict.fromkeys(str(warning.message) for warning in captured))
    elif arguments.attention_smoke:
        report["attention"] = check_attention(torch.device("cpu"))
    serialized = json.dumps(report, ensure_ascii=False, indent=2)
    if arguments.output:
        arguments.output.parent.mkdir(parents=True, exist_ok=True)
        arguments.output.write_text(serialized + "\n", encoding="utf-8")
    print(serialized)


if __name__ == "__main__":
    main()
