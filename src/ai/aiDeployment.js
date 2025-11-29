/**
 * AI 部署模块 - 负责 AI 船只的智能摆放
 * 
 * 设计目标：使船只分布尽量均匀/稀疏，同时保持足够的随机性
 * 
 * ============================================================================
 * 导出接口（公开 API）
 * ============================================================================
 * 
 * - deployShips(shipTypes, boardSize): 生成船只配置
 *   - shipTypes: 船只类型数组 [{ name, len, maxHp, code, type }, ...]
 *   - boardSize: 棋盘大小
 *   - 返回值: 船只放置结果数组 [{ r, c, v, ...shipType }, ...]
 * 
 * ============================================================================
 * 策略说明
 * ============================================================================
 * 
 * 「随机稀疏策略」：
 * 1. 随机打乱船只放置顺序（不固定大船先放）
 * 2. 设定最小间距阈值，筛选出所有满足间距要求的合法位置
 * 3. 从满足条件的位置中完全随机选择
 * 4. 如果没有满足间距的位置，逐步降低间距要求
 */

import { BOARD_SIZE } from '../config/constants.js';

/** 理想最小间距（船只中心点之间） */
const IDEAL_MIN_DISTANCE = 5.0;

/** 最小可接受间距 */
const MIN_ACCEPTABLE_DISTANCE = 1.5;

/**
 * AI 部署船只
 * 
 * @param {Array} shipTypes - 船只类型定义数组
 * @param {number} boardSize - 棋盘大小（默认使用常量）
 * @returns {Array} 船只放置结果，包含位置和方向信息
 */
export function deployShips(shipTypes, boardSize = BOARD_SIZE) {
    const placements = [];
    const occupiedGrid = createEmptyGrid(boardSize);
    
    // 随机打乱船只顺序，增加不可预测性
    const shuffledTypes = shuffleArray([...shipTypes]);
    
    for (const shipType of shuffledTypes) {
        const placement = findRandomSparsePlacement(shipType, occupiedGrid, placements, boardSize);
        
        if (placement) {
            // 标记占用格子
            markOccupied(occupiedGrid, placement.r, placement.c, shipType.len, placement.v);
            placements.push({
                ...shipType,
                r: placement.r,
                c: placement.c,
                v: placement.v
            });
        } else {
            console.error("AI 部署失败：无法放置船只", shipType.name);
        }
    }
    
    return placements;
}

/**
 * Fisher-Yates 洗牌算法
 */
function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

/**
 * 创建空网格
 */
function createEmptyGrid(size) {
    return Array(size).fill(0).map(() => Array(size).fill(0));
}

/**
 * 标记格子为已占用
 */
function markOccupied(grid, r, c, len, vertical) {
    for (let i = 0; i < len; i++) {
        const nr = vertical ? r + i : r;
        const nc = vertical ? c : c + i;
        grid[nr][nc] = 1;
    }
}

/**
 * 寻找随机的稀疏放置位置
 * 
 * 策略：
 * 1. 收集所有合法位置
 * 2. 筛选出满足最小间距要求的位置
 * 3. 从中随机选择一个
 * 4. 如果没有满足间距的位置，逐步降低要求
 */
function findRandomSparsePlacement(shipType, occupiedGrid, existingPlacements, boardSize) {
    // 收集所有合法位置及其与已有船只的最小距离
    const allCandidates = [];
    
    for (let vertical = 0; vertical <= 1; vertical++) {
        const isVertical = vertical === 1;
        const maxR = isVertical ? boardSize - shipType.len : boardSize - 1;
        const maxC = isVertical ? boardSize - 1 : boardSize - shipType.len;
        
        for (let r = 0; r <= maxR; r++) {
            for (let c = 0; c <= maxC; c++) {
                if (isValidPlacement(occupiedGrid, r, c, shipType.len, isVertical, boardSize)) {
                    const minDist = calculateMinDistance(r, c, shipType.len, isVertical, existingPlacements);
                    allCandidates.push({ r, c, v: isVertical, minDist });
                }
            }
        }
    }
    
    if (allCandidates.length === 0) {
        return null;
    }
    
    // 如果是第一艘船，完全随机选择
    if (existingPlacements.length === 0) {
        return allCandidates[Math.floor(Math.random() * allCandidates.length)];
    }
    
    // 尝试不同的间距阈值，从理想间距逐步降低
    for (let threshold = IDEAL_MIN_DISTANCE; threshold >= MIN_ACCEPTABLE_DISTANCE; threshold -= 0.5) {
        const sparsePositions = allCandidates.filter(c => c.minDist >= threshold);
        if (sparsePositions.length > 0) {
            // 从满足间距的位置中随机选择
            return sparsePositions[Math.floor(Math.random() * sparsePositions.length)];
        }
    }
    
    // 如果都不满足最小间距，选择距离最大的几个中随机一个
    allCandidates.sort((a, b) => b.minDist - a.minDist);
    const topCount = Math.min(5, allCandidates.length);
    const topCandidates = allCandidates.slice(0, topCount);
    
    return topCandidates[Math.floor(Math.random() * topCandidates.length)];
}

/**
 * 检查放置是否合法
 */
function isValidPlacement(occupiedGrid, r, c, len, vertical, boardSize) {
    for (let i = 0; i < len; i++) {
        const nr = vertical ? r + i : r;
        const nc = vertical ? c : c + i;
        
        // 边界检查
        if (nr >= boardSize || nc >= boardSize) {
            return false;
        }
        
        // 重叠检查
        if (occupiedGrid[nr][nc] === 1) {
            return false;
        }
    }
    return true;
}

/**
 * 计算到已有船只的最小距离
 * 
 * 使用船只格子之间的最小距离（而非中心点距离）
 * 这样更准确地反映船只是否"挨在一起"
 */
function calculateMinDistance(r, c, len, vertical, existingPlacements) {
    if (existingPlacements.length === 0) {
        return Infinity;
    }
    
    let minDist = Infinity;
    
    // 获取当前船只的所有格子
    const myCells = [];
    for (let i = 0; i < len; i++) {
        myCells.push({
            r: vertical ? r + i : r,
            c: vertical ? c : c + i
        });
    }
    
    // 计算与每艘已放置船只的最小格子距离
    for (const ship of existingPlacements) {
        for (let i = 0; i < ship.len; i++) {
            const shipR = ship.v ? ship.r + i : ship.r;
            const shipC = ship.v ? ship.c : ship.c + i;
            
            for (const cell of myCells) {
                const dist = Math.sqrt(
                    Math.pow(cell.r - shipR, 2) + 
                    Math.pow(cell.c - shipC, 2)
                );
                minDist = Math.min(minDist, dist);
            }
        }
    }
    
    return minDist;
}
