import { COLORS, alpha, isUserNote, setupCanvas } from "./frame.js";
import { KeyLayout, isBlack, noteLabel } from "./keylayout.js";
/**
 * 鍵盤の表示。色の意味:
 *   パート色（濃い）… 次に自分が弾く鍵盤（ウェイトモードでは点滅）
 *   パート色（薄い）… 自動演奏のパートがいま鳴らしている鍵盤
 *   緑 … 正しく押している / 赤 … 違う鍵盤を押している
 */
/** 鍵盤の高さ ÷ 白鍵の幅の上限（本物のピアノは約 6.5。目印として見やすい短めに） */
const KEYS_ASPECT = 2.6;
/** 鍵盤の高さの下限（スマートフォンの縦向きで 88 鍵を並べたときなど） */
const KEYS_MIN_H = 26;
/**
 * 黒鍵の長さ ÷ 白鍵の長さ。下側に残る白い部分（36%）を黒鍵（64%）より短くする。
 * 短い鍵盤でもこの比率を保ち、白い帯だけが余って見えないようにする。
 */
const BLACK_RATIO = 0.64;
export class KeyboardView {
    canvas;
    layout = new KeyLayout(48, 83, 800);
    parts = [];
    range = [48, 83];
    full = false;
    constructor(canvas) {
        this.canvas = canvas;
    }
    setScore(score) {
        this.parts = score.parts;
        this.updateRange();
    }
    updateRange() {
        const midis = this.parts.flatMap((p) => p.notes.map((n) => n.midi));
        this.range = KeyLayout.rangeFor(midis, this.full);
    }
    /** 描画幅に合わせてレイアウトを更新（ロールと共有する） */
    relayout() {
        const w = this.canvas.clientWidth;
        if (this.layout.width !== w || this.layout.lo !== this.range[0] || this.layout.hi !== this.range[1]) {
            this.layout = new KeyLayout(this.range[0], this.range[1], w);
        }
        return this.layout;
    }
    /** 鍵盤の高さの上限（--keys-h、CSS の .stage が使う）。最後に設定した値 */
    keysH = 0;
    /**
     * 鍵盤は直接押さず、どこを弾くかの目印なので、白鍵の幅に比べて長くしすぎない。
     * スマートフォンの縦向きなどで鍵盤が細いときは低くして、そのぶんピアノロール（落ちてくるノート）を広く見せる
     */
    fitHeight(keys) {
        const h = Math.round(Math.max(KEYS_MIN_H, keys.whiteW * KEYS_ASPECT));
        if (h === this.keysH)
            return;
        this.keysH = h;
        this.canvas.parentElement?.style.setProperty('--keys-h', `${h}px`);
    }
    draw(f) {
        const keys = this.relayout();
        this.fitHeight(keys);
        const ctx = setupCanvas(this.canvas);
        const W = this.canvas.clientWidth;
        const H = this.canvas.clientHeight;
        const blackH = H * BLACK_RATIO;
        const pulse = 0.5 + 0.5 * Math.sin(f.time / 180);
        // いま鳴っている音（パートごと）
        const sounding = new Map();
        for (const p of this.parts) {
            for (const n of p.notes) {
                if (n.start > f.position + 1e-6)
                    break;
                if (n.start + n.duration > f.position + 1e-6 && n.start <= f.position + 1e-6) {
                    const mine = isUserNote(f, n);
                    if (!sounding.has(n.midi) || !mine)
                        sounding.set(n.midi, { part: p, mine });
                }
            }
        }
        const userColor = this.parts.find((p) => f.userParts.has(p.id))?.color ?? '#4A7DFF';
        const fillFor = (m) => {
            const held = f.held.get(m);
            if (held === 'good')
                return COLORS.good;
            if (held === 'bad')
                return COLORS.bad;
            if (held === 'neutral')
                return COLORS.neutral;
            if (f.expectedMidis.has(m)) {
                if (f.expectedPressed.has(m))
                    return alpha(COLORS.good, 0.6);
                return alpha(userColor, f.waiting ? 0.55 + 0.45 * pulse : 0.85);
            }
            const s = sounding.get(m);
            if (s)
                return alpha(s.part.color, s.mine ? 0.7 : 0.45);
            return null;
        };
        // 白鍵の下半分は連続した白い面を先に敷く。細い鍵盤の固定幅の隙間が
        // 黒鍵と同じ太さの縦帯に見えることや、角丸パスの端末差を避ける。
        ctx.fillStyle = '#ECE9E1';
        ctx.fillRect(0, 0, W, H);
        ctx.font = '600 10px "Avenir Next", "Hiragino Sans", system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'alphabetic';
        // 白鍵
        for (let m = keys.lo; m <= keys.hi; m++) {
            if (isBlack(m))
                continue;
            const r = keys.rect(m);
            const gap = Math.min(0.75, r.w * 0.06);
            const x = r.x + gap / 2;
            const w = r.w - gap;
            const g = ctx.createLinearGradient(0, 0, 0, H);
            g.addColorStop(0, '#E9E6DE');
            g.addColorStop(0.12, '#F7F5EF');
            g.addColorStop(1, '#ECE9E1');
            ctx.fillStyle = g;
            ctx.fillRect(x, 0, w, H);
            const c = fillFor(m);
            if (c) {
                ctx.fillStyle = c;
                ctx.fillRect(x, 0, w, H);
            }
            ctx.fillStyle = 'rgba(15,17,24,0.35)';
            ctx.fillRect(r.x, 0, gap, H);
            const label = f.names === 'solfege' ? noteLabel(m, 'solfege') : m % 12 === 0 ? noteLabel(m, 'letter', true) : f.names === 'letter' ? noteLabel(m, 'letter') : '';
            if (label && w > 11) {
                ctx.fillStyle = c ? 'rgba(255,255,255,0.95)' : m % 12 === 0 ? '#5B6172' : '#9A9FAC';
                ctx.font = `600 ${Math.min(11, w * 0.42)}px "Avenir Next", "Hiragino Sans", system-ui, sans-serif`;
                ctx.fillText(label, x + w / 2, H - 8);
            }
        }
        // 黒鍵
        for (let m = keys.lo; m <= keys.hi; m++) {
            if (!isBlack(m))
                continue;
            const r = keys.rect(m);
            const g = ctx.createLinearGradient(0, 0, 0, blackH);
            g.addColorStop(0, '#22252E');
            g.addColorStop(1, '#0C0D11');
            ctx.fillStyle = g;
            ctx.fillRect(r.x, 0, r.w, blackH);
            const c = fillFor(m);
            if (c) {
                ctx.fillStyle = c;
                const inset = Math.min(1, r.w * 0.12);
                ctx.fillRect(r.x + inset, 0, r.w - 2 * inset, blackH - 2);
            }
            else {
                ctx.fillStyle = 'rgba(255,255,255,0.08)';
                const inset = Math.min(2, r.w * 0.2);
                ctx.fillRect(r.x + inset, blackH - 5, r.w - 2 * inset, 2);
            }
        }
        ctx.textAlign = 'start';
        // フェルト
        ctx.fillStyle = COLORS.felt;
        ctx.fillRect(0, 0, W, 2);
    }
}
