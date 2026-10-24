import argparse
import hashlib
import json
from pathlib import Path

import numpy as np

from rocm_runtime import configure_headers

configure_headers()

import torch
from torch.nn import functional

from memory_model import MemoryNetwork, load_memory
from ppo import Environment, collect, distribution, opponent_statistics


def audit_batch(network, records, device):
    previous_mode = network.training
    try:
        network.train()
        return _audit_batch(network, records, device)
    finally:
        network.train(previous_mode)


def _audit_batch(network, records, device):
    action_distribution, values = distribution(network, records, device)
    actions = torch.tensor([record["action"] for record in records], device=device)
    old_logs = torch.tensor([record["old_log"] for record in records], device=device)
    targets = torch.tensor([record["return"] for record in records], device=device)
    advantages = torch.tensor([record["advantage"] for record in records], device=device)
    logs = action_distribution.log_prob(actions)
    ratios = (logs - old_logs).exp()
    actor = -torch.minimum(ratios * advantages, ratios.clamp(0.8, 1.2) * advantages).mean()
    value = functional.binary_cross_entropy(values.clamp(1e-6, 1 - 1e-6), targets)
    entropy = action_distribution.entropy().mean()
    parameters = tuple(network.parameters())
    gradients = {}
    for name, loss in (("actor", actor), ("value", value), ("entropy", -0.01 * entropy)):
        parts = torch.autograd.grad(loss, parameters, retain_graph=name != "entropy", allow_unused=True)
        gradients[name] = torch.cat([(gradient if gradient is not None else torch.zeros_like(parameter)).flatten()
                                     for parameter, gradient in zip(parameters, parts)])
    norms = {name: gradient.norm().item() for name, gradient in gradients.items()}
    denominator = norms["actor"] * norms["entropy"]
    value_denominator = norms["actor"] * norms["value"]
    combined_norm = sum(gradients.values()).norm().item()
    probabilities = action_distribution.probs.detach()
    return {"records": len(records), "actor_loss": actor.item(), "value_loss": value.item(), "entropy": entropy.item(),
            "mean_max_probability": probabilities.amax(dim=1).mean().item(),
            "sampled_greedy_share": (probabilities.argmax(dim=1) == actions).float().mean().item(),
            "max_log_probability_error": (logs - old_logs).abs().max().item(), "gradient_norms": norms,
            "combined_gradient_norm": combined_norm, "clip_scale": min(1, 0.5 / (combined_norm + 1e-6)),
            "actor_value_cosine": (gradients["actor"] @ gradients["value"]).item() / value_denominator if value_denominator else None,
            "actor_entropy_cosine": (gradients["actor"] @ gradients["entropy"]).item() / denominator if denominator else None}


def main():
    parser = argparse.ArgumentParser(description="冻结策略采集公平轨迹，检查 PPO 概率、价值误差与各损失的梯度，不更新模型。")
    parser.add_argument("--model", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--games", type=int, default=98)
    parser.add_argument("--seed", type=int, default=390127)
    parser.add_argument("--batches", type=int, default=8)
    parser.add_argument("--minibatch", type=int, default=64)
    arguments = parser.parse_args()
    if arguments.output.exists() or min(arguments.games, arguments.batches, arguments.minibatch) < 1 or arguments.games % 2:
        parser.error("输出必须为新文件，预算必须为正数且对局数为偶数。")
    torch.set_num_threads(2)
    torch.manual_seed(arguments.seed)
    generator = np.random.default_rng(arguments.seed)
    devices = [index for index in range(torch.cuda.device_count()) if "9060 XT" in torch.cuda.get_device_name(index)]
    if len(devices) != 1:
        raise RuntimeError("需要唯一的 RX 9060 XT。")
    device = torch.device("cuda", devices[0])
    model = json.loads(arguments.model.read_text(encoding="utf-8"))
    network = MemoryNetwork(model["globalSize"], model["memoryKind"]).to(device).eval()
    load_memory(network, model)
    before = [parameter.detach().clone() for parameter in network.parameters()]
    environment = Environment()
    try:
        records, outcomes = collect(environment, network, [], arguments.games, arguments.seed, 320, device, generator, model)
    finally:
        environment.close()
    advantages = np.asarray([record["return"] - record["old_value"] for record in records], dtype=np.float32)
    advantages = (advantages - advantages.mean()) / max(advantages.std(), 1e-8)
    for record, advantage in zip(records, advantages):
        record["advantage"] = float(advantage)
    reports = {}
    for name, indices in (("all", {result["index"] for result in outcomes}),
                          ("old-HARD", {result["index"] for result in outcomes if result["opponent"] == 0}),
                          ("current", {result["index"] for result in outcomes if result["opponent"] == 1})):
        selected = [record for record in records if record["index"] in indices]
        order = generator.permutation(len(selected))
        reports[name] = [audit_batch(network, [selected[index] for index in order[start:start + arguments.minibatch]], device)
                         for start in range(0, min(len(order), arguments.batches * arguments.minibatch), arguments.minibatch)]
    if any(not torch.equal(previous, parameter) for previous, parameter in zip(before, network.parameters())):
        raise RuntimeError("诊断过程改变了模型参数。")
    report = {"model_sha256": hashlib.sha256(arguments.model.read_bytes()).hexdigest(), "seed": arguments.seed,
              "memory_kind": model["memoryKind"], "opponents": opponent_statistics(outcomes),
              "gradient_advantage_normalization": "entire frozen rollout, matching PPO updates",
              "batches": reports}
    arguments.output.parent.mkdir(parents=True, exist_ok=True)
    arguments.output.write_text(json.dumps(report, indent=2, allow_nan=False), encoding="utf-8")
    print(json.dumps({key: value for key, value in report.items() if key != "batches"}), flush=True)


if __name__ == "__main__":
    main()
