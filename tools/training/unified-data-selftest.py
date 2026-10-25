import argparse
from pathlib import Path

import numpy as np

from expert_data import collect_expert
from simulation_data import Environment
from unified_data import UnifiedDataset, collect_unified_expert
from unified_inputs import unified_arrays, EVENT_CHANNELS


def main():
    parser = argparse.ArgumentParser(description="仅用 NumPy 验证真实教师分片往返、公开历史和终局／截断采集。")
    parser.add_argument("data", type=Path)
    arguments = parser.parse_args()
    dataset = UnifiedDataset(arguments.data)
    first = 0
    count = 0
    for shard in dataset.shards:
        size = len(shard["action"])
        records = dataset.records(np.arange(first, first + size))
        arrays, action_count = unified_arrays(records)
        if action_count != int(shard["ownCounts"].max()):
            raise RuntimeError("统一动作数量往返后改变。")
        for name, values in arrays.items():
            if name not in ("events", "eventMask"):
                np.testing.assert_array_equal(values, shard[name], err_msg=f"真实分片往返改变了 {name}")
        for index, record in enumerate(records):
            length = int(shard["length"][index])
            start = int(shard["historyOffsets"][shard["slot"][index]])
            expected = shard["events"][start:start + length].reshape(length, EVENT_CHANNELS,
                dataset.layout["height"], dataset.layout["width"])
            np.testing.assert_array_equal(arrays["events"][index, :length], expected)
            if arrays["events"][index, length:].any() or arrays["eventMask"][index].sum() != length:
                raise RuntimeError("公开历史前缀或补齐内容改变。")
            if record["action"] != shard["action"][index] or record["return"] != shard["return"][index]:
                raise RuntimeError("真实动作或终局标签往返后改变。")
        first += size
        count += size
    environment = Environment("unified")
    try:
        arrays, layout, outcomes = collect_unified_expert(environment, 2, 251032, 1)
        if len(arrays["action"]) != 2 or arrays["value_valid"].any() or not all(item["truncated"] for item in outcomes):
            raise RuntimeError("统一教师采集将截断误当终局，或记录了未执行行动。")
        if arrays["globals"][:, 2:7].any():
            raise RuntimeError("取消自动追击后仍出现追击输入。")
        arrays, _, outcomes = collect_unified_expert(environment, 2, 251032, 320)
        if not arrays["value_valid"].all() or any(item["truncated"] or item["winner"] not in ("A", "B") for item in outcomes):
            raise RuntimeError("统一教师完整对局未产生正常终局标签。")
    finally:
        environment.close()
    environment = Environment()
    try:
        legacy, _, outcomes = collect_expert(environment, 2, 251032, 1)
        if len(legacy["actions"]) != 2 or legacy["value_valid"].any() or not all(item["truncated"] for item in outcomes):
            raise RuntimeError("原协议教师采集的截断语义改变。")
    finally:
        environment.close()
    print(f"UNIFIED CPU DATA SELFTEST OK: {count} 条真实记录逐数组相同；规则 {layout['rulesId']}，终局与截断采集通过")


if __name__ == "__main__":
    main()
