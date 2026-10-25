import argparse
import json
from pathlib import Path

from unified_model import UnifiedNetwork, unified_batch, load_unified

import torch
from torch.nn import functional


def distribution(network, records, device):
    batch = unified_batch(records, device)
    logits, values = network(batch)
    return logits.masked_fill(~batch["mask"], -1e9), values


def main():
    parser = argparse.ArgumentParser(description="验证统一模型的显卡梯度、变长输入及部署数值对照。")
    parser.add_argument("fixtures", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--cpu", action="store_true")
    parser.add_argument("--width-multiplier", type=int, choices=(1, 2), default=1)
    arguments = parser.parse_args()
    arguments.output.mkdir(parents=True, exist_ok=False)
    torch.set_num_threads(2)
    if arguments.cpu:
        device = torch.device("cpu")
    else:
        devices = [index for index in range(torch.cuda.device_count()) if "9060 XT" in torch.cuda.get_device_name(index)]
        if len(devices) != 1:
            raise RuntimeError("需要唯一的 RX 9060 XT。")
        device = torch.device("cuda", devices[0])
    records = json.loads(arguments.fixtures.read_text(encoding="utf-8"))
    groups = {}
    for record in records:
        observation = record["observation"]
        groups.setdefault((observation["height"], observation["width"]), []).append(record)
    trained = [record for record in records if "action" in record]
    reports = []
    for kind in ("gru", "attention"):
        torch.manual_seed(251026)
        network = UnifiedNetwork(kind, {"widthMultiplier": arguments.width_multiplier}).to(device)
        optimizer = torch.optim.AdamW(network.parameters(), lr=0.001, foreach=False)
        labels = torch.tensor([record["action"] for record in trained], device=device)
        losses = []
        network.train()
        value_targets = torch.tensor([index % 2 for index in range(len(trained))], dtype=torch.float32, device=device)
        for step in range(4):
            logits, values = distribution(network, trained, device)
            loss = functional.cross_entropy(logits, labels) + functional.binary_cross_entropy_with_logits(values, value_targets)
            if not torch.isfinite(loss):
                raise RuntimeError("统一模型损失非有限。")
            losses.append(loss.item())
            optimizer.zero_grad(set_to_none=True)
            loss.backward()
            if any(parameter.grad is None or not torch.isfinite(parameter.grad).all() for parameter in network.parameters()):
                raise RuntimeError("统一模型存在未连接或非有限梯度。")
            optimizer.step()
        if losses[-1] >= losses[0]:
            raise RuntimeError("统一模型微型更新未降低损失。")
        network.eval()
        exported = network.export({"validatedRules": sorted({record["observation"]["rulesId"] for record in records}),
                                   "validationOnly": True, "testUpdates": 4})
        restored = UnifiedNetwork(kind, exported["architecture"]).to(device)
        load_unified(restored, exported)
        incompatible = {**exported, "architecture": {"widthMultiplier": 3 - arguments.width_multiplier}}
        try:
            load_unified(restored, incompatible)
        except ValueError:
            pass
        else:
            raise RuntimeError("统一模型接受了不匹配的宽度标识。")
        if arguments.width_multiplier == 1:
            legacy = {key: value for key, value in exported.items() if key != "architecture"}
            load_unified(restored, legacy)
        restored.eval()
        fixtures = []
        padding_error = 0.0
        with torch.no_grad():
            for selected in groups.values():
                logits, values = network(unified_batch(selected, device))
                restored_logits, restored_values = restored(unified_batch(selected, device))
                if not torch.allclose(logits, restored_logits, atol=1e-6) or not torch.allclose(values, restored_values, atol=1e-6):
                    raise RuntimeError("统一模型导出恢复不一致。")
                for index, record in enumerate(selected):
                    alone_logits, alone_values = network(unified_batch([record], device))
                    difference = max((alone_logits[0] - logits[index, :alone_logits.shape[1]]).abs().max().item(),
                                     (alone_values[0] - values[index]).abs().item())
                    padding_error = max(padding_error, difference)
                    fixtures.append({**record, "expected": {"logits": alone_logits[0].cpu().tolist(),
                        "valueLogit": alone_values[0].item(), "value": alone_values[0].sigmoid().item()}})
        if padding_error > 2e-5:
            raise RuntimeError(f"补齐批次改变了预测：{padding_error}")
        (arguments.output / f"{kind}.json").write_text(json.dumps(exported), encoding="utf-8")
        (arguments.output / f"{kind}-parity.json").write_text(json.dumps(fixtures), encoding="utf-8")
        reports.append({"kind": kind, "architecture": network.architecture,
                        "parameters": sum(parameter.numel() for parameter in network.parameters()),
                        "losses": losses, "paddingError": padding_error, "cases": len(fixtures)})
    report = {"device": str(device), "name": "CPU" if arguments.cpu else torch.cuda.get_device_name(device),
              "torch": str(torch.__version__), "reports": reports,
              "scope": "合成价值标签仅用于梯度检查，实际教师行动只做四次微型更新；不作棋力结论"}
    (arguments.output / "report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report), flush=True)


if __name__ == "__main__":
    main()
