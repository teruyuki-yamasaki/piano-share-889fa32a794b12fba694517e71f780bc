import { layoutScore } from "../notation/layout.js";
import { renderScore } from "../notation/render-svg.js";
/**
 * 楽譜を「一段ずつ」見せるビュー。
 * 演奏位置のカーソルが次の段へ移ると、その段が上端に来るよう自動でスクロールする。
 * 自分が弾くパートは濃く、自動演奏のパートは薄く表示し、次に弾く音符はパート色で示す。
 */
/** 符頭のクリックとみなす距離（楽譜の座標） */
const NOTE_HIT = 9;
export class ScoreView {
    root;
    graphic = null;
    score = null;
    /**
     * 演奏位置のカーソル。楽譜の SVG の外に重ねた要素で、transform だけで動かす。
     * 長い曲の楽譜は要素が数万になり、SVG の中の要素を毎フレーム動かすと楽譜全体の描き直しになって
     * 画面が重くなり、音の予約が遅れて音が途切れる（スマートフォンでは止まることもある）ため
     */
    cursor = null;
    cursorKey = '';
    /** 欄の中での楽譜の SVG の位置（余白の分） */
    svgOffset = { x: 0, y: 0 };
    lastSystem = -1;
    lastStatusVersion = -1;
    lastExpectedKey = '';
    lastUserKey = '';
    lastUserNotes = null;
    onNoteClick = null;
    resizeTimer = 0;
    onMeasureClick = null;
    /**
     * 楽譜の欄に使える高さ（画面の高さからバーとピアノロールの最低限を引いたもの）。
     * いちばん高い段がこれより高ければ、楽譜を縮めて段がまるごと入るようにする
     */
    availableHeight = null;
    /** 楽譜の表示の倍率（1 = 等倍。段が入りきらないときだけ縮める） */
    scale = 1;
    /** 段の分け方（'source' = 元の楽譜の改行。設定「改行を元の楽譜に合わせる」） */
    breaks = 'source';
    constructor(root) {
        this.root = root;
        new ResizeObserver(() => {
            clearTimeout(this.resizeTimer);
            this.resizeTimer = window.setTimeout(() => this.render(), 120);
        }).observe(root);
        // 画面の高さだけが変わったとき（楽譜の欄の幅は同じ）も、入りきるかを決め直す
        window.addEventListener('resize', () => {
            clearTimeout(this.resizeTimer);
            this.resizeTimer = window.setTimeout(() => this.render(), 120);
        });
        root.addEventListener('click', (e) => {
            if (!this.graphic)
                return;
            const pt = this.graphic.svg.getBoundingClientRect();
            const x = (e.clientX - pt.left) / this.scale;
            const y = (e.clientY - pt.top) / this.scale;
            // 音符を選べるとき（「主旋律」の手直し）は、近くの符頭を優先する
            if (this.onNoteClick) {
                const id = this.noteAtPoint(x, y);
                if (id !== null) {
                    this.onNoteClick(id);
                    return;
                }
            }
            const idx = this.graphic.measureAtPoint(x, y);
            if (idx !== null)
                this.onMeasureClick?.(idx);
        });
    }
    /** いちばん近い符頭の音（楽譜の座標。NOTE_HIT より遠ければ null） */
    noteAtPoint(x, y) {
        let best = null;
        let bestD = NOTE_HIT * NOTE_HIT;
        for (const [id, els] of this.graphic.heads) {
            for (const e of els) {
                const dx = Number(e.getAttribute('cx')) - x;
                const dy = Number(e.getAttribute('cy')) - y;
                if (dx * dx + dy * dy < bestD) {
                    bestD = dx * dx + dy * dy;
                    best = id;
                }
            }
        }
        return best;
    }
    /** 音符をクリックで選べるようにする（「主旋律」の手直し）。null なら小節のクリックだけ */
    setNoteClick(handler) {
        this.onNoteClick = handler;
        this.root.classList.toggle('note-pick', !!handler);
    }
    setBreaks(breaks) {
        if (breaks === this.breaks)
            return;
        this.breaks = breaks;
        this.render();
    }
    /** 楽譜の欄の高さを指定する（区切りをドラッグしたとき）。null なら、いちばん高い段に合わせる */
    setHeight(h) {
        this.root.style.height = h === null ? '' : `${Math.round(h)}px`;
        this.render();
    }
    setScore(score) {
        this.score = score;
        this.render();
    }
    /** いちばん高い段の高さ（楽譜の欄はこの高さに合わせ、どの段も見切れないようにする） */
    get systemHeight() {
        return tallestSystem(this.graphic?.layout.systems ?? []);
    }
    render() {
        if (!this.score)
            return;
        const width = Math.max(MIN_WIDTH * MIN_SCALE, this.root.clientWidth - 22);
        // 狭い画面（スマートフォンの縦向き）では、MIN_WIDTH の幅で並べてから縮めて、横幅に収める（横に見切れないように）
        const widthScale = Math.min(1, width / MIN_WIDTH);
        let layout = layoutScore(this.score, width / widthScale, { breaks: this.breaks });
        // いちばん高い段が楽譜の欄に入らなければさらに縮める（読める大きさまで）。縮めた分だけ広い幅で並べ直し、横幅いっぱいに使う
        const avail = this.availableHeight?.() ?? Infinity;
        const fit = (h) => Math.min(widthScale, Math.max(MIN_SCALE, (avail - 16) / h));
        this.scale = fit(tallestSystem(layout.systems));
        if (this.scale < widthScale) {
            layout = layoutScore(this.score, width / this.scale, { breaks: this.breaks });
            this.scale = Math.min(this.scale, fit(tallestSystem(layout.systems)));
        }
        this.graphic = renderScore(layout);
        if (this.scale < 1) {
            this.graphic.svg.setAttribute('width', String(layout.width * this.scale));
            this.graphic.svg.setAttribute('height', String(layout.height * this.scale));
        }
        for (const part of this.score.parts) {
            for (const g of this.graphic.chordGroups.get(part.id) ?? [])
                g.style.setProperty('--part', part.color);
        }
        this.cursor = document.createElement('div');
        this.cursor.className = 'score-cursor';
        this.cursor.setAttribute('aria-hidden', 'true');
        this.cursorKey = '';
        this.root.replaceChildren(this.graphic.svg, this.cursor);
        const sr = this.graphic.svg.getBoundingClientRect();
        const rr = this.root.getBoundingClientRect();
        this.svgOffset = { x: sr.left - rr.left - this.root.clientLeft + this.root.scrollLeft, y: sr.top - rr.top - this.root.clientTop + this.root.scrollTop };
        // 最初の段ではなく、いちばん高い段に合わせる（連弾の 4 段の大譜表や、加線・記号で高くなった段も見切れない）
        this.root.style.setProperty('--system-h', `${tallestSystem(layout.systems) * this.scale}px`);
        this.lastSystem = -1;
        this.lastStatusVersion = -1;
        this.lastExpectedKey = '';
        this.lastUserKey = '';
    }
    update(f) {
        const g = this.graphic;
        if (!g || !this.cursor)
            return;
        // 「主旋律」モードは、音符をすべて自動の色にして、自分の音の符頭だけを濃くする
        const userKey = f.userNotes ? `notes:${[...f.userParts].sort().join(',')}` : [...f.userParts].sort().join(',');
        if (userKey !== this.lastUserKey || f.userNotes !== this.lastUserNotes) {
            for (const [partId, groups] of g.chordGroups) {
                const mine = !f.userNotes && f.userParts.has(partId);
                for (const el of groups)
                    el.classList.toggle('is-auto', !mine);
            }
            for (const [id, els] of g.heads)
                for (const e of els)
                    e.classList.toggle('is-mine', !!f.userNotes?.has(id));
            this.lastUserKey = userKey;
            this.lastUserNotes = f.userNotes;
        }
        if (f.statusVersion !== this.lastStatusVersion) {
            for (const [id, els] of g.heads) {
                const st = f.noteStatus.get(id);
                for (const e of els) {
                    e.classList.toggle('is-hit', st === 'hit');
                    e.classList.toggle('is-miss', st === 'missed');
                }
            }
            this.lastStatusVersion = f.statusVersion;
        }
        const expKey = [...f.expectedNoteIds].join(',');
        if (expKey !== this.lastExpectedKey) {
            for (const id of this.lastExpectedKey.split(','))
                g.heads.get(Number(id))?.forEach((e) => e.classList.remove('is-next'));
            for (const id of f.expectedNoteIds)
                g.heads.get(id)?.forEach((e) => e.classList.add('is-next'));
            this.lastExpectedKey = expKey;
        }
        const c = g.cursorAt(Math.max(0, f.position));
        if (!c)
            return;
        // 楽譜の座標 → 欄の中の位置（SVG は余白の分ずれ、縮めているときは倍率をかける）
        const k = this.scale;
        const x = this.svgOffset.x + (c.x - 1.5) * k;
        const y = this.svgOffset.y + c.top * k;
        const key = `${x.toFixed(1)}|${y.toFixed(1)}|${(c.height * k).toFixed(1)}|${f.waiting}`;
        if (key !== this.cursorKey) {
            this.cursorKey = key;
            this.cursor.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
            this.cursor.style.height = `${(c.height * k).toFixed(1)}px`;
            this.cursor.classList.toggle('waiting', f.waiting);
        }
        if (c.system !== this.lastSystem) {
            const sys = g.layout.systems[c.system];
            this.root.scrollTo({ top: sys.top * this.scale, behavior: this.lastSystem < 0 ? 'auto' : 'smooth' });
            this.lastSystem = c.system;
        }
    }
}
/** 縮めるのはここまで（これより小さいと音符が読みにくい。それでも入らなければ段の下が隠れ、スクロールで見る） */
const MIN_SCALE = 0.6;
/** 楽譜を並べる最小の幅（これより狭い欄には、この幅で並べて縮めて入れる） */
const MIN_WIDTH = 480;
function tallestSystem(systems) {
    return systems.length ? Math.max(...systems.map((s) => s.height)) : 220;
}
