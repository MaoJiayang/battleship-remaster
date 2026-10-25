import argparse
import copy
import json
from pathlib import Path

import numpy as np

from ppo import Environment, NeuralSelfPlayEnvironment, OPPONENT_PROTOCOL, collect, distribution, update, parity
from ppo_audit import audit_batch
from unified_data import UnifiedDataset, collect_unified_expert
from unified_model import UnifiedNetwork, load_unified

import torch


def main():
    parser = argparse.ArgumentParser(description="验证统一模型真实教师数据、终局与截断、自对弈 PPO 更新及部署导出。")
    parser.add_argument("data", type=Path)
    parser.add_argument("gru", type=Path)
    parser.add_argument("attention", type=Path)
    parser.add_argument("output", type=Path)
    arguments = parser.parse_args()
    arguments.output.mkdir(parents=True, exist_ok=False)
    torch.set_num_threads(2)
    devices = [index for index in range(torch.cuda.device_count()) if "9060 XT" in torch.cuda.get_device_name(index)]
    if len(devices) != 1:
        raise RuntimeError("需要唯一的 RX 9060 XT。")
    device = torch.device("cuda", devices[0])
    dataset = UnifiedDataset(arguments.data)
    environment = Environment("unified")
    self_play = NeuralSelfPlayEnvironment("unified")
    reports = []
    try:
        truncated, _, outcomes = collect_unified_expert(environment, 2, 251027, 1)
        if truncated["value_valid"].any() or len(truncated["action"]) != 2 or not all(item["truncated"] for item in outcomes):
            raise RuntimeError("教师训练截断被误标为终局或记录了未执行行动。")
        for kind in ("gru", "attention"):
            model = json.loads(getattr(arguments, kind).read_text(encoding="utf-8"))
            network = UnifiedNetwork(kind).to(device)
            load_unified(network, model)
            network.eval()
            generator = np.random.default_rng(251027)
            frozen = copy.deepcopy(network).eval()
            for parameter in frozen.parameters():
                parameter.requires_grad_(False)
            layout = {key: model[key] for key in ("schema", "rulesId")}
            records, outcomes = collect(self_play, network, [frozen], 14, 251027, 320, device, generator, layout)
            if any(item["truncated"] for item in outcomes):
                raise RuntimeError("统一真实终局流程自测发生截断，需要单独检查。")
            by_game = {item["index"]: item for item in outcomes}
            for record in records:
                expected = float(by_game[record["index"]]["winner"] == record["seat"])
                if record["return"] != expected:
                    raise RuntimeError("统一 PPO 终局回报与实际赢家不符。")
            if {item["opponent"] for item in outcomes} != {1, 2}:
                raise RuntimeError("统一神经自对弈没有覆盖当前策略及历史快照，或混入旧教师。")
            selected = records[:32]
            with torch.no_grad():
                probabilities, _ = distribution(network, selected, device)
                actions = torch.tensor([record["action"] for record in selected], device=device)
                recomputed = probabilities.log_prob(actions).cpu().numpy()
            log_error = float(np.max(np.abs(recomputed - np.asarray([record["old_log"] for record in selected]))))
            if log_error > 2e-5:
                raise RuntimeError("统一 PPO 采样概率与训练重算不一致。")
            optimizer = torch.optim.AdamW(network.parameters(), lr=0.0003, foreach=False)
            before = {name: parameter.detach().clone() for name, parameter in network.named_parameters()}
            for record in selected:
                record["advantage"] = record["return"] - record["old_value"]
            diagnostics = audit_batch(network, selected, device)
            if network.training or any(not torch.equal(before[name], parameter) for name, parameter in network.named_parameters()):
                raise RuntimeError("统一模型梯度诊断改变了参数或没有恢复推理模式。")
            if not np.isfinite(diagnostics["combined_gradient_norm"]) or diagnostics["max_log_probability_error"] > 2e-5:
                raise RuntimeError("统一模型梯度诊断非有限或概率重算不一致。")
            statistics = update(network, optimizer, records, device, generator, 1, 32)
            if not statistics["updates"] or not any(not torch.equal(before[name], parameter) for name, parameter in network.named_parameters()):
                raise RuntimeError("统一 PPO 未发生真实参数更新。")
            short, cutoffs = collect(self_play, network, [], 2, 251028, 3, device, generator, layout)
            if not all(item["truncated"] for item in cutoffs) or all(record["return"] == 0.5 for record in short):
                raise RuntimeError("统一 PPO 截断没有自举末端价值。")
            metadata = {**dataset.layout, "validatedRules": model["validatedRules"], "policyTrained": True,
                        "trainedShapes": model["trainedShapes"], "validationOnly": True}
            (arguments.output / f"{kind}.json").write_text(json.dumps(network.export(metadata)), encoding="utf-8")
            parity(network, records, metadata, arguments.output / f"{kind}-parity.json", device)
            reports.append({"kind": kind, "games": len(outcomes), "records": len(records), "updates": statistics,
                            "opponentProtocol": OPPONENT_PROTOCOL, "opponents": sorted({item["opponent"] for item in outcomes}),
                            "diagnostic": diagnostics,
                            "logProbabilityError": log_error, "truncatedSmokeGames": len(cutoffs),
                            "meanPlies": float(np.mean([item["plies"] for item in outcomes]))})
    finally:
        self_play.close()
        environment.close()
    report = {"device": str(device), "name": torch.cuda.get_device_name(device), "reports": reports,
              "scope": "仅验证新模型的端到端训练及真实终局流程，未作独立棋力或平衡验收"}
    (arguments.output / "report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report), flush=True)


if __name__ == "__main__":
    main()
