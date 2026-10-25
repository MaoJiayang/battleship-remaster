import argparse
import hashlib
import json
from collections import Counter
from pathlib import Path

import numpy as np


def audit(root, expected_rules=None):
    manifest_file = root / "manifest.json"
    manifest_bytes = manifest_file.read_bytes()
    manifest = json.loads(manifest_bytes)
    if manifest["format"] != "naval-unified-expert-v1":
        raise ValueError("统一数据格式不符。")
    if expected_rules is not None and manifest["layout"]["rulesId"] != expected_rules:
        raise ValueError("统一数据与本轮预期规则不一致。")
    cells = manifest["layout"]["height"] * manifest["layout"]["width"]
    configurations = Counter()
    policies = Counter()
    records_by_faction = {split: Counter() for split in ("train", "validation")}
    weapons = {split: Counter() for split in ("train", "validation")}
    games_by_split = Counter()
    returns = Counter()
    total_records = 0
    truncated = 0
    max_history = 0
    prior_records = 0
    for entry in manifest["shards"]:
        filename = root / entry["file"]
        if hashlib.sha256(filename.read_bytes()).hexdigest() != entry["sha256"]:
            raise ValueError("统一数据分片哈希不符。")
        games = {game["index"]: game for game in entry["games"]}
        for game in games.values():
            configurations[tuple(game["factions"])] += 1
            games_by_split["validation" if game["validation"] else "train"] += 1
            policies[tuple(game["factions"])] += 1
            policies[tuple(reversed(game["factions"]))] += 1
            truncated += int(game["truncated"])
        with np.load(filename, allow_pickle=False) as arrays:
            count = len(arrays["action"])
            if count != entry["records"]:
                raise ValueError("统一数据记录数不符。")
            total_records += count
            offsets = arrays["historyOffsets"]
            if offsets[0] != 0 or offsets[-1] != len(arrays["events"]):
                raise ValueError("统一历史存储边界无效。")
            if arrays["events"].shape[1] != 18 * cells:
                raise ValueError("统一历史维度无效。")
            for slot in np.unique(arrays["slot"]):
                indices = np.flatnonzero(arrays["slot"] == slot)
                game = games[int(slot // 2)]
                seat = int(slot % 2)
                lengths = arrays["length"][indices]
                expected = np.arange(len(indices)) * 2 + seat
                if not np.array_equal(lengths, expected) or lengths.max() >= game["plies"]:
                    raise ValueError("统一历史包含未执行行动或未来事件。")
                if offsets[slot + 1] - offsets[slot] != lengths.max():
                    raise ValueError("统一历史共享存储与最后可见前缀不一致。")
                max_history = max(max_history, int(lengths.max()))
                if not np.all(arrays["validation"][indices] == game["validation"]):
                    raise ValueError("同局记录跨训练与验证集合。")
                if not np.all(arrays["value_valid"][indices] == (not game["truncated"])):
                    raise ValueError("终局与训练截断价值标签不符。")
                expected_return = 0.0 if game["truncated"] else 0.5 if game["winner"] is None else float(game["winner"] == ("A" if seat == 0 else "B"))
                if not np.all(arrays["return"][indices] == expected_return):
                    raise ValueError("统一价值标签与真实赢家不符。")
                split = "validation" if game["validation"] else "train"
                records_by_faction[split][game["factions"][seat]] += len(indices)
            row_indices = np.arange(count)
            action_indices = arrays["action"]
            if np.any(action_indices < 0) or np.any(action_indices >= arrays["ownCounts"] * cells) or not arrays["mask"][row_indices, action_indices].all():
                raise ValueError("统一教师行动标签非法。")
            labels = arrays["weaponIds"][row_indices, action_indices // cells]
            for split, selected in (("train", ~arrays["validation"]), ("validation", arrays["validation"])):
                weapons[split].update(labels[selected].tolist())
            returns.update(str(value) for value in arrays["return"].tolist())
            prior_records += int(np.any(arrays["planes"][:, 19] != 0, axis=(1, 2)).sum())
            target = arrays["ships"][:, :, 0] < 0
            if np.any(arrays["ships"][:, :, 4][target] != 0) or np.any(arrays["ships"][:, :, 5][target] != 0):
                raise ValueError("统一敌舰摘要含未知血量。")
    complete = len(manifest["shards"]) == manifest["arguments"]["batches"]
    report = {"complete": complete, "shards": len(manifest["shards"]), "games": sum(configurations.values()),
              "records": total_records, "truncated": truncated, "rulesId": manifest["layout"]["rulesId"],
              "gamesBySplit": dict(games_by_split), "recordsByFaction": records_by_faction, "weapons": weapons,
              "hostMatchups": {"/".join(key): value for key, value in sorted(configurations.items())},
              "policyMatchups": {"/".join(key): value for key, value in sorted(policies.items())},
              "returns": dict(returns), "maxHistory": max_history, "recordsWithHistoricalPrior": prior_records,
              "manifestSha256": hashlib.sha256(manifest_bytes).hexdigest(),
              "auditSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}
    if complete and manifest["arguments"]["games"] % 49 == 0 and (len(configurations) != 49 or len(set(configurations.values())) != 1):
        raise ValueError("完整采集未均衡覆盖七学说有序对位。")
    return report


def main():
    parser = argparse.ArgumentParser(description="流式核对统一冷启动数据的实际对位、历史边界、终局标签及合法行动。")
    parser.add_argument("data", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--rules-id")
    arguments = parser.parse_args()
    report = audit(arguments.data, arguments.rules_id)
    arguments.output.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps({key: report[key] for key in ("complete", "games", "records", "truncated", "gamesBySplit", "recordsWithHistoricalPrior")}))


if __name__ == "__main__":
    main()
