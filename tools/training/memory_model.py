import math

from rocm_runtime import configure_headers

configure_headers()

import torch
from torch import nn

from neural_model import NavalNetwork
from simulation_data import HISTORY_FEATURES, HISTORY_SCHEMA


class MemoryNetwork(nn.Module):
    def __init__(self, global_size=86, kind="gru"):
        super().__init__()
        self.kind = kind
        self.board = NavalNetwork(global_size, "attention")
        self.event = nn.Linear(HISTORY_FEATURES, 16)
        if kind == "gru":
            self.memory = nn.GRU(16, 16, batch_first=True)
        elif kind == "attention":
            self.query = nn.Linear(16, 16)
            self.key = nn.Linear(16, 16)
            self.memoryValue = nn.Linear(16, 16)
        else:
            raise ValueError("历史模块必须为 gru 或 attention。")
        self.fusion = nn.Linear(32, 16)
        with torch.no_grad():
            self.fusion.weight.zero_()
            self.fusion.weight[:, :16].copy_(torch.eye(16))
            self.fusion.bias.zero_()

    def forward(self, planes, globals, events, lengths):
        cells, summary = self.board.encode(planes, globals)
        embedded = torch.relu(self.event(events))
        valid = torch.arange(events.shape[1], device=events.device)[None, :] < lengths[:, None]
        if self.kind == "gru":
            sequence, _ = self.memory(embedded)
            memory = sequence[torch.arange(len(planes), device=events.device), lengths.clamp_min(1) - 1]
            memory = memory * (lengths > 0)[:, None]
        else:
            positions = torch.arange(events.shape[1], device=events.device)[:, None]
            frequencies = torch.exp(torch.arange(0, 16, 2, device=events.device) * (-math.log(10000) / 16))
            position = torch.stack((torch.sin(positions * frequencies), torch.cos(positions * frequencies)), dim=-1).flatten(1)
            embedded = embedded + position[None]
            query = self.query(summary).reshape(-1, 2, 1, 8)
            keys = self.key(embedded).reshape(-1, events.shape[1], 2, 8).transpose(1, 2)
            values = self.memoryValue(embedded).reshape(-1, events.shape[1], 2, 8).transpose(1, 2)
            weights = ((query @ keys.transpose(-1, -2)) / math.sqrt(8)).masked_fill(~valid[:, None, None, :], -1e9).softmax(-1)
            memory = (weights @ values).reshape(-1, 16) * (lengths > 0)[:, None]
        combined = torch.relu(self.fusion(torch.cat((summary, memory), dim=1)))
        return self.board.decode(cells, combined)

    def export(self, metadata):
        layers = {}
        for name, module in self.named_children():
            if isinstance(module, nn.Linear):
                layers[name] = {"shape": list(module.weight.shape), "weight": module.weight.detach().cpu().flatten().tolist(),
                                "bias": module.bias.detach().cpu().tolist()}
        if self.kind == "gru":
            for name, suffix in (("memoryInput", "ih"), ("memoryHidden", "hh")):
                weight = getattr(self.memory, f"weight_{suffix}_l0").detach().cpu()
                bias = getattr(self.memory, f"bias_{suffix}_l0").detach().cpu()
                layers[name] = {"shape": list(weight.shape), "weight": weight.flatten().tolist(), "bias": bias.tolist()}
        return {**metadata, "format": "naval-memory-v1", "historySchema": HISTORY_SCHEMA, "historyFeatures": HISTORY_FEATURES,
                "memoryKind": self.kind, "layers": layers, "base": self.board.export({key: metadata[key] for key in
                    ("schema", "rulesId", "boardSize", "channels", "globalSize", "policyTrained")})}


def load_board(network, model):
    with torch.no_grad():
        for name, layer in model["layers"].items():
            module = getattr(network, name)
            module.weight.copy_(torch.tensor(layer["weight"]).reshape(layer["shape"]))
            module.bias.copy_(torch.tensor(layer["bias"]))


def load_memory(network, model):
    if model["historySchema"] != HISTORY_SCHEMA or model["historyFeatures"] != HISTORY_FEATURES or model["memoryKind"] != network.kind:
        raise ValueError("历史模型协议或结构不一致。")
    load_board(network.board, model["base"])
    with torch.no_grad():
        for name, layer in model["layers"].items():
            if name in ("memoryInput", "memoryHidden"):
                suffix = "ih" if name == "memoryInput" else "hh"
                getattr(network.memory, f"weight_{suffix}_l0").copy_(torch.tensor(layer["weight"]).reshape(layer["shape"]))
                getattr(network.memory, f"bias_{suffix}_l0").copy_(torch.tensor(layer["bias"]))
            else:
                module = getattr(network, name)
                module.weight.copy_(torch.tensor(layer["weight"]).reshape(layer["shape"]))
                module.bias.copy_(torch.tensor(layer["bias"]))
