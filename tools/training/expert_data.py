import argparse
import hashlib
import json
import time
from pathlib import Path

import numpy as np

from memory_model import HISTORY_FEATURES, HISTORY_SCHEMA
from ppo import Environment


def validation_group(seed, index):
    return int(hashlib.sha256(f"expert|{seed}|{index}".encode()).hexdigest(), 16) % 5 == 0


def source_hash():
    root = Path(__file__).resolve().parents[2]
    filenames = sorted((root / "src").rglob("*.js")) + sorted(Path(__file__).parent.glob("*.py"))
    filenames += sorted(Path(__file__).parent.glob("*.mjs")) + sorted((root / "tools/sim").glob("*.mjs"))
    digest = hashlib.sha256()
    for filename in filenames:
        digest.update(filename.relative_to(root).as_posix().encode())
        digest.update(filename.read_bytes())
    return digest.hexdigest()


def collect_expert(environment, games, seed, max_plies):
    response = environment.call({"type": "reset", "games": games, "seed": seed, "maxPlies": max_plies, "paired": False})
    configurations = response["configurations"]
    if any(config["tuning"]["search"] or not config["tuning"]["fastSampling"] for config in configurations):
        raise ValueError("监督教师必须为无搜索、快速采样的旧困难 AI。")
    first = response["observations"][0]
    layout = {"schema": first["schema"], "rulesId": first["rulesId"], "boardSize": 11,
              "channels": 17, "globalSize": len(first["globals"])}
    histories = [[] for _ in range(games * 2)]
    records = []
    trajectories = [[] for _ in range(games)]
    outcomes = []
    while response["observations"]:
        pending = {}
        for observation in response["observations"]:
            if observation["schema"] != layout["schema"] or observation["rulesId"] != layout["rulesId"]:
                raise ValueError("教师观测协议漂移。")
            index, seat = observation["index"], observation["seat"]
            slot = 2 * index + int(seat == "B")
            histories[slot].extend(np.asarray(event, dtype=np.float32) for event in observation["events"])
            pending[index] = {"features": np.asarray(observation["planes"] + observation["globals"], dtype=np.float32),
                              "mask": np.asarray(observation["mask"], dtype=np.uint8), "slot": slot,
                              "length": len(histories[slot]), "seat": seat}
        response = environment.call({"type": "step", "actions": [{"index": index, "action": None} for index in pending]})
        executed = set()
        for action in response["actions"]:
            index = action["index"]
            record = pending[index]
            if index in executed or action["seat"] != record["seat"] or not record["mask"][action["action"]]:
                raise RuntimeError("真实教师行动与行动前公平观测不匹配。")
            executed.add(index)
            trajectories[index].append(len(records))
            records.append({**record, "action": action["action"], "validation": validation_group(seed, index)})
        if executed != set(pending):
            raise RuntimeError("教师采集出现未执行的行动。")
        for result in response["results"]:
            index = result["index"]
            for position in trajectories[index]:
                record = records[position]
                record["value_valid"] = not result["truncated"]
                record["value"] = 0.0 if result["truncated"] else 0.5 if result["winner"] is None else float(result["winner"] == record["seat"])
            outcomes.append({**configurations[index], "winner": result["winner"], "plies": result["plies"],
                             "truncated": result["truncated"], "validation": validation_group(seed, index)})
    if len(outcomes) != games or any("value" not in record for record in records):
        raise RuntimeError("教师轨迹不完整。")
    offsets = np.cumsum([0] + [len(history) for history in histories], dtype=np.int64)
    arrays = {"features": np.asarray([record["features"] for record in records]),
              "masks": np.asarray([record["mask"] for record in records]),
              "actions": np.asarray([record["action"] for record in records], dtype=np.int64),
              "values": np.asarray([record["value"] for record in records], dtype=np.float32),
              "value_valid": np.asarray([record["value_valid"] for record in records], dtype=np.bool_),
              "validation": np.asarray([record["validation"] for record in records], dtype=np.bool_),
              "slots": np.asarray([record["slot"] for record in records], dtype=np.int64),
              "lengths": np.asarray([record["length"] for record in records], dtype=np.int64),
              "events": np.asarray([event for history in histories for event in history], dtype=np.float32).reshape(-1, HISTORY_FEATURES),
              "offsets": offsets}
    return arrays, layout, sorted(outcomes, key=lambda result: result["index"])


class ExpertDataset:
    def __init__(self, root):
        manifest = json.loads((root / "manifest.json").read_text(encoding="utf-8"))
        if manifest["format"] != "naval-expert-v1" or manifest["historySchema"] != HISTORY_SCHEMA:
            raise ValueError("监督数据协议不匹配。")
        self.layout = manifest["layout"]
        self.manifest = manifest
        self.shards = []
        self.indices = []
        validation = []
        for shard_index, entry in enumerate(manifest["shards"]):
            filename = root / entry["file"]
            if hashlib.sha256(filename.read_bytes()).hexdigest() != entry["sha256"]:
                raise ValueError("监督数据分片校验失败。")
            with np.load(filename, allow_pickle=False) as archive:
                shard = {key: archive[key] for key in archive.files}
            count = len(shard["actions"])
            if count != entry["records"] or shard["features"].shape != (count, 17 * 121 + self.layout["globalSize"]):
                raise ValueError("监督数据形状错误。")
            if not np.isfinite(shard["features"]).all() or not np.isfinite(shard["events"]).all():
                raise ValueError("监督输入存在非有限值。")
            if shard["masks"].shape != (count, 363) or np.any((shard["actions"] < 0) | (shard["actions"] >= 363)):
                raise ValueError("监督行动形状错误。")
            if not shard["masks"][np.arange(count), shard["actions"]].all():
                raise ValueError("监督标签包含非法行动。")
            if shard["offsets"][0] != 0 or shard["offsets"][-1] != len(shard["events"]) or np.any(np.diff(shard["offsets"]) < 0):
                raise ValueError("历史索引错误。")
            if np.any((shard["slots"] < 0) | (shard["slots"] >= len(shard["offsets"]) - 1)):
                raise ValueError("历史座位索引错误。")
            if np.any((shard["lengths"] < 0) | (shard["lengths"] > np.diff(shard["offsets"])[shard["slots"]])):
                raise ValueError("历史前缀越界。")
            if np.any(~np.isfinite(shard["values"])) or np.any((shard["values"] < 0) | (shard["values"] > 1)):
                raise ValueError("价值标签无效。")
            self.shards.append(shard)
            self.indices.extend((shard_index, index) for index in range(count))
            validation.extend(shard["validation"])
        validation = np.asarray(validation, dtype=np.bool_)
        self.train = np.flatnonzero(~validation)
        self.validation = np.flatnonzero(validation)
        if not len(self.train) or not len(self.validation):
            raise ValueError("训练与验证都须包含完整对局。")

    def records(self, indices):
        records = []
        for index in indices:
            shard_index, row = self.indices[index]
            shard = self.shards[shard_index]
            features = shard["features"][row]
            start = shard["offsets"][shard["slots"][row]]
            records.append({"planes": features[:17 * 121], "globals": features[17 * 121:], "mask": shard["masks"][row],
                            "history": shard["events"][start:start + shard["lengths"][row]], "action": int(shard["actions"][row]),
                            "return": float(shard["values"][row]), "value_valid": bool(shard["value_valid"][row])})
        return records


def main():
    parser = argparse.ArgumentParser(description="采集旧困难 AI 的实际出招和公平公开历史，供记忆模型监督预热。")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--batches", type=int, default=20)
    parser.add_argument("--games", type=int, default=98)
    parser.add_argument("--seed", type=int, default=240126)
    parser.add_argument("--max-plies", type=int, default=320)
    arguments = parser.parse_args()
    if min(arguments.batches, arguments.games, arguments.max_plies) < 1 or arguments.games < 2:
        parser.error("采集预算必须为正，每批至少两局。")
    arguments.output.mkdir(parents=True, exist_ok=False)
    manifest = {"format": "naval-expert-v1", "historySchema": HISTORY_SCHEMA, "source_sha256": source_hash(),
                "teacher": "old-HARD fastSampling=true search=false; actual executed actions", "shards": [],
                "split": "SHA256(expert|batch-seed|game-index) modulo 5; whole games", "arguments": vars(arguments).copy()}
    manifest["arguments"]["output"] = str(arguments.output)
    started = time.perf_counter()
    environment = Environment()
    try:
        for iteration in range(arguments.batches):
            arrays, layout, outcomes = collect_expert(environment, arguments.games, arguments.seed + iteration * 7919, arguments.max_plies)
            if "layout" in manifest and manifest["layout"] != layout:
                raise ValueError("采集批次之间协议漂移。")
            manifest["layout"] = layout
            filename = arguments.output / f"batch-{iteration:03d}.npz"
            np.savez_compressed(filename, **arrays)
            entry = {"file": filename.name, "sha256": hashlib.sha256(filename.read_bytes()).hexdigest(),
                     "records": len(arrays["actions"]), "games": outcomes, "truncated": sum(result["truncated"] for result in outcomes)}
            manifest["shards"].append(entry)
            manifest["seconds"] = time.perf_counter() - started
            (arguments.output / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
            print(json.dumps({key: value for key, value in entry.items() if key != "games"}), flush=True)
    finally:
        environment.close()


if __name__ == "__main__":
    main()
