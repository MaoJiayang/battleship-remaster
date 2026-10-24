import argparse
import copy
import hashlib
import json
import os
import subprocess
import time
from pathlib import Path

import numpy as np

from rocm_runtime import configure_headers

configure_headers()

import torch
from torch.nn import functional

from memory_model import MemoryNetwork, HISTORY_FEATURES, load_board, load_memory


class Environment:
    def __init__(self, encoding="legacy"):
        self.encoding = encoding
        self.process = subprocess.Popen(["node", str(Path(__file__).with_name("policy-environment.mjs"))],
                                        stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, encoding="utf-8",
                                        creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)

    def call(self, request):
        if request.get("type") == "reset":
            request = {**request, "encoding": self.encoding}
        self.process.stdin.write(json.dumps(request) + "\n")
        self.process.stdin.flush()
        line = self.process.stdout.readline()
        if not line:
            raise RuntimeError("模拟环境提前退出。")
        result = json.loads(line)
        if "error" in result:
            raise RuntimeError(result["error"])
        return result

    def close(self):
        self.process.stdin.close()
        try:
            self.process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            self.process.kill()
            self.process.wait()


def batch(records, device):
    planes = torch.tensor(np.asarray([record["planes"] for record in records]), dtype=torch.float32, device=device).reshape(-1, 17, 11, 11)
    globals = torch.tensor(np.asarray([record["globals"] for record in records]), dtype=torch.float32, device=device)
    mask = torch.tensor(np.asarray([record["mask"] for record in records]), dtype=torch.bool, device=device)
    lengths = torch.tensor([len(record["history"]) for record in records], device=device)
    events = np.zeros((len(records), max(1, lengths.max().item()), HISTORY_FEATURES), dtype=np.float32)
    for index, record in enumerate(records):
        if len(record["history"]):
            events[index, :len(record["history"])] = record["history"]
    return planes, globals, torch.tensor(events, device=device), lengths, mask


def distribution(network, records, device):
    if getattr(network, "unified", False):
        from unified_model import unified_batch
        batch_input = unified_batch(records, device)
        logits, values = network(batch_input)
        return torch.distributions.Categorical(logits=logits.masked_fill(~batch_input["mask"], -1e9)), values.sigmoid()
    planes, globals, events, lengths, mask = batch(records, device)
    logits, values = network(planes, globals, events, lengths)
    return torch.distributions.Categorical(logits=logits.masked_fill(~mask, -1e9)), values.sigmoid()


def collect(environment, network, pool, games, seed, max_plies, device, generator, expected_layout=None):
    learner_seats = ["A" if index % 2 == 0 else "B" for index in range(games)]
    opponents = generator.integers(0, len(pool) + 2, size=games)
    histories = {(index, seat): [] for index in range(games) for seat in ("A", "B")}
    trajectories = [[] for _ in range(games)]
    response = environment.call({"type": "reset", "games": games, "seed": seed, "maxPlies": max_plies,
                                 "learnerSeats": learner_seats})
    outcomes = []
    while response["observations"]:
        observations = response["observations"]
        groups = {}
        commands = []
        for observation in observations:
            body = observation.get("observation", observation)
            if expected_layout and (body["rulesId"] != expected_layout["rulesId"] or body["schema"] != expected_layout["schema"]):
                raise ValueError("训练环境的规则或公平观测协议与初始模型不一致。")
            index, seat = observation["index"], observation["seat"]
            history = histories[index, seat]
            incoming = observation.pop("events")
            if getattr(network, "unified", False):
                incoming = [np.asarray(event, dtype=np.float32) for event in incoming]
            history.extend(incoming)
            observation["history"] = list(history)
            learner = seat == learner_seats[index]
            opponent = opponents[index]
            if not learner and opponent == 0:
                commands.append({"index": index, "action": None})
                continue
            kind = -1 if learner or opponent == 1 else int(opponent - 2)
            groups.setdefault(kind, []).append(observation)
        with torch.no_grad():
            for kind, selected in groups.items():
                policy = network if kind == -1 else pool[kind]
                action_distribution, values = distribution(policy, selected, device)
                actions = action_distribution.sample()
                logs = action_distribution.log_prob(actions)
                for row, observation in enumerate(selected):
                    index = observation["index"]
                    commands.append({"index": index, "action": actions[row].item()})
                    if observation["seat"] == learner_seats[index]:
                        trajectories[index].append({**observation, "action": actions[row].item(),
                                                    "old_log": logs[row].item(), "old_value": values[row].item()})
        response = environment.call({"type": "step", "actions": commands})
        for result in response["results"]:
            index = result["index"]
            if result["truncated"]:
                if result["currentSeat"] != learner_seats[index] or result["learnerSeat"] != learner_seats[index]:
                    raise RuntimeError("训练截断没有对齐下一次己方决策。")
                final = next(item for item in result["finalObservations"] if item["seat"] == learner_seats[index])
                incoming = final.pop("events")
                if getattr(network, "unified", False):
                    incoming = [np.asarray(event, dtype=np.float32) for event in incoming]
                histories[index, final["seat"]].extend(incoming)
                final["history"] = histories[index, final["seat"]]
                with torch.no_grad():
                    _, value = distribution(network, [final], device)
                target = value.item()
            else:
                target = 0.5 if result["winner"] is None else float(result["winner"] == learner_seats[index])
            for record in trajectories[index]:
                record["return"] = target
            outcomes.append({"index": index, "opponent": int(opponents[index]), "winner": result["winner"],
                             "learnerSeat": learner_seats[index], "truncated": result["truncated"], "plies": result["plies"]})
    records = [record for trajectory in trajectories for record in trajectory]
    if not records or len(outcomes) != games or any("return" not in record for record in records):
        raise RuntimeError("采集轨迹不完整。")
    return records, outcomes


def update(network, optimizer, records, device, generator, epochs, minibatch):
    advantages = np.asarray([record["return"] - record["old_value"] for record in records], dtype=np.float32)
    advantages = (advantages - advantages.mean()) / max(advantages.std(), 1e-8)
    for record, advantage in zip(records, advantages):
        record["advantage"] = float(advantage)
    totals = []
    stopped = False
    network.train()
    for epoch in range(epochs):
        order = generator.permutation(len(records))
        for start in range(0, len(order), minibatch):
            selected = [records[index] for index in order[start:start + minibatch]]
            actions = torch.tensor([record["action"] for record in selected], device=device)
            old_logs = torch.tensor([record["old_log"] for record in selected], device=device)
            targets = torch.tensor([record["return"] for record in selected], device=device)
            advantage = torch.tensor([record["advantage"] for record in selected], device=device)
            action_distribution, values = distribution(network, selected, device)
            logs = action_distribution.log_prob(actions)
            log_ratio = logs - old_logs
            ratio = log_ratio.exp()
            divergence = ((ratio - 1) - log_ratio).mean()
            if divergence.item() > 0.03:
                stopped = True
                break
            policy_loss = -torch.minimum(ratio * advantage, ratio.clamp(0.8, 1.2) * advantage).mean()
            value_loss = functional.binary_cross_entropy(values.clamp(1e-6, 1 - 1e-6), targets)
            entropy = action_distribution.entropy().mean()
            loss = policy_loss + value_loss - 0.01 * entropy
            if not torch.isfinite(loss):
                raise RuntimeError("PPO 损失出现非有限值。")
            optimizer.zero_grad(set_to_none=True)
            loss.backward()
            gradient = torch.nn.utils.clip_grad_norm_(network.parameters(), 0.5)
            if not torch.isfinite(gradient):
                raise RuntimeError("PPO 梯度出现非有限值。")
            optimizer.step()
            totals.append([policy_loss.item(), value_loss.item(), entropy.item(), divergence.item()])
        if stopped:
            break
    network.eval()
    return {"updates": len(totals), "kl_stopped": stopped,
            "means": np.asarray(totals).mean(axis=0).tolist() if totals else None}


def opponent_statistics(outcomes):
    groups = {}
    for result in outcomes:
        name = "old-HARD" if result["opponent"] == 0 else "current" if result["opponent"] == 1 else "history"
        group = groups.setdefault(name, {"games": 0, "wins": 0, "draws": 0, "truncated": 0})
        group["games"] += 1
        group["wins"] += int(result["winner"] == result["learnerSeat"])
        group["truncated"] += int(result["truncated"])
        group["draws"] += int(result["winner"] is None and not result["truncated"])
    for group in groups.values():
        group["rate"] = None if group["truncated"] else (group["wins"] + group["draws"] / 2) / group["games"]
    return groups


def parity(network, records, metadata, output, device):
    selected = [records[index] for index in np.linspace(0, len(records) - 1, min(8, len(records)), dtype=int)]
    if getattr(network, "unified", False):
        from unified_model import unified_batch
        with torch.no_grad():
            logits, values = network(unified_batch(selected, device))
        fixtures = [{"observation": record["observation"], "history": record["history"],
                     "expected": {"logits": logits[index].cpu().tolist(), "valueLogit": values[index].item(),
                                  "value": values[index].sigmoid().item()}} for index, record in enumerate(selected)]
        output.write_text(json.dumps(fixtures, default=lambda value: value.tolist()), encoding="utf-8")
        return
    planes, globals, events, lengths, _ = batch(selected, device)
    with torch.no_grad():
        logits, values = network(planes, globals, events, lengths)
    fixtures = []
    for index, record in enumerate(selected):
        fixtures.append({"observation": {"schema": metadata["schema"], "rulesId": metadata["rulesId"],
                                          "planes": np.asarray(record["planes"]).tolist(), "globals": np.asarray(record["globals"]).tolist(),
                                          "mask": np.asarray(record["mask"]).tolist()},
                         "events": np.asarray(record["history"]).tolist(), "expected": {"logits": logits[index].cpu().tolist(),
                         "valueLogit": values[index].item(), "value": values[index].sigmoid().item()}})
    output.write_text(json.dumps(fixtures), encoding="utf-8")


def main():
    parser = argparse.ArgumentParser(description="以公开历史和合法行动进行轻量记忆策略的 PPO 自对弈试验。")
    parser.add_argument("--initial", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--kind", choices=("gru", "attention"), required=True)
    parser.add_argument("--iterations", type=int, default=16)
    parser.add_argument("--games", type=int, default=98)
    parser.add_argument("--max-plies", type=int, default=320)
    parser.add_argument("--epochs", type=int, default=4)
    parser.add_argument("--minibatch", type=int, default=64)
    parser.add_argument("--seed", type=int, default=240124)
    parser.add_argument("--resume", type=Path)
    arguments = parser.parse_args()
    if min(arguments.iterations, arguments.games, arguments.max_plies, arguments.epochs, arguments.minibatch) < 1 or arguments.games % 2:
        parser.error("各预算必须为正整数，对局数必须为偶数。")
    arguments.output.mkdir(parents=True, exist_ok=False)
    torch.set_num_threads(2)
    torch.manual_seed(arguments.seed)
    generator = np.random.default_rng(arguments.seed)
    devices = [index for index in range(torch.cuda.device_count()) if "9060 XT" in torch.cuda.get_device_name(index)]
    if len(devices) != 1:
        raise RuntimeError("需要唯一的 RX 9060 XT。")
    device = torch.device("cuda", devices[0])
    initial = json.loads(arguments.initial.read_text(encoding="utf-8"))
    unified = initial["format"] == "naval-unified-v1"
    if unified:
        from unified_model import UnifiedNetwork, load_unified
        network = UnifiedNetwork(arguments.kind).to(device)
        load_unified(network, initial)
    else:
        network = MemoryNetwork(initial["globalSize"], arguments.kind).to(device)
    if initial["format"] == "naval-memory-v1":
        load_memory(network, initial)
    elif not unified:
        load_board(network.board, initial)
    network.eval()
    layout = {key: initial[key] for key in (("schema", "rulesId") if unified else ("schema", "rulesId", "boardSize", "channels", "globalSize"))}
    metadata = {**layout, "policyTrained": True,
                **({"validatedRules": initial["validatedRules"], "trainedShapes": initial["trainedShapes"]} if unified else {})}
    optimizer = torch.optim.AdamW(network.parameters(), lr=0.0003, weight_decay=0.0001, foreach=False)
    pool = []
    history = []
    previous_iterations = 0
    if arguments.resume:
        checkpoint = torch.load(arguments.resume, map_location=device, weights_only=True)
        if checkpoint["kind"] != arguments.kind or checkpoint["layout"] != layout or checkpoint["seed"] != arguments.seed:
            raise ValueError("PPO 检查点的结构或规则不一致。")
        network.load_state_dict(checkpoint["network"])
        optimizer.load_state_dict(checkpoint["optimizer"])
        generator.bit_generator.state = checkpoint["numpy_rng"]
        torch.set_rng_state(checkpoint["torch_rng"].cpu())
        torch.cuda.set_rng_state_all([state.cpu() for state in checkpoint["cuda_rng"]])
        history = checkpoint["history"]
        previous_iterations = checkpoint["iteration"]
        for weights in checkpoint["pool"]:
            frozen = copy.deepcopy(network).eval()
            frozen.load_state_dict(weights)
            for parameter in frozen.parameters():
                parameter.requires_grad_(False)
            pool.append(frozen)
    (arguments.output / "initial-model.json").write_text(json.dumps(network.export(metadata)), encoding="utf-8")
    environment = Environment("unified" if unified else "legacy")
    source = hashlib.sha256()
    source_root = Path(__file__).resolve().parents[2]
    filenames = sorted((source_root / "src").rglob("*.js")) + sorted(Path(__file__).parent.glob("*.py")) + sorted(Path(__file__).parent.glob("*.mjs")) + sorted((source_root / "tools/sim").glob("*.mjs"))
    for filename in filenames:
        source.update(filename.relative_to(source_root).as_posix().encode())
        source.update(filename.read_bytes())
    started = time.perf_counter()
    try:
        for iteration in range(previous_iterations, previous_iterations + arguments.iterations):
            records, outcomes = collect(environment, network, pool, arguments.games, arguments.seed + iteration * 7919,
                                        arguments.max_plies, device, generator, layout)
            statistics = update(network, optimizer, records, device, generator, arguments.epochs, arguments.minibatch)
            summary = {"iteration": iteration + 1, "records": len(records), **statistics,
                       "wins": sum(result["winner"] == result["learnerSeat"] for result in outcomes),
                       "truncated": sum(result["truncated"] for result in outcomes), "games": len(outcomes),
                       "opponents": opponent_statistics(outcomes),
                       "mean_plies": float(np.mean([result["plies"] for result in outcomes]))}
            history.append(summary)
            metadata["training"] = {"algorithm": "PPO-clip", "gamma": 1, "advantage": "Monte-Carlo return minus frozen value",
                                    "reward": "terminal win=1 draw=0.5 loss=0; time-limit bootstraps own value",
                                    "initial_sha256": hashlib.sha256(arguments.initial.read_bytes()).hexdigest(),
                                    "source_sha256": source.hexdigest(), "torch": str(torch.__version__), "device": str(device),
                                    "learning_rate": 0.0003, "clip": 0.2, "target_kl": 0.03, "entropy_coefficient": 0.01,
                                    "arguments": {key: str(value) if isinstance(value, Path) else value for key, value in vars(arguments).items()},
                                    "seconds": time.perf_counter() - started, "history": history}
            filename = arguments.output / f"iteration-{iteration + 1:03d}.json"
            filename.write_text(json.dumps(network.export(metadata)), encoding="utf-8")
            (arguments.output / "metrics.json").write_text(json.dumps(metadata["training"], indent=2), encoding="utf-8")
            (arguments.output / f"outcomes-{iteration + 1:03d}.json").write_text(json.dumps(outcomes), encoding="utf-8")
            if (iteration + 1) % 2 == 0:
                frozen = copy.deepcopy(network).eval()
                for parameter in frozen.parameters():
                    parameter.requires_grad_(False)
                pool.append(frozen)
                if len(pool) > 4:
                    pool.pop(0)
            torch.save({"network": network.state_dict(), "optimizer": optimizer.state_dict(), "kind": arguments.kind,
                        "layout": layout, "seed": arguments.seed, "iteration": iteration + 1, "history": history, "numpy_rng": generator.bit_generator.state,
                        "torch_rng": torch.get_rng_state(), "cuda_rng": torch.cuda.get_rng_state_all(),
                        "pool": [opponent.state_dict() for opponent in pool]}, arguments.output / f"checkpoint-{iteration + 1:03d}.pt")
            print(json.dumps(summary), flush=True)
        parity(network, records, metadata, arguments.output / "parity.json", device)
    finally:
        environment.close()


if __name__ == "__main__":
    main()
