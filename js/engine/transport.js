import { TempoMap } from "../core/tempo.js";
/**
 * 再生位置（拍）を管理する時計。
 * - rate: テンポ倍率（0.5 = 半分の速さ）
 * - gate: この拍より先には進まない「待ち」位置。ウェイトモードで、
 *         ユーザーが次の音を弾くまで曲を止めておくために使う。
 * 時刻はすべて performance.now() 基準のミリ秒。
 */
export class Transport {
    tempo;
    rate = 1;
    running = false;
    gate = null;
    anchorBeat = 0;
    anchorTime = 0;
    constructor(tempo) {
        this.tempo = tempo;
    }
    /** gate を無視した、時刻 time における理論上の位置 */
    rawBeatAt(time) {
        if (!this.running)
            return this.anchorBeat;
        const sec = this.tempo.beatToSec(this.anchorBeat) + ((time - this.anchorTime) / 1000) * this.rate;
        return this.tempo.secToBeat(sec);
    }
    position(now) {
        const raw = this.rawBeatAt(now);
        if (this.gate !== null && raw > this.gate)
            return Math.max(this.gate, this.anchorBeat);
        return raw;
    }
    isWaiting(now) {
        return this.running && this.gate !== null && this.rawBeatAt(now) >= this.gate;
    }
    /** 拍 beat が鳴るべき時刻（gate より手前の拍に対してのみ有効） */
    timeAt(beat) {
        return this.anchorTime + ((this.tempo.beatToSec(beat) - this.tempo.beatToSec(this.anchorBeat)) / this.rate) * 1000;
    }
    start(now) {
        if (this.running)
            return;
        this.anchorTime = now;
        this.running = true;
    }
    pause(now) {
        this.anchorBeat = this.position(now);
        this.anchorTime = now;
        this.running = false;
    }
    seek(beat, now) {
        this.anchorBeat = beat;
        this.anchorTime = now;
    }
    setRate(rate, now) {
        this.reanchor(now);
        this.rate = rate;
    }
    /** gate を変更。待ち状態から解放されたときは、その瞬間から再び時間が流れ始める */
    setGate(gate, now) {
        this.reanchor(now);
        this.gate = gate;
    }
    reanchor(now) {
        this.anchorBeat = this.position(now);
        this.anchorTime = now;
    }
}
