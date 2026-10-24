import argparse
import copy
import hashlib
import json
import time
from pathlib import Path

import numpy as np

from rocm_runtime import configure_headers

configure_headers()

import torch
from torch.nn import functional

from expert_data import ExpertDataset, source_hash
from memory_model import MemoryNetwork, load_board, load_memory
from ppo import distribution, parity


def losses(network, records, device):
    probabilities, values = distribution(network, records, device)
    actions = torch.tensor([record["action"] for record in records], device=device)
    targets = torch.tensor([record["return"] for record in records], device=device)
    valid = torch.tensor([record["value_valid"] for record in records], dtype=torch.bool, device=device)
    policy = -probabilities.log_prob(actions)
    value = functional.binary_cross_entropy(values.clamp(1e-6, 1 - 1e-6), targets, reduction="none")
    value_loss = value[valid].mean() if valid.any() else value.sum() * 0
    correct = probabilities.logits.argmax(dim=1) == actions
    return policy.mean() + value_loss, policy, value[valid], correct, (values[valid] - targets[valid]).square()


def evaluate(network, dataset, indices, minibatch, device):
    network.eval()
    totals = np.zeros(5, dtype=np.float64)
    with torch.no_grad():
        for start in range(0, len(indices), minibatch):
            records = dataset.records(indices[start:start + minibatch])
            _, policy, value, correct, brier = losses(network, records, device)
            totals += [policy.sum().item(), value.sum().item(), correct.sum().item(), brier.sum().item(), len(value)]
    policy = totals[0] / len(indices)
    value = totals[1] / totals[4] if totals[4] else 0
    return {"loss": policy + value, "policy": policy, "value": value, "accuracy": totals[2] / len(indices),
            "brier": totals[3] / totals[4] if totals[4] else None, "records": len(indices), "value_records": int(totals[4])}


def main():
    parser = argparse.ArgumentParser(description="用真实旧困难 AI 行动监督预热现有轻量历史策略与价值双头。")
    parser.add_argument("data", type=Path)
    parser.add_argument("--initial", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--kind", choices=("gru", "attention"), required=True)
    parser.add_argument("--epochs", type=int, default=32)
    parser.add_argument("--minibatch", type=int, default=128)
    parser.add_argument("--learning-rate", type=float, default=0.0003)
    parser.add_argument("--seed", type=int, default=240126)
    arguments = parser.parse_args()
    if min(arguments.epochs, arguments.minibatch, arguments.learning_rate) <= 0:
        parser.error("训练预算与学习率必须为正。")
    arguments.output.mkdir(parents=True, exist_ok=False)
    torch.set_num_threads(2)
    torch.manual_seed(arguments.seed)
    generator = np.random.default_rng(arguments.seed)
    devices = [index for index in range(torch.cuda.device_count()) if "9060 XT" in torch.cuda.get_device_name(index)]
    if len(devices) != 1:
        raise RuntimeError("需要唯一的 RX 9060 XT。")
    device = torch.device("cuda", devices[0])
    dataset = ExpertDataset(arguments.data)
    initial = json.loads(arguments.initial.read_text(encoding="utf-8"))
    if any(initial[key] != value for key, value in dataset.layout.items()):
        raise ValueError("监督数据与起步模型规则不一致。")
    network = MemoryNetwork(initial["globalSize"], arguments.kind).to(device)
    if initial["format"] == "naval-memory-v1":
        load_memory(network, initial)
    else:
        load_board(network.board, initial)
    metadata = {**dataset.layout, "policyTrained": True}
    (arguments.output / "initial-model.json").write_text(json.dumps(network.export(metadata)), encoding="utf-8")
    optimizer = torch.optim.AdamW(network.parameters(), lr=arguments.learning_rate, weight_decay=0.0001, foreach=False)
    history = []
    best_loss = float("inf")
    best_epoch = 0
    best = None
    updates = 0
    started = time.perf_counter()
    for epoch in range(arguments.epochs + 1):
        if epoch:
            network.train()
            order = generator.permutation(dataset.train)
            for start in range(0, len(order), arguments.minibatch):
                records = dataset.records(order[start:start + arguments.minibatch])
                loss, *_ = losses(network, records, device)
                if not torch.isfinite(loss):
                    raise RuntimeError("监督训练损失出现非有限值。")
                optimizer.zero_grad(set_to_none=True)
                loss.backward()
                gradient = torch.nn.utils.clip_grad_norm_(network.parameters(), 0.5)
                if not torch.isfinite(gradient):
                    raise RuntimeError("监督训练梯度出现非有限值。")
                optimizer.step()
                updates += 1
        entry = {"epoch": epoch, "updates": updates,
                 "train": evaluate(network, dataset, dataset.train, arguments.minibatch, device),
                 "validation": evaluate(network, dataset, dataset.validation, arguments.minibatch, device)}
        history.append(entry)
        if entry["validation"]["loss"] < best_loss:
            best_loss = entry["validation"]["loss"]
            best_epoch = epoch
            best = copy.deepcopy(network.state_dict())
        metadata["training"] = {"algorithm": "supervised actual old-HARD actions plus terminal value", "history": history,
                                "best_epoch": best_epoch, "updates": updates, "seconds": time.perf_counter() - started,
                                "initial_sha256": hashlib.sha256(arguments.initial.read_bytes()).hexdigest(),
                                "data_manifest_sha256": hashlib.sha256((arguments.data / "manifest.json").read_bytes()).hexdigest(),
                                "source_sha256": source_hash(), "torch": str(torch.__version__), "device": str(device),
                                "arguments": {key: str(value) if isinstance(value, Path) else value for key, value in vars(arguments).items()}}
        (arguments.output / "metrics.json").write_text(json.dumps(metadata["training"], indent=2), encoding="utf-8")
        (arguments.output / f"epoch-{epoch:03d}.json").write_text(json.dumps(network.export(metadata)), encoding="utf-8")
        print(json.dumps(entry), flush=True)
    network.load_state_dict(best)
    network.eval()
    (arguments.output / "model.json").write_text(json.dumps(network.export(metadata)), encoding="utf-8")
    torch.save(network.state_dict(), arguments.output / "weights.pt")
    selected = dataset.validation[np.linspace(0, len(dataset.validation) - 1, min(8, len(dataset.validation)), dtype=int)]
    parity(network, dataset.records(selected), metadata, arguments.output / "parity.json", device)


if __name__ == "__main__":
    main()
