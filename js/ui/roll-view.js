import { COLORS, alpha, isUserNote, setupCanvas } from "./frame.js";
import { isBlack, noteLabel } from "./keylayout.js";
/**
 * 落ちてくるノート（ピアノロール）。
 * 横位置は下の鍵盤と完全に揃っており、帯の長さ = 押さえている長さ。
 * 下端のフェルト色の帯に届いた瞬間がその音を弾くタイミング。
 */
export class RollView {
    canvas;
    notes = [];
    score = null;
    /** 画面に見せる拍数（大きいほどゆっくり落ちる） */
    visibleBeats = 6;
    /** カウントイン中に表示する文字（表示言語に合わせて差し替える） */
    countInLabel = 'カウント中…';
    constructor(canvas) {
        this.canvas = canvas;
    }
    setScore(score) {
        this.score = score;
        this.notes = score.parts.flatMap((part) => part.notes.map((note) => ({ note, part }))).sort((a, b) => a.note.start - b.note.start);
    }
    draw(f, keys) {
        const ctx = setupCanvas(this.canvas);
        const W = this.canvas.clientWidth;
        const H = this.canvas.clientHeight;
        const hitY = H;
        const ppb = (H - 10) / this.visibleBeats;
        const pos = f.position;
        const yOf = (beat) => hitY - (beat - pos) * ppb;
        // 背景とレーン
        ctx.fillStyle = '#1A1E29';
        ctx.fillRect(0, 0, W, H);
        for (let m = keys.lo; m <= keys.hi; m++) {
            const r = keys.rect(m);
            if (isBlack(m)) {
                ctx.fillStyle = 'rgba(0,0,0,0.22)';
                ctx.fillRect(r.x, 0, r.w, H);
            }
            else if (m % 12 === 0 || m % 12 === 5) {
                ctx.fillStyle = m % 12 === 0 ? 'rgba(255,255,255,0.09)' : 'rgba(255,255,255,0.04)';
                ctx.fillRect(r.x, 0, 1, H);
            }
        }
        // 小節線・拍線
        if (this.score) {
            ctx.font = '600 11px "Avenir Next", "Hiragino Sans", system-ui, sans-serif';
            ctx.textBaseline = 'bottom';
            for (const m of this.score.measures) {
                if (m.start + m.length < pos - 1 || m.start > pos + this.visibleBeats + 1)
                    continue;
                const unit = 4 / m.denominator;
                for (let b = m.start; b < m.start + m.length - 1e-6; b += unit) {
                    const y = yOf(b);
                    if (y < 0 || y > hitY)
                        continue;
                    const isBar = Math.abs(b - m.start) < 1e-6;
                    ctx.fillStyle = isBar ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.05)';
                    ctx.fillRect(0, Math.round(y), W, 1);
                    if (isBar) {
                        ctx.fillStyle = 'rgba(255,255,255,0.38)';
                        ctx.fillText(m.number, 6, y - 3);
                    }
                }
            }
        }
        // ノート
        const pulse = 0.5 + 0.5 * Math.sin(f.time / 180);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        for (const { note, part } of this.notes) {
            if (note.start > pos + this.visibleBeats + 0.5)
                break;
            if (note.start + note.duration < pos - 0.6)
                continue;
            const r = keys.rect(note.midi);
            if (!r)
                continue;
            const isUser = isUserNote(f, note);
            const y2 = yOf(note.start);
            // 短い音でも先端を開始拍に固定する。最低高さを上方向に伸ばし、
            // 発音より先にバーが鍵盤を越えることを防ぐ。
            const h = Math.max(4, note.duration * ppb);
            const y1 = y2 - h;
            const x = r.x + 1.5;
            // 鍵盤がとても狭いとき（広い音域の曲を狭い画面で）でも幅・角の丸みが負にならないように
            const w = Math.max(1, r.w - 3);
            const status = f.noteStatus.get(note.id);
            const isNext = f.expectedNoteIds.has(note.id);
            ctx.beginPath();
            ctx.roundRect(x, y1, w, h, Math.max(0, Math.min(5, w / 3)));
            if (isUser) {
                let fill = part.color;
                if (status === 'hit')
                    fill = alpha(part.color, 0.38);
                ctx.fillStyle = fill;
                if (isNext && f.waiting) {
                    ctx.shadowColor = part.color;
                    ctx.shadowBlur = 10 + 10 * pulse;
                }
                ctx.fill();
                ctx.shadowBlur = 0;
                if (status === 'missed') {
                    ctx.strokeStyle = COLORS.bad;
                    ctx.lineWidth = 2;
                    ctx.stroke();
                }
                else if (isNext) {
                    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
                    ctx.lineWidth = 1.5;
                    ctx.stroke();
                }
            }
            else {
                ctx.fillStyle = alpha(part.color, 0.2);
                ctx.fill();
                ctx.strokeStyle = alpha(part.color, 0.65);
                ctx.lineWidth = 1;
                ctx.stroke();
            }
            if (isUser && f.names !== 'none' && w >= 13 && h >= 14) {
                ctx.fillStyle = status === 'hit' ? 'rgba(255,255,255,0.55)' : '#fff';
                ctx.font = `600 ${Math.min(12, w * 0.55)}px "Avenir Next", "Hiragino Sans", system-ui, sans-serif`;
                ctx.fillText(noteLabel(note.midi, f.names), x + w / 2, y2 - 3);
            }
        }
        ctx.textAlign = 'start';
        // フェルトの帯（打鍵位置）
        const grad = ctx.createLinearGradient(0, hitY - 14, 0, H);
        grad.addColorStop(0, 'rgba(179,38,62,0)');
        grad.addColorStop(1, f.waiting ? alpha(COLORS.felt, 0.35 + 0.25 * pulse) : alpha(COLORS.felt, 0.35));
        ctx.fillStyle = grad;
        ctx.fillRect(0, hitY - 14, W, 17);
        ctx.fillStyle = COLORS.felt;
        ctx.fillRect(0, hitY - 2, W, 2);
        if (f.countingIn) {
            ctx.fillStyle = 'rgba(255,255,255,0.85)';
            ctx.font = '600 15px "Avenir Next", "Hiragino Sans", system-ui, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(this.countInLabel, W / 2, 28);
            ctx.textAlign = 'start';
        }
    }
}
