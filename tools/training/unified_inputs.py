import numpy as np


SCHEMA = "naval-grid-v1"
CHANNELS = 22
EVENT_CHANNELS = 18


def unified_arrays(records):
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
    return arrays, action_count
