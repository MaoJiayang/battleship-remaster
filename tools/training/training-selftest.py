import math

import numpy as np
import torch

from neural_model import NavalNetwork
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
