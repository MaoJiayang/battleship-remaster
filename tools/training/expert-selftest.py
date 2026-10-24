import hashlib
import json
import math
import tempfile
from pathlib import Path

import numpy as np
import torch

from expert_data import ExpertDataset, collect_expert, validation_group
from expert_train import evaluate, losses
from memory_model import MemoryNetwork, HISTORY_SCHEMA
from ppo import Environment, parity


torch.set_num_threads(2)
torch.manual_seed(240126)
device = torch.device("cpu")
environment = Environment()
try:
    arrays, layout, outcomes = collect_expert(environment, 14, 240126, 4)
    assert len(outcomes) == 14 and all(result["truncated"] and result["plies"] == 4 for result in outcomes)
    assert len(arrays["actions"]) == 56 and not arrays["value_valid"].any()
    assert len({result["seed"] for result in outcomes}) == 14, "监督采集重复了配对舰队。"
    for index in range(14):
        rows = arrays["slots"] // 2 == index
        assert np.array_equal(arrays["lengths"][rows], [0, 1, 2, 3])
        assert (arrays["validation"][rows] == validation_group(240126, index)).all(), "同局泄漏到不同集合。"
    repeated, _, _ = collect_expert(environment, 14, 240126, 4)
    assert all(np.array_equal(value, repeated[key]) for key, value in arrays.items()), "真实教师标签不可复现。"
    normal, _, completed = collect_expert(environment, 2, 240127, 320)
    assert all(not result["truncated"] for result in completed)
    for result in completed:
        rows = normal["slots"] // 2 == result["index"]
        seats = np.where(normal["slots"][rows] % 2 == 0, "A", "B")
        assert np.array_equal(normal["values"][rows], (seats == result["winner"]).astype(np.float32))
    with tempfile.TemporaryDirectory(prefix="hzq-expert-selftest-") as temporary:
        root = Path(temporary)
        filename = root / "batch-000.npz"
        np.savez_compressed(filename, **arrays)
        manifest = {"format": "naval-expert-v1", "historySchema": HISTORY_SCHEMA, "layout": layout,
                    "shards": [{"file": filename.name, "sha256": hashlib.sha256(filename.read_bytes()).hexdigest(), "records": 56}]}
        (root / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
        dataset = ExpertDataset(root)
        records = dataset.records(np.arange(56))
        assert all(len(record["history"]) == arrays["lengths"][index] for index, record in enumerate(records))
        assert all(not len(record["history"]) or record["history"][-1, 0] == -1 for record in records)
        for kind in ("gru", "attention"):
            records = dataset.records(np.arange(56))
            network = MemoryNetwork(kind=kind)
            before = [parameter.detach().clone() for parameter in network.parameters()]
            loss, policy, value, *_ = losses(network, records[:8], device)
            assert len(value) == 0 and torch.allclose(loss, policy.mean()), "截断价值进入了监督损失。"
            optimizer = torch.optim.AdamW(network.parameters(), lr=0.0003, foreach=False)
            optimizer.zero_grad(set_to_none=True)
            loss.backward()
            assert all(parameter.grad is None or torch.isfinite(parameter.grad).all() for parameter in network.parameters())
            optimizer.step()
            assert any(not torch.equal(previous, parameter) for previous, parameter in zip(before, network.parameters()))
            metrics = evaluate(network, dataset, dataset.validation, 3, device)
            full = evaluate(network, dataset, dataset.validation, 56, device)
            assert math.isclose(metrics["loss"], full["loss"], abs_tol=1e-5)
            assert metrics["brier"] is None and metrics["value_records"] == 0
            records[0]["value_valid"] = True
            records[0]["return"] = 1.0
            network.train()
            _, _, values, *_ = losses(network, records[:8], device)
            assert len(values) == 1 and torch.isfinite(values).all()
            network.eval()
            parity(network, records[:8], {**layout, "policyTrained": True}, root / f"parity-{kind}.json", device)
            assert len(json.loads((root / f"parity-{kind}.json").read_text())) == 8
        arrays["masks"][0, arrays["actions"][0]] = 0
        np.savez_compressed(filename, **arrays)
        manifest["shards"][0]["sha256"] = hashlib.sha256(filename.read_bytes()).hexdigest()
        (root / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
        try:
            ExpertDataset(root)
        except ValueError as error:
            assert "非法行动" in str(error)
        else:
            raise AssertionError("非法教师行动未被拒绝。")
finally:
    environment.close()
print("EXPERT SELFTEST OK")
