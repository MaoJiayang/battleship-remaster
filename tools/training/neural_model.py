import math

import torch
from torch import nn
from torch.nn import functional


class NavalNetwork(nn.Module):
    def __init__(self, global_size, architecture="attention"):
        super().__init__()
        self.architecture = architecture
        self.hidden = 8 if architecture == "attention" else 64
        self.embedding = 16 if architecture == "attention" else 32
        self.heads = 2
        if architecture == "attention":
            self.conv1 = nn.Conv2d(17, self.hidden, 3, padding=1)
            self.conv2 = nn.Conv2d(self.hidden, self.hidden, 3, padding=1)
            self.rules = nn.Linear(global_size, self.embedding)
            self.query = nn.Linear(self.embedding, self.embedding)
            self.key = nn.Linear(self.embedding, self.embedding)
            self.attentionValue = nn.Linear(self.embedding, self.embedding)
            self.fusion = nn.Linear(self.embedding * 2, self.embedding)
        else:
            self.mlp1 = nn.Linear(17 * 16 + global_size, self.hidden)
            self.mlp2 = nn.Linear(self.hidden, self.embedding)
        self.cell = nn.Linear((self.hidden if architecture == "attention" else 17) + 2, self.embedding)
        self.policyHidden = nn.Linear(self.embedding * 2, self.embedding)
        self.policy = nn.Linear(self.embedding, 3)
        self.valueHidden = nn.Linear(self.embedding, self.embedding)
        self.value = nn.Linear(self.embedding, 1)
        coordinates = torch.linspace(-1, 1, 11)
        rows, columns = torch.meshgrid(coordinates, coordinates, indexing="ij")
        self.register_buffer("coordinates", torch.stack((rows, columns), dim=-1).reshape(1, 121, 2))

    def forward(self, planes, globals):
        spatial = functional.relu(self.conv2(functional.relu(self.conv1(planes)))) if self.architecture == "attention" else planes
        cell_inputs = torch.cat((spatial.flatten(2).transpose(1, 2), self.coordinates.expand(len(planes), -1, -1)), dim=-1)
        cells = functional.relu(self.cell(cell_inputs))
        if self.architecture == "attention":
            rules = functional.relu(self.rules(globals))
            width = self.embedding // self.heads
            query = self.query(rules).reshape(-1, self.heads, 1, width)
            keys = self.key(cells).reshape(-1, 121, self.heads, width).transpose(1, 2)
            values = self.attentionValue(cells).reshape(-1, 121, self.heads, width).transpose(1, 2)
            probabilities = functional.softmax((query @ keys.transpose(-1, -2)) / math.sqrt(width), dim=-1)
            attended = (probabilities @ values).reshape(-1, self.embedding)
            summary = functional.relu(self.fusion(torch.cat((rules, attended), dim=-1)))
        else:
            pooled = functional.adaptive_avg_pool2d(planes, 4).flatten(1)
            summary = functional.relu(self.mlp2(functional.relu(self.mlp1(torch.cat((pooled, globals), dim=-1)))))
        policy_inputs = torch.cat((cells, summary.unsqueeze(1).expand(-1, 121, -1)), dim=-1)
        logits = self.policy(functional.relu(self.policyHidden(policy_inputs))).transpose(1, 2).flatten(1)
        value = self.value(functional.relu(self.valueHidden(summary))).squeeze(-1)
        return logits, value

    def export(self, metadata):
        layers = {}
        for name, module in self.named_children():
            if isinstance(module, (nn.Conv2d, nn.Linear)):
                layers[name] = {"shape": list(module.weight.shape), "weight": module.weight.detach().cpu().flatten().tolist(), "bias": module.bias.detach().cpu().tolist()}
        return {**metadata, "format": "naval-network-v1", "architecture": self.architecture,
                "hidden": self.hidden, "embedding": self.embedding, "heads": self.heads, "layers": layers}
