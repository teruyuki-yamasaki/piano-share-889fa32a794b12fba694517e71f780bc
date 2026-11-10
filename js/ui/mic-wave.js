/**
 * マイクの入力の大きさの流れ（右から入って左へ流れる細い棒の並び）。決まった大きさの canvas に描くので、入力で幅が変わらない。
 * マイクを使っていないときは、中央に細い線だけを描く（場所は空けておく）
 */
const BAR_W = 2;
const BAR_GAP = 1;
export class MicWave {
    canvas;
    levels = [];
    active = false;
    constructor(canvas) {
        this.canvas = canvas;
        const dpr = Math.max(1, Math.round(window.devicePixelRatio || 1));
        const w = canvas.width;
        const h = canvas.height;
        canvas.style.width = `${w}px`;
        canvas.style.height = `${h}px`;
        canvas.width = w * dpr;
        canvas.height = h * dpr;
        canvas.getContext('2d').scale(dpr, dpr);
        this.draw();
    }
    get cssWidth() { return this.canvas.width / Math.max(1, Math.round(window.devicePixelRatio || 1)); }
    get cssHeight() { return this.canvas.height / Math.max(1, Math.round(window.devicePixelRatio || 1)); }
    /** マイクの入り / 切り。切ったら流れを消す */
    setActive(on) {
        this.active = on;
        this.levels = [];
        this.draw();
    }
    /** 0..1 の大きさを 1 つ足す（左へ 1 本ずれる） */
    push(level) {
        const max = Math.floor(this.cssWidth / (BAR_W + BAR_GAP));
        this.levels.push(Math.max(0, Math.min(1, level)));
        if (this.levels.length > max)
            this.levels.splice(0, this.levels.length - max);
        this.draw();
    }
    draw() {
        const ctx = this.canvas.getContext('2d');
        const w = this.cssWidth;
        const h = this.cssHeight;
        const style = getComputedStyle(this.canvas);
        ctx.clearRect(0, 0, w, h);
        // 中央の線（いつも描く）
        ctx.fillStyle = style.getPropertyValue('--wave-idle').trim() || '#c8c8c8';
        ctx.fillRect(0, Math.floor(h / 2), w, 1);
        if (!this.active)
            return;
        ctx.fillStyle = style.getPropertyValue('--wave').trim() || '#3a9';
        // 新しいものほど右。上下対称の棒
        const n = this.levels.length;
        for (let i = 0; i < n; i++) {
            const bh = Math.max(1, this.levels[i] * (h - 2));
            const x = w - (n - i) * (BAR_W + BAR_GAP);
            ctx.fillRect(x, (h - bh) / 2, BAR_W, bh);
        }
    }
}
