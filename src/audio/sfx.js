// src/audio/sfx.js
// WebAudio 合成音效 - 零资源文件，全部程序化生成
// 依赖用户手势后才能创建 AudioContext（浏览器自动播放策略）
// 信号链：声源 -> 压缩器 -> 输出，另带卷积混响与反馈延迟两条发送总线

const STORAGE_KEY = 'sfxEnabled';

let ctx = null;
let master = null;
let reverb = null;
let echo = null;
let noiseBuf = null;
let enabled = localStorage.getItem(STORAGE_KEY) !== '0';

function ensureContext() {
    if (!ctx) {
        try {
            ctx = new (window.AudioContext || window.webkitAudioContext)();

            const compressor = ctx.createDynamicsCompressor();
            compressor.threshold.value = -16;
            compressor.knee.value = 12;
            compressor.ratio.value = 7;
            compressor.attack.value = 0.003;
            compressor.release.value = 0.22;

            master = ctx.createGain();
            master.gain.value = 0.5;
            master.connect(compressor);
            compressor.connect(ctx.destination);

            reverb = ctx.createConvolver();
            reverb.buffer = impulse(0.85, 2.8);
            const reverbReturn = ctx.createGain();
            reverbReturn.gain.value = 0.5;
            reverb.connect(reverbReturn).connect(master);

            echo = ctx.createDelay(1);
            echo.delayTime.value = 0.27;
            const feedback = ctx.createGain();
            feedback.gain.value = 0.28;
            echo.connect(feedback).connect(echo);
            echo.connect(master);
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

function impulse(seconds, decay) {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buffer = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
        const data = buffer.getChannelData(c);
        for (let i = 0; i < len; i++) {
            data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
        }
    }
    return buffer;
}

function noiseBuffer() {
    if (!noiseBuf) {
        const len = Math.floor(ctx.sampleRate * 2);
        noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
        const data = noiseBuf.getChannelData(0);
        for (let i = 0; i < len; i++) {
            data[i] = Math.random() * 2 - 1;
        }
    }
    return noiseBuf;
}

function env(peak, attack, decay, t) {
    const g = ctx.createGain();
    const a = Math.max(0.001, attack);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + Math.max(0.01, decay));
    return g;
}

// 把一条声源接到主输出，并按照需要分流到混响/延迟发送
function out(node, { wet = 0, pan = 0, echoSend = 0 } = {}) {
    let tail = node;
    if (pan && ctx.createStereoPanner) {
        const panner = ctx.createStereoPanner();
        panner.pan.value = pan;
        node.connect(panner);
        tail = panner;
    }
    tail.connect(master);
    if (wet > 0) {
        const send = ctx.createGain();
        send.gain.value = wet;
        tail.connect(send);
        send.connect(reverb);
    }
    if (echoSend > 0) {
        const send = ctx.createGain();
        send.gain.value = echoSend;
        tail.connect(send);
        send.connect(echo);
    }
    return tail;
}

function playTone(freq, peak, attack, decay, type = 'sine', at = 0, endFreq = null, opts = {}) {
    const t = now() + at;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (endFreq) {
        osc.frequency.exponentialRampToValueAtTime(Math.max(1, endFreq), t + attack + decay);
    }
    let node = osc;
    if (opts.lp) {
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = opts.lp;
        filter.Q.value = opts.q || 0.8;
        node.connect(filter);
        node = filter;
    }
    const g = env(peak, attack, decay, t);
    node.connect(g);
    out(g, { wet: opts.wet, pan: opts.pan, echoSend: opts.echoSend });
    osc.start(t);
    osc.stop(t + attack + decay + 0.08);
}

function playNoise(peak, attack, decay, type, freq, at = 0, opts = {}) {
    const t = now() + at;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer();
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(freq, t);
    filter.Q.value = opts.q || 0.7;
    if (opts.endFreq) {
        filter.frequency.exponentialRampToValueAtTime(Math.max(20, opts.endFreq), t + attack + decay);
    }
    const g = env(peak, attack, decay, t);
    src.connect(filter).connect(g);
    out(g, { wet: opts.wet, pan: opts.pan, echoSend: opts.echoSend });
    src.start(t, Math.random() * 1.4);
    src.stop(t + attack + decay + 0.1);
}

// 非谐波金属泛音：炮塔、装甲被击穿时的高频"钢响"
function metal(freqs, peak, decay, at = 0, opts = {}) {
    freqs.forEach((f, i) => {
        playTone(f, peak / (1 + i * 0.45), 0.003, decay * (1 - i * 0.08), 'sine', at + i * 0.004, null, {
            ...opts,
            pan: (opts.pan || 0) + (i % 2 ? 0.08 : -0.08)
        });
    });
}

function bubbles(at, count, peak) {
    for (let i = 0; i < count; i++) {
        const t = at + Math.random() * 0.9;
        playTone(500 + Math.random() * 900, peak * (0.6 + Math.random() * 0.4), 0.004, 0.04 + Math.random() * 0.08, 'sine', t);
    }
}

const sounds = {
    // 主炮齐射：炮口爆音 + 膛压低频 + 炮塔金属余震
    fire() {
        playNoise(0.6, 0.002, 0.18, 'lowpass', 1400, 0, { wet: 0.22, echoSend: 0.06 });
        playNoise(0.16, 0.001, 0.05, 'highpass', 2600);
        playTone(68, 0.9, 0.004, 0.5, 'sine', 0, 38);
        playTone(142, 0.36, 0.006, 0.34, 'sine', 0.01, 55);
        metal([420, 1120, 2190], 0.13, 0.3, 0.01, { wet: 0.18 });
    },
    // 未命中：入水闷响 + 水花
    splash() {
        playNoise(0.4, 0.004, 0.34, 'lowpass', 900, 0, { wet: 0.12 });
        playTone(240, 0.18, 0.006, 0.28, 'sine', 0, 85);
        playNoise(0.08, 0.03, 0.4, 'highpass', 3200, 0.03, { wet: 0.2 });
        bubbles(0.1, 3, 0.035);
    },
    // 命中：装甲爆裂 + 低频冲击 + 钢响
    hit() {
        playNoise(0.55, 0.002, 0.3, 'bandpass', 760, 0, { q: 0.9, wet: 0.26 });
        playNoise(0.2, 0.001, 0.06, 'highpass', 2400);
        playTone(112, 0.8, 0.003, 0.42, 'sine', 0, 44);
        playTone(72, 0.55, 0.005, 0.6, 'sine', 0.01, 32);
        metal([190, 460, 980, 1680], 0.17, 0.38, 0, { wet: 0.22 });
    },
    // 沉没：长低频下潜 + 金属撕裂 + 气泡
    sunk() {
        playTone(74, 0.85, 0.01, 1.8, 'sine', 0, 26, { wet: 0.35 });
        playTone(96, 0.2, 0.02, 1.5, 'sawtooth', 0.05, 42, { lp: 320, wet: 0.25 });
        playNoise(0.35, 0.03, 1.5, 'lowpass', 460, 0.04, { wet: 0.3, endFreq: 140 });
        metal([140, 310, 640, 1120], 0.11, 1.2, 0.08, { wet: 0.3 });
        bubbles(0.5, 6, 0.04);
    },
    // 声呐 ping：窄带脉冲 + 拖尾回声
    sonar() {
        playTone(1280, 0.34, 0.005, 0.85, 'sine', 0, 1120, { echoSend: 0.32, wet: 0.3 });
        playTone(640, 0.12, 0.005, 0.7, 'sine', 0.02, 560, { echoSend: 0.2, wet: 0.2 });
        playTone(2560, 0.05, 0.004, 0.3, 'sine', 0, 2400, { wet: 0.2 });
    },
    // 空袭：双机引擎声自左舷掠至右舷
    plane() {
        const t = now();
        const bus = ctx.createGain();
        let panner = null;
        if (ctx.createStereoPanner) {
            panner = ctx.createStereoPanner();
            panner.pan.setValueAtTime(-0.85, t);
            panner.pan.linearRampToValueAtTime(0.85, t + 1.7);
            bus.connect(panner);
        }
        const tail = panner || bus;
        tail.connect(master);
        const send = ctx.createGain();
        send.gain.value = 0.16;
        tail.connect(send);
        send.connect(reverb);

        const chop = ctx.createGain();
        chop.gain.value = 0.7;
        const lfo = ctx.createOscillator();
        lfo.frequency.value = 17;
        const lfoGain = ctx.createGain();
        lfoGain.gain.value = 0.28;
        lfo.connect(lfoGain).connect(chop.gain);
        lfo.start(t);
        lfo.stop(t + 2);

        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 480;
        lp.Q.value = 1.1;
        lp.connect(chop);
        chop.connect(bus);

        [[62, 75, 0.18], [126, 150, 0.09]].forEach(([f0, f1, peak]) => {
            const osc = ctx.createOscillator();
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(f0, t);
            osc.frequency.linearRampToValueAtTime(f1, t + 1.7);
            const g = env(peak, 0.35, 1.2, t);
            osc.connect(g).connect(lp);
            osc.start(t);
            osc.stop(t + 1.8);
        });

        playNoise(0.1, 0.4, 1.2, 'lowpass', 620, 0, { wet: 0.12 });
    },
    // 声呐回波命中：两段确认音
    detect() {
        playTone(980, 0.28, 0.004, 0.12, 'sine', 0, 940, { echoSend: 0.18 });
        playTone(1470, 0.16, 0.004, 0.16, 'square', 0.14, 1410, { lp: 3000, echoSend: 0.14 });
    },
    // UI 点击：短促机械咔哒
    click() {
        playNoise(0.11, 0.001, 0.022, 'highpass', 2800);
        playTone(1250, 0.1, 0.002, 0.05, 'square', 0, 900, { lp: 3600 });
    },
    // 胜利号角：铜管上行 + 长音
    win() {
        const notes = [392, 523, 659, 784, 1047];
        notes.forEach((f, i) => {
            playTone(f, 0.3, 0.02, 0.45, 'sawtooth', i * 0.16, null, { lp: 2400, wet: 0.35 });
            playTone(f / 2, 0.12, 0.02, 0.45, 'sine', i * 0.16, null, { wet: 0.2 });
        });
        playTone(1047, 0.26, 0.03, 1.4, 'sawtooth', 0.75, null, { lp: 2600, wet: 0.45 });
        playTone(784, 0.14, 0.03, 1.2, 'sine', 0.75, null, { wet: 0.4 });
    },
    // 失败：下行低音，逐渐暗下去
    lose() {
        const notes = [220, 185, 147, 110];
        notes.forEach((f, i) => {
            playTone(f, 0.24, 0.02, 0.6, 'sawtooth', i * 0.24, null, { lp: 900, wet: 0.3 });
        });
        playTone(55, 0.35, 0.05, 2, 'sine', 0.85, null, { wet: 0.35 });
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
