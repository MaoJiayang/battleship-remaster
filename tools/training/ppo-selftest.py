import math

import numpy as np
import torch

from memory_model import MemoryNetwork
from ppo import Environment, collect, distribution, update, opponent_statistics
from ppo_audit import audit_batch


torch.set_num_threads(2)
torch.manual_seed(240124)
summary = opponent_statistics([
    {"opponent": 0, "winner": "A", "learnerSeat": "A", "truncated": False},
    {"opponent": 0, "winner": "B", "learnerSeat": "A", "truncated": False},
    {"opponent": 1, "winner": None, "learnerSeat": "A", "truncated": False},
    {"opponent": 2, "winner": None, "learnerSeat": "A", "truncated": True}
])
assert summary["old-HARD"]["rate"] == 0.5
assert summary["current"]["rate"] == 0.5 and summary["current"]["draws"] == 1
assert summary["history"]["rate"] is None and summary["history"]["draws"] == 0
device = torch.device("cpu")
network = MemoryNetwork().eval()
generator = np.random.default_rng(240124)
environment = Environment()
try:
    records, outcomes = collect(environment, network, [], 2, 240124, 1, device, generator)
    assert len(records) == 1, "截断后记录了未执行的己方行动。"
    assert len(outcomes) == 2 and all(result["truncated"] for result in outcomes)
    assert records[0]["mask"][records[0]["action"]]
    with torch.no_grad():
        action_distribution, _ = distribution(network, records, device)
        actual_log = action_distribution.log_prob(torch.tensor([records[0]["action"]])).item()
    assert math.isclose(actual_log, records[0]["old_log"], abs_tol=1e-6), "采集概率与训练策略不一致。"
    environment.call({"type": "reset", "games": 2, "seed": 240124, "maxPlies": 1})
    replay = environment.call({"type": "step", "actions": [{"index": 0, "action": records[0]["action"]}]})
    final = next(item for item in replay["results"][0]["finalObservations"] if item["seat"] == "A")
    final["history"] = final.pop("events")
    with torch.no_grad():
        _, expected = distribution(network, [final], device)
    assert math.isclose(records[0]["return"], expected.item(), abs_tol=1e-6), "训练截断没有使用后续价值。"
    assert not math.isclose(records[0]["return"], 0.5, abs_tol=1e-5), "训练截断被固定写成平局。"
    records[0]["advantage"] = 0.0
    diagnostic_before = [parameter.detach().clone() for parameter in network.parameters()]
    diagnostics = audit_batch(network, records, device)
    assert not network.training, "诊断改变了模型模式。"
    assert diagnostics["max_log_probability_error"] < 1e-6
    assert diagnostics["gradient_norms"]["actor"] == 0
    assert all(math.isfinite(value) for value in diagnostics["gradient_norms"].values())
    assert all(torch.equal(previous, parameter) for previous, parameter in zip(diagnostic_before, network.parameters())), "诊断改变了策略。"
    optimizer = torch.optim.AdamW(network.parameters(), lr=0.0003, foreach=False)
    before = [parameter.detach().clone() for parameter in network.parameters()]
    statistics = update(network, optimizer, records, device, generator, 1, 1)
    assert statistics["updates"] == 1 and all(math.isfinite(value) for value in statistics["means"])
    assert all(torch.isfinite(parameter).all() for parameter in network.parameters()), "更新后参数出现非有限值。"
    assert any(not torch.equal(previous, parameter) for previous, parameter in zip(before, network.parameters())), "PPO 更新没有改变参数。"
finally:
    environment.close()
print("PPO SELFTEST OK")
