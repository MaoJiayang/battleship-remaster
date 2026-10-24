import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
import torch
from torch.nn import functional

from neural_model import NavalNetwork
from train import MatchDataset, losses


def load_network(filename, layout, device):
    model = json.loads(filename.read_text(encoding="utf-8"))
    if any(model[key] != layout[key] for key in ("schema", "rulesId", "globalSize")):
        raise ValueError("模型与数据协议不一致。")
    network = NavalNetwork(layout["globalSize"], model["architecture"])
    with torch.no_grad():
        for name, layer in model["layers"].items():
            module = getattr(network, name)
            module.weight.copy_(torch.tensor(layer["weight"]).reshape(layer["shape"]))
            module.bias.copy_(torch.tensor(layer["bias"]))
    return network.to(device).eval(), model


def summarize(network, dataset, indices, device):
    totals = np.zeros(13)
    weapon_labels = np.zeros(3)
    weapon_predictions = np.zeros(3)
    labeled = 0
    rows = 0
    with torch.no_grad():
        for start in range(0, len(indices), 512):
            planes, globals, targets, mask = dataset.batch(indices[start:start + 512], device)
            logits, values = network(planes, globals)
            size = len(values)
            counts = targets[:, 1:].sum(dim=1)
            valid = counts > 0
            probabilities = targets[:, 1:] / counts.clamp_min(1).unsqueeze(1)
            log_predictions = functional.log_softmax(logits.masked_fill(~mask, -1e9), dim=1)
            entropy = -(probabilities * probabilities.clamp_min(1e-30).log()).sum(dim=1)
            cross_entropy = -(probabilities * log_predictions).sum(dim=1)
            selected = log_predictions.argmax(dim=1)
            support = (probabilities > 0).sum(dim=1)
            posterior = planes[:, 6].flatten(1)
            contacts = planes[:, 2].flatten(1)
            cell = selected % 121
            attacks = selected < 242
            target_top = probabilities.argmax(dim=1)
            target_attack = target_top < 242
            metrics = [
                functional.binary_cross_entropy_with_logits(values, targets[:, 0], reduction="sum"),
                ((values.sigmoid() - targets[:, 0]) ** 2).sum(),
                entropy[valid].sum(), cross_entropy[valid].sum(),
                mask.sum(dim=1).float().log()[valid].sum(), support[valid].float().sum(),
                probabilities.gather(1, selected[:, None]).squeeze(1)[valid].sum(),
                ((probabilities.gather(1, selected[:, None]).squeeze(1) > 0) & valid).float().sum(),
                posterior.gather(1, cell[:, None]).sum(),
                (contacts.gather(1, cell[:, None]).squeeze(1) * attacks).sum(),
                (contacts.gather(1, (target_top % 121)[:, None]).squeeze(1) * target_attack * valid).sum(),
                ((selected == target_top) & valid).float().sum(),
                (counts[valid] - 1).abs().max() if valid.any() else torch.tensor(0, device=device)
            ]
            values_array = np.asarray([metric.item() for metric in metrics])
            totals[:12] += values_array[:12]
            totals[12] = max(totals[12], values_array[12])
            weapon_labels += probabilities.reshape(-1, 3, 121).sum(dim=(0, 2)).cpu().numpy()
            weapon_predictions += torch.bincount(selected // 121, minlength=3).cpu().numpy()
            labeled += valid.sum().item()
            rows += size
    if not rows or not labeled:
        raise ValueError("审计需要非空且包含策略标签的数据。")
    return {
        "records": rows, "policy_records": labeled,
        "value_loss": totals[0] / rows, "brier": totals[1] / rows,
        "target_entropy": totals[2] / labeled, "policy_cross_entropy": totals[3] / labeled,
        "policy_kl": (totals[3] - totals[2]) / labeled,
        "uniform_cross_entropy": totals[4] / labeled, "mean_target_support": totals[5] / labeled,
        "selected_target_probability": totals[6] / labeled, "selected_in_target_support": totals[7] / labeled,
        "selected_cell_posterior": totals[8] / rows,
        "selected_direct_contact_rate": totals[9] / rows, "target_top_direct_contact_rate": totals[10] / labeled,
        "top1_target_agreement": totals[11] / labeled, "max_label_sum_error": totals[12],
        "label_weapon_mass": (weapon_labels / labeled).tolist(), "selected_weapon_rate": (weapon_predictions / rows).tolist()
    }


def main():
    parser = argparse.ArgumentParser(description="检查训练标签、模型拟合差距及小样本可拟合性，不改写候选模型。")
    parser.add_argument("dataset", type=Path)
    parser.add_argument("--models", type=Path, nargs="+", required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--fit-records", type=int, default=64)
    parser.add_argument("--fit-steps", type=int, default=512)
    arguments = parser.parse_args()
    if arguments.output.exists() or arguments.fit_records < 1 or arguments.fit_steps < 1:
        parser.error("输出必须是新文件，小样本数与更新次数必须大于零。")
    torch.set_num_threads(2)
    torch.manual_seed(240124)
    devices = [index for index in range(torch.cuda.device_count()) if "9060 XT" in torch.cuda.get_device_name(index)]
    if len(devices) != 1:
        raise RuntimeError("需要唯一的 RX 9060 XT 训练设备。")
    device = torch.device("cuda", devices[0])
    dataset = MatchDataset([arguments.dataset])
    report = {"dataset": str(arguments.dataset.resolve()), "device": str(device), "models": []}
    for filename in arguments.models:
        network, metadata = load_network(filename, dataset.layout, device)
        result = {"model": str(filename.resolve()), "sha256": hashlib.sha256(filename.read_bytes()).hexdigest(),
                  "policyTrained": metadata["policyTrained"],
                  "train": summarize(network, dataset, dataset.train, device),
                  "validation": summarize(network, dataset, dataset.validation, device)}
        report["models"].append(result)
        print(json.dumps(result), flush=True)
    network, _ = load_network(arguments.models[0], dataset.layout, device)
    generator = np.random.default_rng(240124)
    subset = generator.choice(dataset.train, min(arguments.fit_records, len(dataset.train)), replace=False)
    batch = dataset.batch(subset, device)
    optimizer = torch.optim.AdamW(network.parameters(), lr=0.001, weight_decay=0, foreach=False)
    history = []
    checkpoints = {0, 32, 128, 256, 512, 1024, arguments.fit_steps}
    for step in range(arguments.fit_steps + 1):
        if step in checkpoints:
            network.eval()
            metrics = summarize(network, dataset, subset, device)
            history.append({"step": step, **metrics})
            print(json.dumps({"memorization": history[-1]}), flush=True)
        if step == arguments.fit_steps:
            break
        network.train()
        optimizer.zero_grad(set_to_none=True)
        loss, *_ = losses(network, batch)
        loss.backward()
        optimizer.step()
    report["memorization"] = {"source_model": str(arguments.models[0]), "steps": arguments.fit_steps,
                              "records": len(subset), "optimizer": "AdamW", "learning_rate": 0.001,
                              "weight_decay": 0, "seed": 240124, "history": history}
    arguments.output.write_text(json.dumps(report, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
