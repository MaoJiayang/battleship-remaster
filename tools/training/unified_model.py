import math

from rocm_runtime import configure_headers

configure_headers()

import numpy as np
import torch
from torch import nn


SCHEMA = "naval-grid-v1"
CHANNELS = 22
EVENT_CHANNELS = 18


def unified_batch(records, device):
    observations = [record["observation"] for record in records]
    height, width = observations[0]["height"], observations[0]["width"]
    if any((item["height"], item["width"]) != (height, width) or item["schema"] != SCHEMA for item in observations):
        raise ValueError("统一模型批次必须按棋盘尺寸分组，且协议一致。")
    count = len(records)
    ships = max(len(item["ships"]) for item in observations)
    weapons = max(len(item["weapons"]) for item in observations)
    offsets = max(len(weapon["offsets"]) for item in observations for weapon in item["weapons"])
    variants = max(1, max(len(weapon["variants"]) for item in observations for weapon in item["weapons"]))
    variant_offsets = max(1, max((len(variant["offsets"]) for item in observations for weapon in item["weapons"]
                                  for variant in weapon["variants"]), default=0))
    action_count = max(len(item["actionWeapons"]) for item in observations)
    lengths = [len(record.get("history", [])) for record in records]
    arrays = {"planes": np.asarray([item["planes"] for item in observations], dtype=np.float32).reshape(count, CHANNELS, height, width),
              "globals": np.asarray([item["globals"] for item in observations], dtype=np.float32),
              "ships": np.zeros((count, ships, 6), dtype=np.float32), "shipMask": np.zeros((count, ships), dtype=np.bool_),
              "weapons": np.zeros((count, weapons, 7), dtype=np.float32), "weaponMask": np.zeros((count, weapons), dtype=np.bool_),
              "offsets": np.zeros((count, weapons, offsets, 6), dtype=np.float32),
              "offsetMask": np.zeros((count, weapons, offsets), dtype=np.bool_),
              "positions": np.zeros((count, weapons, offsets, 2), dtype=np.int64),
              "variants": np.zeros((count, weapons, variants, 16), dtype=np.float32),
              "variantMask": np.zeros((count, weapons, variants), dtype=np.bool_),
              "variantOffsets": np.zeros((count, weapons, variants, variant_offsets, 6), dtype=np.float32),
              "variantOffsetMask": np.zeros((count, weapons, variants, variant_offsets), dtype=np.bool_),
              "events": np.zeros((count, max(1, max(lengths)), EVENT_CHANNELS, height, width), dtype=np.float32),
              "eventMask": np.arange(max(1, max(lengths)))[None] < np.asarray(lengths)[:, None],
              "mask": np.zeros((count, action_count * height * width), dtype=np.bool_)}
    for index, item in enumerate(observations):
        arrays["ships"][index, :len(item["ships"])] = item["ships"]
        arrays["shipMask"][index, :len(item["ships"])] = True
        arrays["mask"][index, :len(item["mask"])] = item["mask"]
        for weapon_index, weapon in enumerate(item["weapons"]):
            arrays["weapons"][index, weapon_index] = weapon["features"]
            arrays["weaponMask"][index, weapon_index] = True
            size = len(weapon["offsets"])
            arrays["offsets"][index, weapon_index, :size] = weapon["offsets"]
            arrays["positions"][index, weapon_index, :size] = weapon["positions"]
            arrays["offsetMask"][index, weapon_index, :size] = True
            for variant_index, variant in enumerate(weapon["variants"]):
                arrays["variants"][index, weapon_index, variant_index] = variant["features"]
                arrays["variantMask"][index, weapon_index, variant_index] = True
                size = len(variant["offsets"])
                arrays["variantOffsets"][index, weapon_index, variant_index, :size] = variant["offsets"]
                arrays["variantOffsetMask"][index, weapon_index, variant_index, :size] = True
        if lengths[index]:
            arrays["events"][index, :lengths[index]] = np.asarray(records[index]["history"]).reshape(lengths[index], EVENT_CHANNELS, height, width)
    if any(not np.isfinite(array).all() for array in arrays.values()):
        raise ValueError("统一训练输入存在非有限值。")
    result = {key: torch.as_tensor(value, device=device) for key, value in arrays.items()}
    result["actionCount"] = action_count
    return result


def masked_mean(values, mask, dimension):
    return (values * mask.unsqueeze(-1)).sum(dimension) / mask.sum(dimension).clamp_min(1).unsqueeze(-1)


class UnifiedNetwork(nn.Module):
    unified = True

    def __init__(self, kind="gru"):
        super().__init__()
        if kind not in ("gru", "attention"):
            raise ValueError("统一空间记忆模块必须为 gru 或 attention。")
        self.kind = kind
        self.conv1 = nn.Conv2d(CHANNELS, 12, 3, padding=1)
        self.conv2 = nn.Conv2d(12, 12, 3, padding=1)
        self.ship = nn.Linear(6, 8)
        self.offset = nn.Linear(6, 8)
        self.variant = nn.Linear(25, 8)
        self.weapon = nn.Linear(24, 12)
        self.context = nn.Linear(60, 12)
        self.event = nn.Linear(EVENT_CHANNELS, 8)
        if kind == "gru":
            self.memory = nn.GRU(8, 8, batch_first=True)
        else:
            self.query = nn.Linear(12, 8)
            self.key = nn.Linear(8, 8)
            self.memoryValue = nn.Linear(8, 8)
        self.fusion = nn.Linear(32, 12)
        self.coverage = nn.Linear(20, 12)
        self.policyHidden = nn.Linear(37, 12)
        self.policy = nn.Linear(12, 1)
        self.valueHidden = nn.Linear(20, 12)
        self.value = nn.Linear(12, 1)

    def forward(self, batch):
        spatial = torch.relu(self.conv2(torch.relu(self.conv1(batch["planes"]))))
        count, _, height, width = spatial.shape
        cells = height * width
        spatial = spatial.flatten(2).transpose(1, 2)
        ships = torch.relu(self.ship(batch["ships"]))
        offsets = torch.relu(self.offset(batch["offsets"]))
        offset_summary = masked_mean(offsets, batch["offsetMask"], 2)
        variant_offsets = torch.relu(self.offset(batch["variantOffsets"]))
        variant_summary = masked_mean(variant_offsets, batch["variantOffsetMask"], 3)
        variants = torch.relu(self.variant(torch.cat((batch["variants"], variant_summary,
            batch["variantOffsetMask"].sum(3).unsqueeze(-1) / 32), dim=-1)))
        weapons = torch.relu(self.weapon(torch.cat((batch["weapons"], offset_summary,
            masked_mean(variants, batch["variantMask"], 2), batch["offsetMask"].sum(2).unsqueeze(-1) / 32), dim=-1)))
        context = torch.relu(self.context(torch.cat((batch["globals"], masked_mean(ships, batch["shipMask"], 1),
            (ships * batch["shipMask"].unsqueeze(-1)).sum(1) / 16, masked_mean(weapons, batch["weaponMask"], 1),
            (weapons * batch["weaponMask"].unsqueeze(-1)).sum(1) / 16, spatial.mean(1)), dim=-1)))
        events = batch["events"].flatten(3).permute(0, 1, 3, 2)
        event_valid = (events[:, :, :, 2] > 0) & batch["eventMask"][:, :, None]
        embedded = torch.relu(self.event(events))
        if self.kind == "gru":
            lengths = event_valid.sum(1).reshape(-1)
            steps = max(1, int(lengths.max().item()))
            order = (~event_valid).to(torch.int64).argsort(dim=1, stable=True)[:, :steps]
            compact = embedded.gather(1, order.unsqueeze(-1).expand(-1, -1, -1, 8))
            compact = compact.permute(0, 2, 1, 3).reshape(count * cells, steps, 8)
            sequence, _ = self.memory(compact)
            memory = sequence[torch.arange(count * cells, device=spatial.device), lengths.clamp_min(1) - 1]
            memory = (memory * (lengths > 0).unsqueeze(-1)).reshape(count, cells, 8)
        else:
            positions = torch.arange(events.shape[1], device=spatial.device)[:, None]
            frequencies = torch.exp(torch.arange(0, 8, 2, device=spatial.device) * (-math.log(10000) / 8))
            position = torch.stack((torch.sin(positions * frequencies), torch.cos(positions * frequencies)), dim=-1).flatten(1)
            embedded = embedded + position[None, :, None]
            query = self.query(spatial)
            keys = self.key(embedded)
            values = self.memoryValue(embedded)
            scores = (query[:, None] * keys).sum(-1) / math.sqrt(8)
            weights = scores.masked_fill(~event_valid, -1e9).softmax(1)
            memory = (weights.unsqueeze(-1) * values).sum(1) * event_valid.any(1).unsqueeze(-1)
        fused = torch.relu(self.fusion(torch.cat((spatial, memory, context[:, None].expand(-1, cells, -1)), dim=-1)))
        rows = torch.arange(height, device=spatial.device).repeat_interleave(width)
        cols = torch.arange(width, device=spatial.device).repeat(height)
        positions = batch["positions"]
        source_rows = rows[None, None, :, None] + positions[:, :, None, :, 0]
        source_cols = cols[None, None, :, None] + positions[:, :, None, :, 1]
        valid = ((source_rows >= 0) & (source_rows < height) & (source_cols >= 0) & (source_cols < width)
                 & batch["offsetMask"][:, :, None])
        indices = source_rows.clamp(0, height - 1) * width + source_cols.clamp(0, width - 1)
        selected = fused[torch.arange(count, device=spatial.device)[:, None, None, None], indices]
        local = torch.relu(self.coverage(torch.cat((selected,
            offsets[:, :, None].expand(-1, -1, cells, -1, -1)), dim=-1)))
        coverage = masked_mean(local, valid, 3)
        policy_input = torch.cat((fused[:, None].expand(-1, weapons.shape[1], -1, -1),
            weapons[:, :, None].expand(-1, -1, cells, -1), coverage,
            valid.sum(3).unsqueeze(-1) / batch["offsetMask"].sum(2).clamp_min(1)[:, :, None, None]), dim=-1)
        logits = self.policy(torch.relu(self.policyHidden(policy_input))).squeeze(-1)
        value = self.value(torch.relu(self.valueHidden(torch.cat((context, memory.mean(1)), dim=-1)))).squeeze(-1)
        return logits[:, :batch["actionCount"]].flatten(1), value

    def export(self, metadata):
        layers = {}
        for name, module in self.named_children():
            if isinstance(module, (nn.Linear, nn.Conv2d)):
                layers[name] = {"shape": list(module.weight.shape), "weight": module.weight.detach().cpu().flatten().tolist(),
                                "bias": module.bias.detach().cpu().tolist()}
        if self.kind == "gru":
            for name, suffix in (("memoryInput", "ih"), ("memoryHidden", "hh")):
                weight = getattr(self.memory, f"weight_{suffix}_l0").detach().cpu()
                bias = getattr(self.memory, f"bias_{suffix}_l0").detach().cpu()
                layers[name] = {"shape": list(weight.shape), "weight": weight.flatten().tolist(), "bias": bias.tolist()}
        return {**metadata, "format": "naval-unified-v1", "schema": SCHEMA, "memoryKind": self.kind, "layers": layers}


def load_unified(network, model):
    if model["format"] != "naval-unified-v1" or model["schema"] != SCHEMA or model["memoryKind"] != network.kind:
        raise ValueError("统一模型协议不一致。")
    expected = {name for name, module in network.named_children() if isinstance(module, (nn.Linear, nn.Conv2d))}
    if network.kind == "gru":
        expected.update(("memoryInput", "memoryHidden"))
    if set(model["layers"]) != expected:
        raise ValueError("统一模型层集合不完整。")
    with torch.no_grad():
        for name, layer in model["layers"].items():
            if name in ("memoryInput", "memoryHidden"):
                suffix = "ih" if name == "memoryInput" else "hh"
                weight = getattr(network.memory, f"weight_{suffix}_l0")
                bias = getattr(network.memory, f"bias_{suffix}_l0")
            else:
                module = getattr(network, name)
                weight, bias = module.weight, module.bias
            if list(weight.shape) != layer["shape"] or len(layer["weight"]) != weight.numel() or len(layer["bias"]) != bias.numel():
                raise ValueError("统一模型层形状不一致。")
            if not np.isfinite(layer["weight"]).all() or not np.isfinite(layer["bias"]).all():
                raise ValueError("统一模型参数非有限。")
            weight.copy_(torch.tensor(layer["weight"]).reshape(layer["shape"]))
            bias.copy_(torch.tensor(layer["bias"]))
