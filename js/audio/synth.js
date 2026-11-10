const VOICES = {
    piano: {
        partials: [['triangle', 1, 0.7], ['sine', 2, 0.22], ['sawtooth', 1.0015, 0.06]],
        attack: 0.005, settle: 0.45, settleTau: 0.12, fade: 3.2, release: 0.07, bright: [3, 9], cap: 16000, darken: true, gain: 1,
    },
    epiano: {
        partials: [['sine', 1, 0.8], ['sine', 2, 0.14], ['sine', 14, 0.04]],
        attack: 0.003, settle: 0.5, settleTau: 0.25, fade: 2.6, release: 0.12, bright: [4, 6], cap: 9000, darken: true, gain: 1,
    },
    harpsichord: {
        partials: [['sawtooth', 1, 0.35], ['sawtooth', 1.002, 0.2], ['square', 2, 0.1]],
        attack: 0.002, settle: 0.3, settleTau: 0.08, fade: 1.1, release: 0.05, bright: [8, 8], cap: 14000, darken: true, gain: 0.8,
    },
    organ: {
        partials: [['sine', 1, 0.5], ['sine', 2, 0.3], ['sine', 3, 0.15], ['sine', 4, 0.12], ['sine', 8, 0.05]],
        attack: 0.012, settle: 1, settleTau: 0.1, fade: null, release: 0.06, bright: [12, 0], cap: 12000, darken: false, gain: 0.55,
    },
    strings: {
        partials: [['sawtooth', 1, 0.35], ['sawtooth', 1.004, 0.35], ['sawtooth', 0.996, 0.25]],
        attack: 0.18, settle: 0.85, settleTau: 0.4, fade: null, release: 0.3, bright: [3, 2], cap: 6000, darken: false, gain: 0.5,
    },
    choir: {
        partials: [['triangle', 1, 0.6], ['sawtooth', 1.003, 0.18], ['sine', 2, 0.15]],
        attack: 0.25, settle: 0.9, settleTau: 0.5, fade: null, release: 0.35, bright: [4, 0], cap: 2200, darken: false, gain: 0.6,
    },
};
/** General MIDI のプログラム番号（0 始まり）から、近い内蔵音色を選ぶ */
export function voiceForProgram(program) {
    if (program === 4 || program === 5 || (program >= 8 && program <= 15))
        return 'epiano';
    if (program === 6 || program === 7)
        return 'harpsichord';
    if (program >= 16 && program <= 23)
        return 'organ';
    if (program >= 52 && program <= 54)
        return 'choir';
    if ((program >= 40 && program <= 51) || (program >= 88 && program <= 95))
        return 'strings';
    return 'piano';
}
/**
 * Web Audio による軽量なシンセ（ピアノ・エレピ・チェンバロ・オルガン・ストリングス・コーラス）。
 * 電子ピアノの音（MIDI 出力）を使わないとき・MIDI 鍵盤に音源がないとき・メトロノームに使う。
 * 将来サンプル音源（SoundFont 等）に置き換える場合も NoteOutput を実装すれば差し替えられる。
 */
/** 補正する遅れの上限（これより大きい値が知らされても、先読みを長くしすぎない） */
const MAX_LATENCY_MS = 500;
export class Synth {
    ctx = null;
    master;
    voices = new Map();
    volume = 0.8;
    voice = 'piano';
    /** ペダルの予定（AudioContext の時刻）。先読みで未来のペダルも届くので時刻つきで覚える */
    pedalEvents = [];
    /** 鍵盤は離したがペダルで鳴らし続けている音 */
    sustained = new Set();
    /**
     * 音声ファイルに描き出すため（比較音源・音量の測定。app/dev/render-audio.html）: OfflineAudioContext などに結びつける。
     * 時刻は now() を基準にする（既定は performance.now()）
     */
    attachContext(ctx, now = () => performance.now()) {
        this.ctx = ctx;
        this.offline = true;
        this.clock = now;
        this.offset = null;
        const comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -14;
        comp.ratio.value = 4;
        this.master = ctx.createGain();
        this.master.gain.value = this.volume;
        this.master.connect(comp).connect(ctx.destination);
    }
    clock = () => performance.now();
    ensure() {
        if (this.ctx?.state === 'closed' && !this.offline) {
            // iOS の再入場で破棄済みのコンテキストを再利用しない。
            this.ctx = null;
            this.voices.clear();
            this.sustained.clear();
            this.pedalEvents = [];
            this.offset = null;
        }
        if (!this.ctx) {
            this.ctx = new AudioContext({ latencyHint: 'interactive' });
            const comp = this.ctx.createDynamicsCompressor();
            comp.threshold.value = -14;
            comp.ratio.value = 4;
            this.master = this.ctx.createGain();
            this.master.gain.value = this.volume;
            this.master.connect(comp).connect(this.ctx.destination);
        }
        return this.ctx;
    }
    /** ユーザー操作（クリック・キー入力）の中で一度呼ぶ必要がある */
    async resume() {
        const ctx = this.ensure();
        if (ctx.state !== 'running') {
            await ctx.resume();
            this.offset = null;
        }
    }
    setVolume(v) {
        this.volume = v;
        if (this.ctx)
            this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
    }
    setVoice(voice) {
        if (voice === this.voice)
            return;
        this.allNotesOff();
        this.voice = voice;
    }
    /** AudioContext の時刻 − clock() の時刻（秒）。音を予約するときの換算に使う */
    offset = null;
    offsetAt = 0;
    /**
     * currentTime は音声の処理の単位ごと（数ミリ秒おき）にしか進まないので、毎回そのまま換算すると
     * 予約した音の間隔が揺れる（テンポの乱れ）。換算の差は最大値をとって固定し、時計のずれの分だけゆっくり下げる。
     * 大きく食い違ったとき（音声の一時停止など）は測り直す。
     */
    syncOffset(ctx, now) {
        const o = ctx.currentTime - now / 1000;
        if (this.offset === null)
            this.offset = o;
        else {
            this.offset -= (Math.max(0, now - this.offsetAt) / 1000) * 0.0001;
            if (o > this.offset || o < this.offset - 0.05)
                this.offset = o;
        }
        this.offsetAt = now;
        return this.offset;
    }
    /** 手で足す遅れの補正（ミリ秒。設定「音と画面のずれの補正」） */
    extraLatencyMs = 0;
    /**
     * 音が耳に届くまでの遅れ（ミリ秒）。ブラウザが知らせる出力の遅れ（outputLatency・baseLatency）＋手で足した分。
     * 予約した音はこの分だけ早めに鳴らし、落ちてくるノートが鍵盤に着くときにちょうど聞こえるようにする
     */
    get latencyMs() {
        const ctx = this.ctx;
        if (!ctx || !('baseLatency' in ctx) || this.offline)
            return this.extraLatencyMs;
        const reported = ((ctx.outputLatency || 0) + (ctx.baseLatency || 0)) * 1000;
        return Math.min(MAX_LATENCY_MS, Math.max(0, reported) + this.extraLatencyMs);
    }
    /** 音声ファイルに描き出しているとき（attachContext）。遅れの補正はしない */
    offline = false;
    toCtxTime(time) {
        const ctx = this.ensure();
        const offset = this.syncOffset(ctx, this.clock());
        return Math.max(ctx.currentTime, time / 1000 + offset - this.latencyMs / 1000);
    }
    noteOn(midi, velocity, time) {
        const ctx = this.ensure();
        const t = this.toCtxTime(time);
        this.release(midi, t);
        this.sustained.delete(midi);
        const d = VOICES[this.voice];
        const f = 440 * 2 ** ((midi - 69) / 12);
        const v = (velocity / 127) ** 1.6;
        const amp = ctx.createGain();
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.Q.value = 0.7;
        const bright = Math.min(d.cap, f * (d.bright[0] + d.bright[1] * v));
        filter.frequency.setValueAtTime(bright, t);
        if (d.darken)
            filter.frequency.setTargetAtTime(Math.max(f * 1.5, 400), t + 0.01, 0.6);
        const gains = [];
        let ended = 0;
        const oscs = d.partials.map(([type, mul, g]) => {
            const o = ctx.createOscillator();
            o.type = type;
            o.frequency.value = f * mul;
            const pg = ctx.createGain();
            pg.gain.value = g;
            o.connect(pg).connect(filter);
            gains.push(pg);
            // 鳴り終わったらつなぎを外す（Safari・iPhone はつないだままのノードを片付けず、長く弾くと重くなって音が途切れる）
            o.onended = () => {
                o.disconnect();
                if (++ended < oscs.length)
                    return;
                for (const n of gains)
                    n.disconnect();
                filter.disconnect();
                amp.disconnect();
            };
            o.start(t);
            return o;
        });
        filter.connect(amp).connect(this.master);
        const peak = (0.32 * v + 0.02) * d.gain;
        amp.gain.setValueAtTime(0, t);
        amp.gain.linearRampToValueAtTime(peak, t + d.attack);
        if (d.settle < 1)
            amp.gain.setTargetAtTime(peak * d.settle, t + d.attack, d.settleTau);
        if (d.fade !== null) {
            // 高い音ほど早く減衰する
            const tau = d.fade * Math.max(0.16, Math.min(1, 1 - (midi - 40) * 0.014));
            amp.gain.setTargetAtTime(0.0001, t + 0.3, tau);
        }
        this.voices.set(midi, { oscs, amp, release: d.release });
    }
    noteOff(midi, time) {
        if (!this.ctx)
            return;
        const t = this.toCtxTime(time);
        if (this.pedalDownAt(t)) {
            // ペダルを離す予定がすでに届いていればその時刻に、まだなら離されるまで鳴らし続ける
            const up = this.pedalEvents.find((e) => e.t > t && !e.down);
            if (up)
                this.release(midi, up.t);
            else if (this.voices.has(midi))
                this.sustained.add(midi);
            return;
        }
        this.release(midi, t);
    }
    pedal(down, time) {
        const ctx = this.ensure();
        const t = this.toCtxTime(time);
        const keepFrom = ctx.currentTime - 2;
        this.pedalEvents = this.pedalEvents.filter((e) => e.t >= keepFrom);
        this.pedalEvents.push({ t, down });
        this.pedalEvents.sort((a, b) => a.t - b.t);
        if (!down) {
            for (const midi of this.sustained)
                this.release(midi, t);
            this.sustained.clear();
        }
    }
    pedalDownAt(t) {
        let down = false;
        for (const e of this.pedalEvents) {
            if (e.t > t)
                break;
            down = e.down;
        }
        return down;
    }
    release(midi, t) {
        const v = this.voices.get(midi);
        if (!v)
            return;
        this.voices.delete(midi);
        const g = v.amp.gain;
        if (g.cancelAndHoldAtTime)
            g.cancelAndHoldAtTime(t);
        else
            g.cancelScheduledValues(t);
        g.setTargetAtTime(0, t, v.release);
        for (const o of v.oscs)
            o.stop(t + v.release * 8 + 0.1);
    }
    allNotesOff() {
        this.pedalEvents = [];
        this.sustained.clear();
        if (!this.ctx)
            return;
        const t = this.ctx.currentTime;
        for (const midi of [...this.voices.keys()])
            this.release(midi, t);
    }
    click(accent, time) {
        const ctx = this.ensure();
        const t = this.toCtxTime(time);
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = 'square';
        o.frequency.value = accent ? 1760 : 1175;
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(accent ? 0.22 : 0.13, t + 0.002);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
        o.connect(g).connect(this.master);
        o.onended = () => {
            o.disconnect();
            g.disconnect();
        };
        o.start(t);
        o.stop(t + 0.06);
    }
}
