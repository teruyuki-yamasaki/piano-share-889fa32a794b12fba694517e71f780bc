/**
 * ネイティブ MIDI ブリッジ向けの予約送信。
 * send(data, timestamp) の timestamp を扱わない実装でも先読み分だけ早く鳴らさない。
 * 通常の Web MIDI には使わず、ブラウザ本来の高精度な予約を維持する。
 */
export class MidiSendQueue {
    pending = [];
    timer = null;
    now;
    schedule;
    cancel;
    constructor(now = () => performance.now(), schedule = (fn, ms) => setTimeout(fn, ms), cancel = (id) => clearTimeout(id)) {
        this.now = now;
        this.schedule = schedule;
        this.cancel = cancel;
    }
    enqueue(at, send) {
        // 同時刻のイベントも、登録した順に送る（ペダルの離す→踏むなど）。
        this.pending.push({ at, send });
        this.pending.sort((a, b) => a.at - b.at);
        this.arm();
    }
    clear() {
        if (this.timer !== null)
            this.cancel(this.timer);
        this.timer = null;
        this.pending = [];
    }
    arm() {
        if (this.timer !== null)
            this.cancel(this.timer);
        this.timer = null;
        if (!this.pending.length)
            return;
        const delay = this.pending[0].at - this.now();
        if (delay <= 0)
            this.flush();
        else
            this.timer = this.schedule(() => {
                this.timer = null;
                this.flush();
            }, delay);
    }
    flush() {
        const now = this.now();
        while (this.pending.length && this.pending[0].at <= now)
            this.pending.shift().send();
        this.arm();
    }
}
