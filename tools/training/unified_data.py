import argparse
import hashlib
import json
import time
from pathlib import Path

import numpy as np

from simulation_data import Environment, source_hash, validation_group
from unified_inputs import unified_arrays, CHANNELS, EVENT_CHANNELS, SCHEMA


def collect_unified_expert(environment, games, seed, max_plies):
    response = environment.call({"type": "reset", "games": games, "seed": seed, "maxPlies": max_plies, "paired": False})
    configurations = response["configurations"]
    if any(config["tuning"]["search"] or not config["tuning"]["fastSampling"] for config in configurations):
        raise ValueError("统一冷启动教师必须为无搜索的旧困难 AI。")
    first = response["observations"][0]["observation"]
    layout = {key: first[key] for key in ("schema", "rulesId", "height", "width")}
    histories = [[] for _ in range(games * 2)]
    trajectories = [[] for _ in range(games)]
    records = []
    outcomes = []
    while response["observations"]:
        pending = {}
        for item in response["observations"]:
            observation = item["observation"]
            if any(observation[key] != value for key, value in layout.items()):
                raise ValueError("统一冷启动数据协议发生漂移。")
            index, seat = item["index"], item["seat"]
            slot = 2 * index + int(seat == "B")
            histories[slot].extend(item["events"])
            pending[index] = {"observation": observation, "slot": slot, "length": len(histories[slot]),
                              "seat": seat, "validation": validation_group(seed, index)}
        response = environment.call({"type": "step", "actions": [{"index": index, "action": None} for index in pending]})
        executed = set()
        for item in response["actions"]:
            index = item["index"]
            record = pending[index]
            if index in executed or item["seat"] != record["seat"] or not record["observation"]["mask"][item["action"]]:
                raise RuntimeError("统一冷启动真实行动与行动前观测不匹配。")
            executed.add(index)
            trajectories[index].append(len(records))
            records.append({**record, "action": item["action"]})
        if executed != set(pending):
            raise RuntimeError("统一冷启动采集存在未执行行动。")
        for result in response["results"]:
            index = result["index"]
            for position in trajectories[index]:
                record = records[position]
                record["value_valid"] = not result["truncated"]
                record["return"] = 0.0 if result["truncated"] else 0.5 if result["winner"] is None else float(result["winner"] == record["seat"])
            outcomes.append({**configurations[index], "winner": result["winner"], "plies": result["plies"],
                             "truncated": result["truncated"], "validation": validation_group(seed, index)})
    if len(outcomes) != games or any("return" not in record for record in records):
        raise RuntimeError("统一冷启动轨迹不完整。")
    packed, _ = unified_arrays(records)
    arrays = {key: value for key, value in packed.items() if key not in ("events", "eventMask")}
    arrays.update({key: np.asarray([record[key] for record in records], dtype=dtype)
                   for key, dtype in (("action", np.int64), ("return", np.float32), ("value_valid", np.bool_),
                                      ("validation", np.bool_), ("slot", np.int64), ("length", np.int64))})
    arrays["weaponIds"] = np.asarray([[weapon["id"] for weapon in record["observation"]["weapons"]] for record in records])
    arrays["ownCounts"] = np.asarray([len(record["observation"]["actionWeapons"]) for record in records], dtype=np.int64)
    arrays["events"] = np.asarray([event for history in histories for event in history], dtype=np.float32).reshape(-1, EVENT_CHANNELS * layout["height"] * layout["width"])
    arrays["historyOffsets"] = np.cumsum([0] + [len(history) for history in histories], dtype=np.int64)
    return arrays, layout, sorted(outcomes, key=lambda item: item["index"])


class UnifiedDataset:
    def __init__(self, root):
        manifest = json.loads((root / "manifest.json").read_text(encoding="utf-8"))
        if manifest["format"] != "naval-unified-expert-v1" or manifest["layout"]["schema"] != SCHEMA:
            raise ValueError("统一冷启动数据协议不符。")
        self.layout = manifest["layout"]
        self.manifest = manifest
        self.shards = []
        self.indices = []
        flags = []
        cells = self.layout["height"] * self.layout["width"]
        for shard_index, entry in enumerate(manifest["shards"]):
            filename = root / entry["file"]
            if hashlib.sha256(filename.read_bytes()).hexdigest() != entry["sha256"]:
                raise ValueError("统一冷启动分片校验失败。")
            with np.load(filename, allow_pickle=False) as archive:
                shard = {key: archive[key] for key in archive.files}
            count = len(shard["action"])
            if count != entry["records"] or shard["planes"].shape != (count, CHANNELS, self.layout["height"], self.layout["width"]):
                raise ValueError("统一冷启动棋盘形状不符。")
            if np.any((shard["action"] < 0) | (shard["action"] >= shard["ownCounts"] * cells)) or not shard["mask"][np.arange(count), shard["action"]].all():
                raise ValueError("统一冷启动含非法行动标签。")
            if any(not np.isfinite(array).all() for array in shard.values() if array.dtype.kind in "fiu"):
                raise ValueError("统一冷启动存在非有限数据。")
            offsets = shard["historyOffsets"]
            if offsets[0] != 0 or offsets[-1] != len(shard["events"]) or np.any(np.diff(offsets) < 0):
                raise ValueError("统一历史存储索引无效。")
            if np.any((shard["slot"] < 0) | (shard["slot"] >= len(offsets) - 1)):
                raise ValueError("统一历史座位索引无效。")
            if np.any((shard["length"] < 0) | (shard["length"] > np.diff(offsets)[shard["slot"]])):
                raise ValueError("统一历史前缀越界。")
            self.shards.append(shard)
            self.indices.extend((shard_index, index) for index in range(count))
            flags.extend(shard["validation"])
        flags = np.asarray(flags, dtype=np.bool_)
        self.train, self.validation = np.flatnonzero(~flags), np.flatnonzero(flags)
        if not len(self.train) or not len(self.validation):
            raise ValueError("统一训练与验证均须含完整对局。")

    def records(self, indices):
        records = []
        for index in indices:
            shard_index, row = self.indices[index]
            shard = self.shards[shard_index]
            weapons = []
            for weapon_index in np.flatnonzero(shard["weaponMask"][row]):
                variants = [{"features": shard["variants"][row, weapon_index, variant],
                             "offsets": shard["variantOffsets"][row, weapon_index, variant][shard["variantOffsetMask"][row, weapon_index, variant]]}
                            for variant in np.flatnonzero(shard["variantMask"][row, weapon_index])]
                valid = shard["offsetMask"][row, weapon_index]
                weapons.append({"id": str(shard["weaponIds"][row, weapon_index]), "features": shard["weapons"][row, weapon_index],
                                "offsets": shard["offsets"][row, weapon_index][valid],
                                "positions": shard["positions"][row, weapon_index][valid], "variants": variants})
            own = int(shard["ownCounts"][row])
            observation = {**self.layout, "planes": shard["planes"][row].reshape(-1), "globals": shard["globals"][row],
                           "ships": shard["ships"][row][shard["shipMask"][row]], "weapons": weapons,
                           "actionWeapons": [weapon["id"] for weapon in weapons[:own]], "mask": shard["mask"][row, :own * self.layout["height"] * self.layout["width"]]}
            start = shard["historyOffsets"][shard["slot"][row]]
            records.append({"observation": observation, "history": shard["events"][start:start + shard["length"][row]],
                            "action": int(shard["action"][row]), "return": float(shard["return"][row]), "value_valid": bool(shard["value_valid"][row])})
        return records


def main():
    parser = argparse.ArgumentParser(description="在新规则下采集统一模型的真实教师行动与完整终局。")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--batches", type=int, default=20)
    parser.add_argument("--games", type=int, default=98)
    parser.add_argument("--seed", type=int, default=251026)
    parser.add_argument("--max-plies", type=int, default=320)
    arguments = parser.parse_args()
    if arguments.games < 2 or min(arguments.batches, arguments.max_plies) < 1:
        parser.error("采集预算无效。")
    arguments.output.mkdir(parents=True, exist_ok=False)
    manifest = {"format": "naval-unified-expert-v1", "source_sha256": source_hash(), "shards": [],
                "teacher": "old-HARD fastSampling=true search=false; actual executed actions",
                "split": "SHA256(expert|batch-seed|game-index) modulo 5; whole games", "arguments": vars(arguments).copy()}
    manifest["arguments"]["output"] = str(arguments.output)
    environment = Environment("unified")
    started = time.perf_counter()
    try:
        for iteration in range(arguments.batches):
            arrays, layout, outcomes = collect_unified_expert(environment, arguments.games, arguments.seed + 7919 * iteration, arguments.max_plies)
            if "layout" in manifest and manifest["layout"] != layout:
                raise ValueError("统一冷启动分片之间协议漂移。")
            manifest["layout"] = layout
            filename = arguments.output / f"batch-{iteration:03d}.npz"
            np.savez_compressed(filename, **arrays)
            entry = {"file": filename.name, "sha256": hashlib.sha256(filename.read_bytes()).hexdigest(),
                     "records": len(arrays["action"]), "games": outcomes, "truncated": sum(item["truncated"] for item in outcomes)}
            manifest["shards"].append(entry)
            manifest["seconds"] = time.perf_counter() - started
            (arguments.output / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
            print(json.dumps({key: value for key, value in entry.items() if key != "games"}), flush=True)
    finally:
        environment.close()


if __name__ == "__main__":
    main()
