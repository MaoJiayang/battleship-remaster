// src/audio/sfx.js
// WebAudio 合成音效 - 零资源文件，全部程序化生成
// 依赖用户手势后才能创建 AudioContext（浏览器自动播放策略）

const STORAGE_KEY = 'sfxEnabled';

let ctx = null;
let master = null;
let enabled = localStorage.getItem(STORAGE_KEY) !== '0';

function ensureContext() {
    if (!ctx) {
        try {
            ctx = new (window.AudioContext || window.webkitAudioContext)();
            master = ctx.createGain();
            master.gain.value = 0.35;
            master.connect(ctx.destination);
        } catch (e) {
            return false;
        }
    }
    if (ctx.state === 'suspended') ctx.resume();
    return true;
}

function now() {
    return ctx.currentTime;
}

function noiseBuffer(duration) {
    const len = Math.floor(ctx.sampleRate * duration);
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) {
        data[i] = Math.random() * 2 - 1;
    }
    return buffer;
}

function envGain(peak, attack, decay, startAt) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, startAt);
    g.gain.exponentialRampToValueAtTime(peak, startAt + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, startAt + attack + decay);
    return g;
}

function playNoise(peak, attack, decay, filterType, filterFreq, startAt = 0) {
    const t = now() + startAt;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(attack + decay + 0.1);
    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.value = filterFreq;
    const g = envGain(peak, attack, decay, t);
    src.connect(filter).connect(g).connect(master);
    src.start(t);
    src.stop(t + attack + decay + 0.1);
}

function playTone(freq, peak, attack, decay, type = 'sine', startAt = 0, endFreq = null) {
    const t = now() + startAt;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (endFreq) {
        osc.frequency.exponentialRampToValueAtTime(endFreq, t + attack + decay);
    }
    const g = envGain(peak, attack, decay, t);
    osc.connect(g).connect(master);
    osc.start(t);
    osc.stop(t + attack + decay + 0.1);
}

const sounds = {
    // 主炮开火：低频炮膛闷响 + 高频爆破
    fire() {
        playTone(90, 0.8, 0.005, 0.25, 'sine', 0, 40);
        playNoise(0.5, 0.002, 0.15, 'highpass', 2000);
    },
    // 未命中：入水声
    splash() {
        playNoise(0.35, 0.01, 0.3, 'lowpass', 900);
        playTone(300, 0.15, 0.01, 0.2, 'sine', 0, 120);
    },
    // 命中：爆裂声
    hit() {
        playNoise(0.55, 0.002, 0.35, 'bandpass', 500);
        playTone(160, 0.5, 0.003, 0.3, 'square', 0, 60);
        playNoise(0.3, 0.02, 0.4, 'lowpass', 400, 0.05);
    },
    // 沉没：长低鸣 + 气泡
    sunk() {
        playTone(70, 0.9, 0.01, 1.4, 'sine', 0, 30);
        playNoise(0.4, 0.05, 1.0, 'lowpass', 600);
        playNoise(0.25, 0.1, 0.8, 'bandpass', 1500, 0.2);
    },
    // 声呐 ping
    sonar() {
        playTone(1250, 0.4, 0.005, 0.6, 'sine', 0, 880);
        playTone(625, 0.15, 0.005, 0.5, 'sine', 0.02, 440);
    },
    // 空袭：飞机掠过 (引擎渐强渐弱)
    plane() {
        playTone(95, 0.25, 0.3, 0.9, 'sawtooth', 0, 130);
        playTone(190, 0.12, 0.3, 0.9, 'sawtooth', 0, 260);
    },
    // 声呐探测到目标
    detect() {
        playTone(880, 0.3, 0.005, 0.15, 'square');
        playTone(1320, 0.3, 0.005, 0.2, 'square', 0.12);
    },
    // UI 点击
    click() {
        playTone(700, 0.2, 0.002, 0.08, 'triangle');
    },
    // 胜利号角
    win() {
        const notes = [523, 659, 784, 1047];
        notes.forEach((f, i) => playTone(f, 0.35, 0.02, 0.45, 'triangle', i * 0.16));
        playTone(1047, 0.3, 0.02, 1.2, 'triangle', 0.7);
    },
    // 失败：下行低音
    lose() {
        const notes = [392, 330, 262, 196];
        notes.forEach((f, i) => playTone(f, 0.35, 0.02, 0.5, 'sawtooth', i * 0.22));
    }
};

export const sfx = {
    isEnabled() {
        return enabled;
    },
    setEnabled(value) {
        enabled = !!value;
        localStorage.setItem(STORAGE_KEY, enabled ? '1' : '0');
        if (enabled) {
            this.play('click');
        }
    },
    toggle() {
        this.setEnabled(!enabled);
        return enabled;
    },
    play(name) {
        if (!enabled) return;
        if (!ensureContext()) return;
        const fn = sounds[name];
        if (fn) {
            try {
                fn();
            } catch (e) {
                // 音频失败不影响游戏
            }
        }
    }
};
