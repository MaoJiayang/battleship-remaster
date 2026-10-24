import argparse
import copy
import hashlib
import json
import time
from pathlib import Path

import numpy as np
import torch
from torch.nn import functional

from neural_model import NavalNetwork


class MatchDataset:
    def __init__(self, directories):
        self.shards = []
        self.train = []
        self.validation = []
        self.records = 0
        self.policy_records = 0
        self.policy_train_records = 0
        self.manifests = []
        self.layout = None
        for directory in directories:
            manifest = json.loads((directory / "manifest.json").read_text(encoding="utf-8-sig"))
            layout = {key: manifest[key] for key in ("schema", "rulesId", "boardSize", "channels", "globalSize", "featureSize", "actionSize")}
            if self.layout is not None and layout != self.layout:
                raise ValueError("训练数据的规则或输入协议不一致。")
            self.layout = layout
            self.manifests.append({"path": str(directory.resolve()), "sourceHash": manifest["sourceHash"], "modelHash": manifest.get("modelHash")})
            for entry in manifest["shards"]:
                shard_directory = (directory / entry["path"]).resolve()
                if not shard_directory.is_relative_to(directory.resolve()):
                    raise ValueError("数据分片超出数据集目录。")
                shard = json.loads((shard_directory / "manifest.json").read_text(encoding="utf-8"))
                if any(shard[key] != value for key, value in layout.items()):
                    raise ValueError("分片输入协议不一致。")
                count = shard["records"]
                arrays = []
                for filename, dtype, width in (("features.f32", "<f4", layout["featureSize"]), ("targets.f32", "<f4", layout["actionSize"] + 1), ("masks.u8", "u1", layout["actionSize"])):
                    source = shard_directory / filename
                    if source.stat().st_size != count * width * np.dtype(dtype).itemsize:
                        raise ValueError(f"数据文件长度不符：{source}")
                    arrays.append(np.memmap(source, dtype=dtype, mode="r", shape=(count, width)))
                self.shards.append((self.records, self.records + count, arrays))
                self.policy_records += int((arrays[1][:, 1:].sum(axis=1) > 0).sum())
                for group in shard["groups"]:
                    bucket = int.from_bytes(hashlib.sha256(group["splitGroup"].encode()).digest()[:4], "little") % 5
                    indices = range(self.records + group["start"], self.records + group["start"] + group["count"])
                    (self.validation if bucket == 0 else self.train).extend(indices)
                    if bucket != 0:
                        self.policy_train_records += int((arrays[1][group["start"]:group["start"] + group["count"], 1:].sum(axis=1) > 0).sum())
                self.records += count
        self.train = np.asarray(self.train, dtype=np.int64)
        self.validation = np.asarray(self.validation, dtype=np.int64)
        if not len(self.train) or not len(self.validation):
            raise ValueError("训练集或验证集为空，请增加独立布阵组。")

    def batch(self, indices, device):
        features = np.empty((len(indices), self.layout["featureSize"]), dtype=np.float32)
        targets = np.empty((len(indices), self.layout["actionSize"] + 1), dtype=np.float32)
        masks = np.empty((len(indices), self.layout["actionSize"]), dtype=np.bool_)
        for first, last, arrays in self.shards:
            selected = (indices >= first) & (indices < last)
            if selected.any():
                local = indices[selected] - first
                features[selected] = arrays[0][local]
                targets[selected] = arrays[1][local]
                masks[selected] = arrays[2][local]
        if not np.isfinite(features).all() or not np.isfinite(targets).all() or not masks.any(axis=1).all():
            raise ValueError("局面包含非有限值或没有合法行动。")
        if (targets[:, 1:][~masks] != 0).any():
            raise ValueError("策略标签包含非法行动。")
        boundary = self.layout["channels"] * self.layout["boardSize"] ** 2
        planes = torch.from_numpy(features[:, :boundary].copy()).reshape(-1, self.layout["channels"], self.layout["boardSize"], self.layout["boardSize"]).to(device)
        globals = torch.from_numpy(features[:, boundary:].copy()).to(device)
        return planes, globals, torch.from_numpy(targets).to(device), torch.from_numpy(masks).to(device)


def losses(network, batch):
    planes, globals, targets, mask = batch
    logits, values = network(planes, globals)
    value_loss = functional.binary_cross_entropy_with_logits(values, targets[:, 0])
    counts = targets[:, 1:].sum(dim=1)
    valid = counts > 0
    probabilities = targets[:, 1:] / counts.clamp_min(1).unsqueeze(1)
    policy_losses = -(probabilities * functional.log_softmax(logits.masked_fill(~mask, -1e9), dim=1)).sum(dim=1)
    policy_loss = (policy_losses * valid).sum() / valid.sum().clamp_min(1)
    brier = ((values.sigmoid() - targets[:, 0]) ** 2).mean()
    return value_loss + policy_loss, value_loss, policy_loss, brier


def evaluate(network, dataset, indices, batch_size, device):
    totals = np.zeros(4)
    policy_records = 0
    network.eval()
    with torch.no_grad():
        for start in range(0, len(indices), batch_size):
            selected = indices[start:start + batch_size]
            batch = dataset.batch(selected, device)
            _, value_loss, policy_loss, brier = losses(network, batch)
            counts = batch[2][:, 1:].sum(dim=1)
            valid = counts > 0
            probabilities = batch[2][:, 1:] / counts.clamp_min(1).unsqueeze(1)
            entropy = -(probabilities * probabilities.clamp_min(1e-30).log()).sum()
            labeled = valid.sum().item()
            totals += np.asarray([value_loss.item() * len(selected), policy_loss.item() * labeled,
                                  brier.item() * len(selected), entropy.item()])
            policy_records += labeled
    if not np.isfinite(totals).all():
        raise RuntimeError("验证损失出现非有限值。")
    value_loss = totals[0] / len(indices)
    policy_loss = totals[1] / max(1, policy_records)
    entropy = totals[3] / max(1, policy_records)
    return {"loss": value_loss + policy_loss, "value_loss": value_loss, "policy_loss": policy_loss,
            "brier": totals[2] / len(indices), "policy_entropy": entropy, "policy_kl": policy_loss - entropy}


def main():
    parser = argparse.ArgumentParser(description="使用完整对局分组的训练/验证划分，训练轻量策略与胜率网络。")
    parser.add_argument("datasets", nargs="+", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--architecture", choices=("attention", "mlp"), default="attention")
    parser.add_argument("--epochs", type=int, default=8)
    parser.add_argument("--batch-size", type=int, default=512)
    parser.add_argument("--learning-rate", type=float, default=0.001)
    parser.add_argument("--resume", type=Path)
    parser.add_argument("--cpu", action="store_true")
    arguments = parser.parse_args()
    if arguments.epochs < 1 or arguments.batch_size < 1:
        parser.error("训练轮数和批量大小必须大于零。")
    arguments.output.mkdir(parents=True, exist_ok=False)
    torch.set_num_threads(2)
    torch.manual_seed(240124)
    generator = np.random.default_rng(240124)
    dataset = MatchDataset(arguments.datasets)
    device = torch.device("cpu")
    if not arguments.cpu:
        if not torch.version.hip:
            raise RuntimeError("当前环境没有 ROCm，请使用已配置的虚拟环境或显式指定 --cpu。")
        devices = [torch.cuda.get_device_name(index) for index in range(torch.cuda.device_count())]
        candidates = [index for index, name in enumerate(devices) if "9060 XT" in name]
        if len(candidates) != 1:
            raise RuntimeError(f"没有找到唯一的 RX 9060 XT：{devices}")
        device = torch.device("cuda", candidates[0])
    network = NavalNetwork(dataset.layout["globalSize"], arguments.architecture)
    previous_policy = False
    if arguments.resume:
        previous = json.loads(arguments.resume.read_text(encoding="utf-8"))
        if any(previous[key] != dataset.layout[key] for key in ("schema", "rulesId", "globalSize")) or previous["architecture"] != arguments.architecture:
            raise ValueError("恢复模型的规则、协议或架构不一致。")
        with torch.no_grad():
            for name, layer in previous["layers"].items():
                module = getattr(network, name)
                module.weight.copy_(torch.tensor(layer["weight"]).reshape(layer["shape"]))
                module.bias.copy_(torch.tensor(layer["bias"]))
        previous_policy = previous.get("policyTrained", False)
    network.to(device)
    optimizer = torch.optim.AdamW(network.parameters(), lr=arguments.learning_rate, weight_decay=0.0001, foreach=False)
    history = [{"epoch": 0, "train": evaluate(network, dataset, dataset.train, arguments.batch_size, device),
                "validation": evaluate(network, dataset, dataset.validation, arguments.batch_size, device)}]
    best_loss = history[0]["validation"]["loss"]
    best = copy.deepcopy(network.state_dict())
    best_epoch = 0
    updates = 0
    started = time.perf_counter()
    for epoch in range(1, arguments.epochs + 1):
        network.train()
        order = generator.permutation(dataset.train)
        for start in range(0, len(order), arguments.batch_size):
            optimizer.zero_grad(set_to_none=True)
            loss, *_ = losses(network, dataset.batch(order[start:start + arguments.batch_size], device))
            loss.backward()
            optimizer.step()
            updates += 1
        training = evaluate(network, dataset, dataset.train, arguments.batch_size, device)
        validation = evaluate(network, dataset, dataset.validation, arguments.batch_size, device)
        history.append({"epoch": epoch, "train": training, "validation": validation})
        print(json.dumps(history[-1]), flush=True)
        if validation["loss"] < best_loss:
            best_loss = validation["loss"]
            best = copy.deepcopy(network.state_dict())
            best_epoch = epoch
    network.load_state_dict(best)
    network.to("cpu").eval()
    metadata = {**dataset.layout, "policyTrained": previous_policy or (dataset.policy_train_records > 0 and best_epoch > 0),
                "training": {"records": dataset.records, "train_records": len(dataset.train), "validation_records": len(dataset.validation),
                             "policy_records": dataset.policy_records, "best_epoch": best_epoch, "datasets": dataset.manifests, "seconds": time.perf_counter() - started,
                             "epochs": arguments.epochs, "batch_size": arguments.batch_size, "updates": updates,
                             "optimizer": "AdamW", "learning_rate": arguments.learning_rate, "weight_decay": 0.0001,
                             "resume": str(arguments.resume.resolve()) if arguments.resume else None,
                             "torch": torch.__version__, "device": str(device), "history": history}}
    model = network.export(metadata)
    (arguments.output / "model.json").write_text(json.dumps(model, ensure_ascii=False), encoding="utf-8")
    (arguments.output / "metrics.json").write_text(json.dumps(metadata["training"], indent=2), encoding="utf-8")
    torch.save(network.state_dict(), arguments.output / "weights.pt")
    indices = dataset.validation[np.linspace(0, len(dataset.validation) - 1, min(16, len(dataset.validation)), dtype=int)]
    planes, globals, targets, mask = dataset.batch(indices, torch.device("cpu"))
    with torch.no_grad():
        logits, values = network(planes, globals)
    fixtures = [{"observation": {"schema": dataset.layout["schema"], "rulesId": dataset.layout["rulesId"],
                                "planes": planes[index].flatten().tolist(), "globals": globals[index].tolist(), "mask": mask[index].int().tolist()},
                 "expected": {"logits": logits[index].tolist(), "valueLogit": values[index].item(), "value": values[index].sigmoid().item()}}
                for index in range(len(indices))]
    (arguments.output / "parity.json").write_text(json.dumps(fixtures), encoding="utf-8")
    print(json.dumps({"parameters": sum(parameter.numel() for parameter in network.parameters()), "best_loss": best_loss, "output": str(arguments.output)}), flush=True)


if __name__ == "__main__":
    main()
