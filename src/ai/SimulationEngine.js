/**
 * 模拟对战引擎 - 纯数据层实现
 *
 * 与线上战斗共用同一套结算器与学说，不经过 DOM：
 * - AP 伤害、防御减伤与连续穿甲
 * - HE / 火箭的形状、中心伤害与防空弱点
 * - 声呐中心显形 / 最近接触
 * - 沉船标记与最后一舰追击阶段
 *
 * AI 决策仍走 AIDecisionEngine，双方各自持有独立引擎实例。
 */

import { BOARD_SIZE } from '../config/constants.js';
import { SHIP_TYPES } from '../data/ships.js';
import { deployShips } from './aiDeployment.js';
import { AIDecisionEngine } from './aiStrategy.js';
import { getAITuning } from './aiTuning.js';
import { publicDecisionEvent } from './neuralHistory.js';
import { isValidActionTarget, recordSonarEvidence, recordContactEvidence } from '../game/battle/ActionRules.js';
import { checkAIAbilities } from './aiCore.js';
import { DIFFICULTY_SETTINGS } from '../data/difficulties.js';
import { VIEW_STATE } from '../game/battle/ViewState.js';
import { EventType } from '../game/weapons/WeaponTypes.js';
import { resolveHit } from '../game/battle/HitResolver.js';
import { resolveSonar } from '../game/battle/SonarResolver.js';
import { advancePursuit } from '../game/battle/PursuitResolver.js';
import {
    getAPDamage,
    getAPMaxPenetrations,
    applyAPDefense,
    getHEProfile,
    getHEOffsets,
    applyHEDefense
} from '../data/doctrines.js';

const MAX_PLIES = 400;
const OTHER_SEAT = { A: 'B', B: 'A' };

function normalizeConfig(config = {}, defaultLevel = 'HARD') {
    const level = config.level || defaultLevel;
    const base = DIFFICULTY_SETTINGS[level] || DIFFICULTY_SETTINGS.HARD;
    return {
        faction: config.faction || 'us',
        level,
        alpha: config.alpha ?? base.alpha,
        randomness: config.randomness ?? base.randomness,
        riskAwareness: config.riskAwareness ?? base.riskAwareness,
        neutralBias: !!config.neutralBias,
        tuning: config.tuning || getAITuning(level)
    };
}

function createShips(placements) {
    return placements.map((p, id) => ({
        id,
        name: p.name,
        code: p.code,
        len: p.len,
        maxHp: p.maxHp,
        hp: Array(p.len).fill(p.maxHp),
        r: p.r,
        c: p.c,
        v: p.v ?? p.vertical ?? false,
        vertical: p.v ?? p.vertical ?? false,
        sunk: false
    }));
}

function buildGrid(ships) {
    const grid = Array.from({ length: BOARD_SIZE }, () =>
        Array.from({ length: BOARD_SIZE }, () => ({ hit: false, shipId: -1, segmentIndex: -1 })));
    for (const ship of ships) {
        for (let i = 0; i < ship.len; i++) {
            const r = ship.vertical ? ship.r + i : ship.r;
            const c = ship.vertical ? ship.c : ship.c + i;
            grid[r][c] = { hit: false, shipId: ship.id, segmentIndex: i };
        }
    }
    return grid;
}

function createView() {
    return Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(VIEW_STATE.UNKNOWN));
}

function segmentCell(ship, index) {
    return {
        r: ship.vertical ? ship.r + index : ship.r,
        c: ship.vertical ? ship.c : ship.c + index
    };
}

function sanitizeTargets(ships) {
    return ships.map(s => ({ id: s.id, code: s.code, len: s.len, maxHp: s.maxHp, sunk: s.sunk }));
}

function describeOwnShips(ships) {
    return ships.map(s => ({
        id: s.id,
        code: s.code,
        name: s.name,
        len: s.len,
        maxHp: s.maxHp,
        hp: [...s.hp],
        sunk: s.sunk,
        r: s.r,
        c: s.c,
        vertical: s.vertical
    }));
}

function applyEventsToView(events, view) {
    for (const event of events) {
        if (event.type !== EventType.CELL_UPDATE) continue;
        const { r, c, state } = event.payload;
        if (state === 'MISS') view[r][c] = VIEW_STATE.MISS;
        else if (state === 'HIT' || state === 'CONTACT') view[r][c] = VIEW_STATE.HIT;
        else if (state === 'DESTROYED') view[r][c] = VIEW_STATE.DESTROYED;
        else if (state === 'SUSPECT') view[r][c] = VIEW_STATE.SUSPECT;
    }
}

function markShipSunk(view, ship) {
    for (let i = 0; i < ship.len; i++) {
        const { r, c } = segmentCell(ship, i);
        view[r][c] = VIEW_STATE.SUNK;
    }
}

/** 与 game.js countShots 同口径：每个非传导 CELL_UPDATE 记一次射击 */
function countShots(events) {
    let shots = 0;
    let hits = 0;
    for (const event of events) {
        if (event.type !== EventType.CELL_UPDATE || event.payload.secondary) continue;
        const state = event.payload.state;
        if (state === 'HIT' || state === 'DESTROYED' || state === 'MISS') {
            shots++;
            if (state !== 'MISS') hits++;
        }
    }
    return { shots, hits };
}

export class SimulationEngine {
    /**
     * @param {Object|string} configA - A 方配置 { faction, level, alpha, randomness, riskAwareness, tuning }
     * @param {Object|string} configB - B 方配置
     * @param {Object} [options]
     * @param {number} [options.maxPlies=400]
     * @param {'A'|'B'} [options.firstSeat='A']
     * @param {Array} [options.fleetA] - 固定舰队放置（用于配对模拟）
     * @param {Array} [options.fleetB]
     * @param {boolean} [options.enablePursuit=true]
     * @param {boolean} [options.recordHistory=false]
     */
    constructor(configA, configB, options = {}) {
        this.configA = normalizeConfig(typeof configA === 'string' ? { level: configA } : configA);
        this.configB = normalizeConfig(typeof configB === 'string' ? { level: configB } : configB);
        this.fleetA = options.fleetA || null;
        this.fleetB = options.fleetB || null;
        this.maxPlies = options.maxPlies ?? MAX_PLIES;
        this.firstSeat = options.firstSeat === 'B' ? 'B' : 'A';
        this.enablePursuit = options.enablePursuit !== false;
        this.recordHistory = !!options.recordHistory;
        this.recordPublicHistory = !!options.recordPublicHistory;
        this.verbose = !!options.verbose;
        this.reset();
    }

    reset() {
        this.sides = {
            A: this._createSide(this.configA, this.fleetA),
            B: this._createSide(this.configB, this.fleetB)
        };
        this.plies = 0;
        this.winner = null;
        this.currentSeat = this.firstSeat;
        this.history = [];
        this.publicHistory = [];
        this.terminationReason = null;
        this.tail = null;
        this.finished = false;
    }

    _createSide(config, fleet) {
        const ships = createShips(fleet || deployShips(SHIP_TYPES));
        return {
            config,
            faction: config.faction,
            ships,
            grid: buildGrid(ships),
            view: createView(),
            sonarEvidence: [],
            engine: new AIDecisionEngine(),
            hunt: { turns: 0, first: true, areaContact: null },
            oneLeftPly: null,
            stats: {
                shots: 0,
                hits: 0,
                damage: 0,
                pings: 0,
                pursuitContacts: 0,
                weapons: { AP: 0, HE: 0, SONAR: 0 },
                damageByWeapon: { AP: 0, HE: 0 }
            }
        };
    }

    _decisionConfig(side) {
        const { alpha, randomness, riskAwareness, neutralBias, level, tuning } = side.config;
        return { alpha, randomness, riskAwareness, neutralBias, level, tuning };
    }

    _decisionContext(attacker, defender) {
        const alive = defender.ships.filter(s => !s.sunk);
        let areaContact = null;
        if (alive.length === 1 && attacker.hunt.areaContact) {
            const zone = attacker.hunt.areaContact;
            if (zone.shipId == null || zone.shipId === alive[0].id) areaContact = zone;
        }
        return {
            viewGrid: attacker.view,
            myShips: sanitizeTargets(defender.ships),
            enemyShips: describeOwnShips(attacker.ships),
            difficultyConfig: this._decisionConfig(attacker),
            playerViewGrid: defender.view,
            sonarEvidence: attacker.sonarEvidence,
            ...(this.recordPublicHistory ? { publicEvents: this.publicHistory, decisionSeat: attacker === this.sides.A ? 'A' : 'B' } : {}),
            areaContact,
            pursuit: { enabled: this.enablePursuit, hunters: [{ ...attacker.hunt }, { ...defender.hunt }] },
            aiFaction: attacker.faction,
            playerFaction: defender.faction
        };
    }

    _abilities(side, opponent) {
        return checkAIAbilities(side.ships, side.faction, opponent.faction, {
            sunkEnemyShips: opponent.ships.filter(s => s.sunk).length,
            neutralBias: side.config.neutralBias
        });
    }

    /**
     * 执行一个回合；返回该回合的行动记录
     */
    step() {
        if (this.finished) return null;
        if (this.plies >= this.maxPlies) {
            this._finish(null, 'time-limit');
            return null;
        }

        const seat = this.currentSeat;
        const attacker = this.sides[seat];
        const defender = this.sides[OTHER_SEAT[seat]];

        const decision = attacker.engine.decide(this._decisionContext(attacker, defender));
        const abilities = this._abilities(attacker, defender);
        if (!isValidActionTarget(decision, attacker.view, abilities, attacker.sonarEvidence)) throw new Error('行动无效：目标没有可更新的海域或武器不可用');
        const before = this.recordPublicHistory ? attacker.view.map(row => [...row]) : null;
        this.plies++;
        const action = this._executeAction(attacker, defender, decision, abilities);

        if (before) this.publicHistory.push(publicDecisionEvent(seat, this.plies, action, abilities, before, attacker.view));

        if (this.recordHistory) {
            this.history.push({ ply: this.plies, seat, action });
        }

        if (defender.ships.every(s => s.sunk)) {
            this._finish(seat);
            return action;
        }

        if (this.enablePursuit) this._tickPursuit(attacker, defender);

        this.currentSeat = OTHER_SEAT[seat];
        return action;
    }

    run() {
        while (!this.finished) this.step();
        return this.getResult();
    }

    getResult() {
        return {
            winner: this.winner || 'DRAW',
            terminated: this.finished && this.terminationReason !== 'time-limit',
            truncated: this.finished && this.terminationReason === 'time-limit',
            plies: this.plies,
            firstSeat: this.firstSeat,
            A: this._sideResult(this.sides.A),
            B: this._sideResult(this.sides.B),
            tail: this.tail
        };
    }

    _sideResult(side) {
        return {
            faction: side.faction,
            level: side.config.level,
            alpha: side.config.alpha,
            riskAwareness: side.config.riskAwareness,
            ships: side.ships,
            stats: side.stats,
            oneLeftPly: side.oneLeftPly
        };
    }

    _finish(winner, reason = winner ? 'fleet-destroyed' : 'draw') {
        this.winner = winner;
        this.terminationReason = reason;
        this.finished = true;
        if (!winner) return;

        const loserSeat = OTHER_SEAT[winner];
        const loser = this.sides[loserSeat];
        const winnerSide = this.sides[winner];
        if (loser.oneLeftPly !== null) {
            const ref = loser.oneLeftPly;
            this.tail = {
                plies: this.plies - ref.ply,
                reference: ref.stats
            };
        }
    }

    _executeAction(attacker, defender, action, abilities) {
        if (!isValidActionTarget(action, attacker.view, abilities, attacker.sonarEvidence)) throw new Error('行动无效：目标没有可更新的海域或武器不可用');
        const { weapon, r, c } = action;
        attacker.stats.weapons[weapon] = (attacker.stats.weapons[weapon] || 0) + 1;

        if (weapon === 'SONAR') {
            this._executeSonar(attacker, defender, r, c, abilities);
        } else if (weapon === 'HE') {
            this._executeHE(attacker, defender, r, c, abilities);
        } else {
            this._executeAP(attacker, defender, r, c, abilities);
        }

        // 与 getAiViewGrid 一致：沉船的全部舱室在对手认知中视为不可穿越
        for (const ship of defender.ships) {
            if (ship.sunk) markShipSunk(attacker.view, ship);
        }

        if (defender.oneLeftPly === null && defender.ships.filter(s => !s.sunk).length === 1) {
            defender.oneLeftPly = { ply: this.plies, stats: this._snapshotStats(attacker.stats) };
        }
        return { weapon, r, c };
    }

    _snapshotStats(stats) {
        return {
            shots: stats.shots,
            hits: stats.hits,
            damage: stats.damage,
            pings: stats.pings,
            pursuitContacts: stats.pursuitContacts,
            weapons: { ...stats.weapons },
            damageByWeapon: { ...stats.damageByWeapon }
        };
    }

    _executeAP(attacker, defender, r, c, abilities) {
        const targetSuspect = attacker.view[r][c] === VIEW_STATE.SUSPECT;
        const sunkEnemyShips = defender.ships.filter(s => s.sunk).length;
        let damage = getAPDamage(attacker.faction, attacker.ships, { targetSuspect, sunkEnemyShips });
        damage = applyAPDefense(defender.faction, damage);
        const maxPenetrations = getAPMaxPenetrations(attacker.faction, attacker.ships);

        const result = resolveHit(r, c, damage, defender.grid, defender.ships, false, {
            penetrate: true,
            maxPenetrations
        });
        const counted = countShots(result.events);
        attacker.stats.shots += counted.shots;
        attacker.stats.hits += counted.hits;
        applyEventsToView(result.events, attacker.view);
        if (result.dealt > 0) {
            attacker.stats.damage += result.dealt;
            attacker.stats.damageByWeapon.AP += result.dealt;
        }
        return result.events;
    }

    _executeHE(attacker, defender, r, c, abilities) {
        const profile = getHEProfile(attacker.faction, attacker.ships);
        const offsets = getHEOffsets(profile.shape);
        const events = [];

        for (const [dr, dc] of offsets) {
            const nr = r + dr;
            const nc = c + dc;
            if (nr < 0 || nr >= BOARD_SIZE || nc < 0 || nc >= BOARD_SIZE) continue;

            const gridCell = defender.grid[nr][nc];
            if (gridCell.hit && gridCell.shipId === -1) continue;
            if (gridCell.hit && gridCell.shipId !== -1) {
                const ship = defender.ships[gridCell.shipId];
                if (ship.hp[gridCell.segmentIndex] <= 0) continue;
            }

            const isCenter = dr === 0 && dc === 0;
            const baseDamage = isCenter ? profile.centerDamage : profile.outerDamage;
            const cellDamage = isCenter ? applyHEDefense(defender.faction, baseDamage) : baseDamage;
            const result = resolveHit(
                nr, nc, cellDamage,
                defender.grid, defender.ships, false,
                isCenter && profile.centerPenetrates ? { penetrate: true } : undefined
            );
            events.push(...result.events);
            if (result.dealt > 0) {
                attacker.stats.damage += result.dealt;
                attacker.stats.damageByWeapon.HE += result.dealt;
            }
        }

        const counted = countShots(events);
        attacker.stats.shots += counted.shots;
        attacker.stats.hits += counted.hits;
        applyEventsToView(events, attacker.view);
        return events;
    }

    _executeSonar(attacker, defender, r, c, abilities) {
        const result = resolveSonar(
            r, c,
            defender.grid, defender.ships, false,
            abilities.sonarRadius ?? 1,
            abilities.sonarReveal || 'center'
        );
        applyEventsToView(result.events, attacker.view);
        recordSonarEvidence(attacker.sonarEvidence, result.events);
        attacker.stats.pings++;
    }

    _tickPursuit(hunter, target) {
        const view = hunter.view.flat();
        const contact = advancePursuit(hunter.hunt, target.ships, view);
        if (!contact) return;
        recordContactEvidence(hunter.sonarEvidence, contact.cells.map(cell => cell.r * BOARD_SIZE + cell.c)
            .filter(cell => view[cell] === VIEW_STATE.SUSPECT));
        for (let row = 0; row < BOARD_SIZE; row++) {
            for (let col = 0; col < BOARD_SIZE; col++) hunter.view[row][col] = view[row * BOARD_SIZE + col];
        }
        hunter.stats.pursuitContacts++;
    }
}

export function runSimulatedGame(configA, configB, options = {}) {
    return new SimulationEngine(configA, configB, options).run();
}

export function runSimulationBatch(configA, configB, count, options = {}) {
    let winsA = 0, winsB = 0, draws = 0, totalPlies = 0;
    for (let i = 0; i < count; i++) {
        const result = runSimulatedGame(configA, configB, options);
        if (result.winner === 'A') winsA++;
        else if (result.winner === 'B') winsB++;
        else draws++;
        totalPlies += result.plies;
    }
    return {
        winsA,
        winsB,
        draws,
        avgPlies: totalPlies / count,
        avgTurns: totalPlies / count,
        winRateA: winsA / count
    };
}

export async function runSimulatedGameWithProgress(configA, configB, options = {}) {
    const { onTurn, yieldInterval = 10 } = options;
    const engine = new SimulationEngine(configA, configB, options);
    while (!engine.finished) {
        const action = engine.step();
        if (onTurn && action) onTurn(engine.plies);
        if (engine.plies % yieldInterval === 0) {
            await new Promise(resolve => {
                if (typeof requestAnimationFrame !== 'undefined') requestAnimationFrame(() => setTimeout(resolve, 0));
                else setTimeout(resolve, 0);
            });
        }
    }
    return engine.getResult();
}
