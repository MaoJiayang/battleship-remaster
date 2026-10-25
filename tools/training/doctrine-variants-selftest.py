import argparse
import copy
import json
from pathlib import Path

import numpy as np

from ppo import NeuralSelfPlayEnvironment, collect, distribution, update, parity
from unified_data import UnifiedDataset
from unified_model import UnifiedNetwork

import torch


def main():
    parser = argparse.ArgumentParser(description="在 CPU 上验证参数化学说的真实教师标签、纯神经自对弈及训练导出。")
    parser.add_argument("data", type=Path)
    parser.add_argument("catalog", type=Path)
    parser.add_argument("output", type=Path)
    arguments = parser.parse_args()
    arguments.output.mkdir(parents=True, exist_ok=False)
    torch.set_num_threads(1)
    device = torch.device("cpu")
    catalog = json.loads(arguments.catalog.read_text(encoding="utf-8"))
    dataset = UnifiedDataset(arguments.data)
    if dataset.layout["rulesId"] != catalog["rulesId"]:
        raise ValueError("参数化训练数据与目录规则不一致。")
    environment = NeuralSelfPlayEnvironment("unified", {"doctrineCatalog": catalog})
    reports = []
    try:
        for kind in ("gru", "attention"):
            torch.manual_seed(251052)
            generator = np.random.default_rng(251052)
            network = UnifiedNetwork(kind, {"widthMultiplier": 2}).to(device)
            optimizer = torch.optim.AdamW(network.parameters(), lr=0.001, foreach=False)
            records = dataset.records(dataset.train[:16])
            actions = torch.tensor([record["action"] for record in records], device=device)
            losses = []
            for iteration in range(4):
                probabilities, _ = distribution(network, records, device)
                loss = -probabilities.log_prob(actions).mean()
                optimizer.zero_grad(set_to_none=True)
                loss.backward()
                if any(parameter.grad is not None and not torch.isfinite(parameter.grad).all() for parameter in network.parameters()):
                    raise RuntimeError("参数化教师冒烟更新出现非有限梯度。")
                optimizer.step()
                losses.append(loss.item())
            if losses[-1] >= losses[0]:
                raise RuntimeError("参数化教师标签的微型更新未降低损失。")
            network.eval()
            frozen = copy.deepcopy(network).eval()
            for parameter in frozen.parameters():
                parameter.requires_grad_(False)
            terminal_records, outcomes = collect(environment, network, [frozen], 2, 251053, 320, device, generator, dataset.layout)
            if any(outcome["truncated"] for outcome in outcomes):
                raise RuntimeError("参数化真实终局自测发生截断。")
            by_game = {outcome["index"]: outcome for outcome in outcomes}
            if any(record["return"] != float(by_game[record["index"]]["winner"] == record["seat"]) for record in terminal_records):
                raise RuntimeError("参数化自对弈胜负标签不符。")
            short_records, cutoffs = collect(environment, network, [frozen], 14, 251054, 3, device, generator, dataset.layout)
            if not all(outcome["truncated"] for outcome in cutoffs) or {outcome["opponent"] for outcome in cutoffs} != {1, 2}:
                raise RuntimeError("参数化截断或当前／历史神经对手覆盖不符。")
            before = [parameter.detach().clone() for parameter in network.parameters()]
            statistics = update(network, optimizer, short_records, device, generator, 1, 8)
            if not statistics["updates"] or not any(not torch.equal(original, parameter) for original, parameter in zip(before, network.parameters())):
                raise RuntimeError("参数化 PPO 没有产生实际更新。")
            metadata = {**dataset.layout, "validatedRules": [catalog["rulesId"]], "trainedShapes": [[11, 11]],
                        "validationOnly": True, "testUpdates": 4 + statistics["updates"]}
            (arguments.output / f"{kind}.json").write_text(json.dumps(network.export(metadata)), encoding="utf-8")
            parity(network, terminal_records, metadata, arguments.output / f"{kind}-parity.json", device)
            reports.append({"kind": kind, "parameters": sum(parameter.numel() for parameter in network.parameters()),
                            "teacherLosses": losses, "terminalGames": len(outcomes), "terminalRecords": len(terminal_records),
                            "truncatedGames": len(cutoffs), "ppo": statistics})
    finally:
        environment.close()
    report = {"device": str(device), "torch": str(torch.__version__), "rulesId": catalog["rulesId"], "reports": reports,
              "scope": "小规模 CPU 训练管线检查，不作显卡性能、正式训练或棋力结论"}
    (arguments.output / "report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report), flush=True)


if __name__ == "__main__":
    main()
