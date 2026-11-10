/**
 * マイク入力の音高検出（単音）。
 *   detectPitch     … 1 フレーム分の波形から基本周波数を求める（YIN 法）
 *   PitchNoteTracker … フレームごとの音高を「ノートオン / オフ」に区切る
 * 歌声・管楽器・弦楽器などの単旋律を想定。和音は最も強い 1 音しか取れない。
 * どちらも DOM / Web Audio に依存しないので、Node のテストでそのまま検証できる。
 */
export function detectPitch(buf, sampleRate, opts = {}) {
    const { minHz = 60, maxHz = 1500, threshold = 0.15 } = opts;
    let sum = 0;
    for (let i = 0; i < buf.length; i++)
        sum += buf[i] * buf[i];
    const rms = Math.sqrt(sum / buf.length);
    if (rms < 1e-5)
        return { hz: null, clarity: 0, rms };
    const w = Math.floor(buf.length / 2);
    const maxLag = Math.min(w, Math.floor(sampleRate / minHz));
    const minLag = Math.max(2, Math.floor(sampleRate / maxHz));
    // 差分関数 → 累積平均で正規化（CMNDF）
    const d = new Float32Array(maxLag + 1);
    d[0] = 1;
    let running = 0;
    for (let tau = 1; tau <= maxLag; tau++) {
        let acc = 0;
        for (let i = 0; i < w; i++) {
            const diff = buf[i] - buf[i + tau];
            acc += diff * diff;
        }
        running += acc;
        d[tau] = running > 0 ? (acc * tau) / running : 1;
    }
    let tau = -1;
    for (let t = minLag; t <= maxLag; t++) {
        if (d[t] < threshold) {
            while (t + 1 <= maxLag && d[t + 1] < d[t])
                t++;
            tau = t;
            break;
        }
    }
    if (tau < 0) {
        // しきい値を下回らなくても、十分はっきりした谷があれば採用（クラリティで後段が判断する）
        let best = minLag;
        for (let t = minLag; t <= maxLag; t++)
            if (d[t] < d[best])
                best = t;
        if (d[best] > 0.35)
            return { hz: null, clarity: 1 - d[best], rms };
        tau = best;
    }
    // 放物線補間で谷の位置を細かく求める
    let refined = tau;
    if (tau > 1 && tau < maxLag) {
        const a = d[tau - 1];
        const b = d[tau];
        const c = d[tau + 1];
        const den = a - 2 * b + c;
        if (den !== 0)
            refined = tau + (0.5 * (a - c)) / den;
    }
    return { hz: sampleRate / refined, clarity: Math.max(0, 1 - d[tau]), rms };
}
export function hzToMidi(hz) {
    return 69 + 12 * Math.log2(hz / 440);
}
/**
 * フレーム列をノートに区切る。
 * - 音高が stableFrames 続いて初めて発音（歌い出しの揺れやノイズで誤反応しないため）
 * - 鳴っている音から ±0.7 半音以内の揺れ（ビブラート・しゃくり）は同じ音として扱う
 * - 同じ高さのまま音量が谷から大きく持ち上がったら、同じ音の弾き直しとみなす
 */
export class PitchNoteTracker {
    minRms;
    minClarity;
    stableFrames;
    releaseFrames;
    current = null;
    candidate = null;
    candidateCount = 0;
    candidateTime = 0;
    candidateCents = [];
    silent = 0;
    peak = 0;
    valley = Infinity;
    constructor(opts = {}) {
        this.minRms = opts.minRms ?? 0.004;
        this.minClarity = opts.minClarity ?? 0.8;
        this.stableFrames = opts.stableFrames ?? 2;
        this.releaseFrames = opts.releaseFrames ?? 2;
    }
    reset(time) {
        const out = [];
        if (this.current !== null)
            out.push({ type: 'off', midi: this.current, time, velocity: 0, cents: 0 });
        this.current = null;
        this.candidate = null;
        this.candidateCount = 0;
        this.silent = 0;
        return out;
    }
    push(frame, time) {
        const out = [];
        const voiced = frame.hz !== null && frame.clarity >= this.minClarity && frame.rms >= this.minRms;
        if (!voiced) {
            this.candidate = null;
            this.candidateCount = 0;
            if (this.current !== null && ++this.silent >= this.releaseFrames) {
                out.push({ type: 'off', midi: this.current, time, velocity: 0, cents: 0 });
                this.current = null;
            }
            return out;
        }
        this.silent = 0;
        const mf = hzToMidi(frame.hz);
        if (this.current !== null && Math.abs(mf - this.current) < 0.7) {
            this.candidate = null;
            this.candidateCount = 0;
            // 同じ音の弾き直し（音量の谷 → 急な立ち上がり）
            if (this.valley < this.peak * 0.45 && frame.rms > this.valley * 2.5) {
                const midi = this.current;
                out.push({ type: 'off', midi, time, velocity: 0, cents: 0 });
                out.push({ type: 'on', midi, time, velocity: velocityFor(frame.rms), cents: Math.round((mf - midi) * 100) });
                this.peak = frame.rms;
                this.valley = frame.rms;
                return out;
            }
            if (frame.rms > this.peak) {
                this.peak = frame.rms;
                this.valley = frame.rms;
            }
            else {
                this.valley = Math.min(this.valley, frame.rms);
            }
            return out;
        }
        const m = Math.round(mf);
        if (this.candidate === m) {
            this.candidateCount++;
            this.candidateCents.push((mf - m) * 100);
        }
        else {
            this.candidate = m;
            this.candidateCount = 1;
            this.candidateTime = time;
            this.candidateCents = [(mf - m) * 100];
        }
        if (this.candidateCount >= this.stableFrames) {
            if (this.current !== null)
                out.push({ type: 'off', midi: this.current, time: this.candidateTime, velocity: 0, cents: 0 });
            const cents = this.candidateCents.reduce((a, b) => a + b, 0) / this.candidateCents.length;
            out.push({ type: 'on', midi: m, time: this.candidateTime, velocity: velocityFor(frame.rms), cents: Math.round(cents) });
            this.current = m;
            this.peak = frame.rms;
            this.valley = frame.rms;
            this.candidate = null;
            this.candidateCount = 0;
        }
        return out;
    }
}
function velocityFor(rms) {
    // -50 dB → 30, -10 dB → 120 くらい
    const db = 20 * Math.log10(Math.max(rms, 1e-6));
    return Math.max(20, Math.min(127, Math.round(30 + ((db + 50) / 40) * 90)));
}
