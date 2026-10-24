import assert from 'node:assert/strict';
import { resolveHit } from '../../src/game/battle/HitResolver.js';
import { isValidActionTarget, BATTLE_RULES_VERSION } from '../../src/game/battle/ActionRules.js';
import { VIEW_STATE } from '../../src/game/battle/ViewState.js';
import { WeaponService } from '../../src/game/weapons/WeaponService.js';
import { WeaponRegistry } from '../../src/game/weapons/WeaponRegistry.js';
import { SimulationEngine } from '../../src/ai/SimulationEngine.js';
import { checkAIAbilities, enumerateAllActions } from '../../src/ai/aiCore.js';
import { neuralRulesId } from '../../src/ai/neuralRules.js';
import { NavalNeuralNetwork } from '../../src/ai/neuralNetwork.js';
import { validateAction, serializeEngine, reviveEngine } from '../agent-arena/arena.mjs';
import { createRoom, submit } from '../agent-arena/room.mjs';
import { FACTIONS, mulberry32 } from './core.mjs';

Math.random = mulberry32(641236);
globalThis.localStorage = { getItem() { return '0'; } };
const { APWeapon } = await import('../../src/game/weapons/APWeapon.js');
const { HEWeapon } = await import('../../src/game/weapons/HEWeapon.js');
const { SonarWeapon } = await import('../../src/game/weapons/SonarWeapon.js');
function physicalBoard(hp, vertical = false) {
    const ship = { id: 0, name: '验证舰', code: 'BB', r: 4, c: 4, vertical, len: hp.length, maxHp: 3, hp: [...hp], sunk: false };
    const grid = Array.from({ length: 11 }, () => Array.from({ length: 11 }, () => ({ hit: false, shipId: -1, segmentIndex: -1 })));
    for (let segment = 0; segment < hp.length; segment++) {
        grid[4 + (vertical ? segment : 0)][4 + (vertical ? 0 : segment)] = { hit: hp[segment] === 0, shipId: 0, segmentIndex: segment };
    }
    return { ship, grid };
}
for (const vertical of [false, true]) {
    for (const emitEvents of [false, true]) {
        for (const [hp, segment, damage, limit, expected] of [
            [[1, 0, 1], 0, 3, 2, [0, 0, 1]],
            [[1, 0, 1], 2, 3, 2, [1, 0, 0]],
            [[1, 1, 0, 1], 1, 5, 3, [0, 0, 0, 1]],
            [[1, 0, 1, 1], 2, 5, 3, [1, 0, 0, 0]],
            [[1, 1, 1, 1], 0, 4, 3, [0, 0, 0, 0]],
            [[1, 1, 1, 1], 0, 4, 1, [0, 0, 1, 1]],
            [[3, 1, 3], 1, 2, 2, [3, 0, 2]]
        ]) {
            const state = physicalBoard(hp, vertical);
            const result = resolveHit(4 + (vertical ? segment : 0), 4 + (vertical ? 0 : segment), damage,
                state.grid, [state.ship], false, { penetrate: true, maxPenetrations: limit, emitEvents });
            assert.deepEqual(state.ship.hp, expected, '损毁舱室须阻断该方向，新毁舱室仍可在本弹内继续传导');
            assert.ok(result.penetrated <= limit);
            assert.equal(result.dealt, hp.reduce((sum, value) => sum + value, 0) - expected.reduce((sum, value) => sum + value, 0));
        }
    }
}
const weapons = [new APWeapon(), new HEWeapon(), new SonarWeapon()];
const registry = new WeaponRegistry();
for (const weapon of weapons) registry.register(weapon);
let renders = 0;
const service = new WeaponService(registry, { render() { renders++; } });
for (const faction of FACTIONS) {
    const game = new SimulationEngine({ faction }, { faction: 'us' });
    const own = game.sides.A;
    const target = game.sides.B;
    const abilities = checkAIAbilities(own.ships, faction, 'us');
    const view = Array.from({ length: 11 }, (_, row) => Array.from({ length: 11 }, (_, col) => (row * 11 + col) % 6));
    const context = { attackerShips: own.ships, attackerFaction: faction, defenderFaction: 'us', attackerViewGrid: view,
        get defenderGrid() { throw new Error('合法性校验读取了隐藏棋盘'); },
        get defenderShips() { throw new Error('合法性校验读取了隐藏舰队'); } };
    own.view = view;
    Object.defineProperty(target, 'grid', { get() { throw new Error('房间合法性校验读取了隐藏棋盘'); } });
    const actions = new Set(enumerateAllActions(view, abilities).map(action => `${action.weapon}|${action.r}|${action.c}`));
    for (let row = 0; row < 11; row++) {
        for (let col = 0; col < 11; col++) {
            for (const weapon of weapons) {
                const action = { weapon: weapon.id, r: row, c: col };
                const expected = isValidActionTarget(action, view, abilities);
                assert.equal(weapon.isValidTarget(action, context), expected, '实机目标校验与共享规则不一致');
                assert.equal(actions.has(`${action.weapon}|${row}|${col}`), expected, 'AI 行动枚举与共享规则不一致');
                assert.equal(validateAction(game, { playerSeat: 'A', enemySeat: 'B' }, weapon.id, row, col) === null, expected,
                    '房间目标校验与共享规则不一致');
            }
        }
    }
}
const game = new SimulationEngine({ faction: 'sn' }, { faction: 'us' }, { recordPublicHistory: true, recordHistory: true });
const own = game.sides.A;
const target = game.sides.B;
own.view = Array.from({ length: 11 }, () => Array(11).fill(VIEW_STATE.MISS));
for (const weapon of weapons) {
    const action = { weapon: weapon.id, r: 5, c: 5 };
    own.engine.decide = () => action;
    const before = JSON.stringify(game);
    assert.throws(() => game.step(), /行动无效/);
    assert.equal(JSON.stringify(game), before, '拒绝无效行动不能消耗回合、改写历史或统计');
    assert.throws(() => game._executeAction(own, target, action, game._abilities(own, target)), /行动无效/);
    assert.equal(JSON.stringify(game), before);
    service.setCurrentWeapon(weapon.id);
    const result = service.executePlayerAction(action, { attackerShips: own.ships, attackerFaction: 'sn', attackerViewGrid: own.view,
        get defenderGrid() { throw new Error('拒绝无效操作前读取了隐藏棋盘'); } });
    assert.equal(result.success, false);
}
assert.equal(renders, 0, '无效行动不能播放效果');
for (const residualContact of [false, true]) {
    const probe = new SimulationEngine({ faction: 'us' }, { faction: 'us' }, {
        fleetB: [{ code: 'SS', name: '已接触舰', len: 1, maxHp: 2, r: 6, c: 5 },
            { code: 'DD', name: '未暴露舰', len: 1, maxHp: 1, r: residualContact ? 4 : 0, c: residualContact ? 4 : 0 }],
        enablePursuit: false, recordPublicHistory: true
    });
    const attacker = probe.sides.A;
    const defender = probe.sides.B;
    defender.ships[0].hp[0] = 1;
    defender.grid[6][5].hit = true;
    defender.grid[5][5].hit = true;
    for (let row = 4; row <= 6; row++) for (let col = 4; col <= 6; col++) attacker.view[row][col] = VIEW_STATE.SUSPECT;
    attacker.view[5][5] = VIEW_STATE.MISS;
    attacker.view[6][5] = VIEW_STATE.HIT;
    const scan = { weapon: 'SONAR', r: 5, c: 5 };
    const before = JSON.stringify(attacker.view);
    attacker.engine.decide = () => scan;
    probe.step();
    assert.equal(probe.plies, 1, '效果取决于隐藏信息的水听，无论结果如何都应消耗回合');
    assert.equal(probe.currentSeat, 'B');
    assert.equal(attacker.stats.pings, 1);
    assert.equal(probe.publicHistory.length, 1);
    assert.equal(JSON.stringify(attacker.view) === before, residualContact);
    assert.equal(attacker.sonarEvidence.length, residualContact ? 1 : 0);
    const restored = reviveEngine(serializeEngine(probe));
    assert.deepEqual(restored.sides.A.sonarEvidence, attacker.sonarEvidence, '恢复房间须保留公开扫描证据');
    if (residualContact) {
        probe.currentSeat = 'A';
        const unchanged = JSON.stringify(probe);
        assert.throws(() => probe.step(), /行动无效/);
        assert.equal(JSON.stringify(probe), unchanged, '已有证据足以确定无效的重复扫描须拒绝且不消耗回合');
        assert.equal(isValidActionTarget(scan, attacker.view, probe._abilities(attacker, defender), []), true,
            '相同可见格子但缺少前次观测证据时，不能借真实布局拒绝扫描');
        assert.equal(enumerateAllActions(attacker.view, probe._abilities(attacker, defender), attacker.sonarEvidence)
            .some(action => action.weapon === 'SONAR' && action.r === 5 && action.c === 5), false);
        const { room } = createRoom({ id: `rules-${process.pid}-${Date.now()}`, seed: 641236,
            seats: { A: { faction: 'us', controller: 'human' }, B: { faction: 'us', controller: 'human' } } });
        room.engine = serializeEngine(probe);
        const roomBefore = JSON.stringify(room);
        assert.throws(() => submit(room, { type: 'action', roomId: room.id, seat: 'A', version: room.version, weapon: 'SONAR', r: 6, c: 6 }), /没有可更新/);
        assert.equal(JSON.stringify(room), roomBefore, '被拒绝的房间操作不能递增版本或日志');
        attacker.engine.decide = () => ({ weapon: 'AP', r: 4, c: 4 });
        probe.step();
        assert.equal(isValidActionTarget(scan, attacker.view, probe._abilities(attacker, defender), attacker.sonarEvidence), true,
            '区域内出现新命中后，应允许重新判断残余信号');
        assert.equal(isValidActionTarget(scan, attacker.view, { ...probe._abilities(attacker, defender), sonarReveal: 'nearest' }), true);
    }
}
const contactProbe = new SimulationEngine({ faction: 'us' }, { faction: 'us' }, {
    fleetB: [{ code: 'SS', len: 1, maxHp: 2, r: 5, c: 5 }, { code: 'DD', len: 1, maxHp: 1, r: 0, c: 0 }], enablePursuit: false
});
contactProbe.sides.A.engine.decide = () => ({ weapon: 'SONAR', r: 5, c: 5 });
contactProbe.step();
assert.deepEqual(contactProbe.sides.A.sonarEvidence, [], '本次信号可能仅来自新显形中心，不能断言外围仍有目标');
contactProbe.currentSeat = 'A';
contactProbe.step();
assert.equal(contactProbe.sides.A.view[4][4], VIEW_STATE.MISS, '中心显形后应允许再次扫描清除外围疑似');
own.view[5][6] = VIEW_STATE.UNKNOWN;
own.view[5][5] = VIEW_STATE.SUNK;
assert.equal(isValidActionTarget({ weapon: 'HE', r: 5, c: 5 }, own.view, game._abilities(own, target)), true,
    '中心虽已处理，范围内仍有潜在效果的空袭应保留');
own.view[5][6] = VIEW_STATE.HIT;
assert.equal(isValidActionTarget({ weapon: 'AP', r: 5, c: 6 }, own.view), true, '未毁舱室须能继续补刀');
assert.equal(isValidActionTarget({ weapon: 'AP', r: -1, c: 0 }, own.view), false);
assert.equal(isValidActionTarget({ weapon: 'AP', r: 0.5, c: 0 }, own.view), false);
assert.equal(isValidActionTarget({ weapon: 'UNKNOWN', r: 0, c: 0 }, own.view), false);
assert.ok(BATTLE_RULES_VERSION >= 2);
assert.notEqual(neuralRulesId(), '56fb56a3');
assert.throws(() => new NavalNeuralNetwork({ format: 'naval-network-v1', schema: 'naval-belief-v1', rulesId: '56fb56a3' }), /不兼容/,
    '旧规则权重不得被当作修复后已验收模型');
console.log(`RULES SELFTEST OK: ${neuralRulesId()}`);
