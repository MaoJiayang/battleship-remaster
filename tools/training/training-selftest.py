import math

import numpy as np
import torch

from neural_model import NavalNetwork
from memory_model import MemoryNetwork, load_memory
from train import evaluate, losses


class Dataset:
    def __init__(self):
        self.planes = torch.zeros(7, 17, 11, 11)
        self.globals = torch.zeros(7, 86)
        self.targets = torch.zeros(7, 364)
        self.targets[:, 0] = torch.linspace(0, 1, 7)
        self.targets[0, 1:3] = 0.5
        self.targets[-1, 1] = 1
        self.mask = torch.ones(7, 363, dtype=torch.bool)

    def batch(self, indices, device):
        return tuple(values[indices].to(device) for values in (self.planes, self.globals, self.targets, self.mask))


class ConstantNetwork(torch.nn.Module):
    def forward(self, planes, globals):
        return torch.zeros(len(planes), 363), torch.zeros(len(planes))


torch.set_num_threads(2)
torch.manual_seed(240124)
dataset = Dataset()
indices = np.arange(7)
network = ConstantNetwork()
reference = evaluate(network, dataset, indices, 7, torch.device("cpu"))
for size in (1, 2, 3):
    actual = evaluate(network, dataset, indices, size, torch.device("cpu"))
    for name, value in reference.items():
        assert math.isclose(value, actual[name], abs_tol=1e-6), f"验证指标随批量大小变化：{name}"
assert math.isclose(reference["policy_loss"], math.log(363), abs_tol=1e-6)
assert math.isclose(reference["policy_entropy"], math.log(2) / 2, abs_tol=1e-6)
dataset.targets[:, 1:] = 0
unlabeled = evaluate(network, dataset, indices, 3, torch.device("cpu"))
assert unlabeled["policy_loss"] == 0
assert unlabeled["policy_kl"] == 0
assert unlabeled["loss"] == unlabeled["value_loss"]
dataset.targets[0, 1] = 1
for architecture in ("attention", "mlp"):
    network = NavalNetwork(86, architecture)
    loss, *_ = losses(network, dataset.batch(indices, torch.device("cpu")))
    loss.backward()
    for module in (network.policy, network.value):
        assert module.bias.grad is not None and torch.isfinite(module.bias.grad).all()
        assert module.bias.grad.abs().sum() > 0, "双头损失没有产生训练梯度。"
print("TRAINING SELFTEST OK")

for kind in ("gru", "attention"):
    network = MemoryNetwork(86, kind)
    events = torch.randn(2, 3, 258)
    lengths = torch.tensor([0, 2])
    planes = torch.randn(2, 17, 11, 11)
    globals = torch.randn(2, 86)
    with torch.no_grad():
        network.fusion.weight[:, 16:].copy_(torch.eye(16))
    logits, values = network(planes, globals, events, lengths)
    changed = events.clone()
    changed[:, 2] = 100
    masked_logits, masked_values = network(planes, globals, changed, lengths)
    assert torch.allclose(logits, masked_logits, atol=1e-6), "历史填充区域影响了策略。"
    assert torch.allclose(values, masked_values, atol=1e-6), "历史填充区域影响了价值。"
    (logits.mean() + values.mean()).backward()
    assert network.event.weight.grad is not None and torch.isfinite(network.event.weight.grad).all()
    assert network.event.weight.grad.abs().sum() > 0, "历史编码没有学习梯度。"
    metadata = {"schema": "naval-belief-v1", "rulesId": "test", "boardSize": 11, "channels": 17, "globalSize": 86, "policyTrained": True}
    restored = MemoryNetwork(86, kind)
    load_memory(restored, network.export(metadata))
    restored_logits, restored_values = restored(planes, globals, events, lengths)
    assert torch.allclose(logits, restored_logits, atol=1e-6), "历史模型权重恢复后策略不一致。"
    assert torch.allclose(values, restored_values, atol=1e-6), "历史模型权重恢复后价值不一致。"
print("MEMORY TRAINING SELFTEST OK")
