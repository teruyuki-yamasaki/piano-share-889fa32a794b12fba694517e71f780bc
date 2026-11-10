/**
 * 入りきらない 1 行の文字を、CD プレーヤーの表示のように横に流す。
 * 最初で少し止まる → 文字の終わりまで全部流しきる → 後ろに続く同じ文字がちょうど最初の位置に来たところで止まる、をくり返す
 * （止まった位置は最初と同じ見た目なので、戻るときに飛ばない）。
 * 入りきるときは流さない（CSS の省略記号のまま）。「視差効果を減らす」の設定では流さない
 */
const HOLD_MS = 2500;
/** 流す速さ（px / 秒） */
const SPEED = 40;
/** 文字の終わりと、次に続く同じ文字のあいだ（px） */
const GAP = 48;
export class Marquee {
    box;
    first;
    copy;
    track;
    anim = null;
    lastKey = '';
    /** box: はみ出しを隠す枠、track: 中で動かす要素（inline-block）。中身はこのクラスが作る */
    constructor(box, track) {
        this.box = box;
        this.track = track;
        this.first = document.createElement('span');
        this.copy = document.createElement('span');
        this.copy.setAttribute('aria-hidden', 'true');
        this.copy.style.paddingLeft = `${GAP}px`;
        this.copy.hidden = true;
        track.replaceChildren(this.first, this.copy);
        new ResizeObserver(() => this.update()).observe(box);
    }
    setText(s) {
        if (this.first.textContent === s)
            return;
        this.first.textContent = s;
        this.copy.textContent = s;
        this.update();
    }
    update() {
        const width = this.first.offsetWidth;
        const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
        const scroll = width - this.box.clientWidth > 2 && !reduce;
        const key = scroll ? `${this.first.textContent}:${Math.round(width)}` : '';
        if (key === this.lastKey)
            return;
        this.lastKey = key;
        this.anim?.cancel();
        this.anim = null;
        this.box.classList.toggle('is-scrolling', scroll);
        this.copy.hidden = !scroll;
        if (!scroll)
            return;
        // 文字の全部と隙間のぶんだけ流す（続く同じ文字が、最初の文字のあった位置に来る）
        const shift = width + GAP;
        const move = (shift / SPEED) * 1000;
        const total = HOLD_MS + move;
        this.anim = this.track.animate([
            { transform: 'translateX(0)', offset: 0 },
            { transform: 'translateX(0)', offset: HOLD_MS / total },
            { transform: `translateX(${-shift}px)`, offset: 1 },
        ], { duration: total, iterations: Infinity });
    }
}
