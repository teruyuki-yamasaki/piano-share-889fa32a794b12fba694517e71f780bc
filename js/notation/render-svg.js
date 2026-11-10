import { bottomLine, clefShape, REPEAT_W, GRACE_SCALE, HEAD_W, S, STAFF_H, keySignaturePositions, yOf, } from "./layout.js";
const NS = 'http://www.w3.org/2000/svg';
function el(tag, attrs = {}, parent) {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs))
        e.setAttribute(k, String(v));
    parent?.appendChild(e);
    return e;
}
export function renderScore(layout) {
    const svg = el('svg', {
        width: layout.width,
        height: layout.height,
        viewBox: `0 0 ${layout.width} ${layout.height}`,
        class: 'score-svg',
    });
    const heads = new Map();
    const chordGroups = new Map();
    for (const sys of layout.systems) {
        const g = el('g', { class: 'system', 'data-system': sys.index }, svg);
        drawSystemFrame(g, sys, layout);
    }
    layout.measures.forEach((lm, k) => {
        const sys = layout.systems[lm.system];
        const g = el('g', { class: 'measure-chrome' }, svg);
        const yTop = sys.staffTops[0];
        const yBot = sys.staffTops[sys.staffTops.length - 1] + STAFF_H;
        const xEnd = lm.x + lm.width;
        // 小節線: MusicXML の bar-style（複縦線・終止線など）。最後の小節は、指定がなければ終止線。𝄇 は細線・太線
        const style = lm.repeat?.backward ? 'light-heavy' : lm.barEnd ?? (lm.isLast ? 'light-heavy' : undefined);
        const thin = (x) => el('line', { x1: x, x2: x, y1: yTop, y2: yBot, class: 'barline' }, g);
        const heavy = (x) => el('rect', { x, y: yTop, width: 3, height: yBot - yTop, class: 'barline-heavy' }, g);
        // 反復記号の 2 つの点（譜表ごとに、真ん中の線をはさむ 2 つの間）
        const dots = (x) => {
            for (const top of sys.staffTops)
                for (const dy of [1.5, 2.5])
                    el('circle', { cx: x, cy: top + dy * S, r: 0.24 * S, class: 'repeat-dot' }, g);
        };
        // 𝄆: 太線・細線・点。同じ段で前の小節が 𝄇 なら、太線はその小節のものを使う
        if (lm.repeat?.forward) {
            const prev = layout.measures[k - 1];
            const shared = !!prev?.repeat?.backward && prev.system === lm.system;
            if (!shared)
                heavy(lm.x);
            thin(lm.x + 5);
            dots(lm.x + REPEAT_W - 1);
        }
        if (lm.repeat?.backward) {
            dots(xEnd - REPEAT_W + 1);
            // 3 回以上くり返すときは回数
            if (lm.repeat.backward >= 3) {
                const t = el('text', { x: xEnd, y: yTop - 0.8 * S, class: 'repeat-times', 'text-anchor': 'end' }, g);
                t.textContent = `×${lm.repeat.backward}`;
            }
        }
        if (style === 'light-heavy') {
            thin(xEnd - 5);
            heavy(xEnd - 3);
        }
        else if (style === 'light-light') {
            thin(xEnd - 3.5);
            thin(xEnd);
        }
        else if (style === 'heavy-light') {
            heavy(xEnd - 5);
            thin(xEnd);
        }
        else if (style === 'heavy-heavy') {
            heavy(xEnd - 7);
            heavy(xEnd - 3);
        }
        else if (style === 'dashed' || style === 'dotted')
            el('line', { x1: xEnd, x2: xEnd, y1: yTop, y2: yBot, class: 'barline', 'stroke-dasharray': style === 'dashed' ? '4 3' : '1 3' }, g);
        else
            thin(xEnd);
        if (lm.index === sys.firstMeasure) {
            const t = el('text', { x: sys.x0 + 2, y: yTop - 2.6 * S, class: 'measure-no' }, g);
            t.textContent = lm.number;
        }
        if (lm.showTime) {
            const tx = lm.x + 14 + (lm.repeat?.forward ? REPEAT_W : 0);
            for (const top of sys.staffTops) {
                const a = el('text', { x: tx, y: top + S, class: 'timesig' }, g);
                a.textContent = String(lm.time[0]);
                const b = el('text', { x: tx, y: top + 3 * S, class: 'timesig' }, g);
                b.textContent = String(lm.time[1]);
            }
        }
    });
    // n 番かっこ（左端と、反復記号で終わるかっこの右端を下ろす）と、𝄋・𝄌
    const repeatLayer = el('g', { class: 'repeat-marks' }, svg);
    for (const e of layout.endings ?? []) {
        const hook = 1.6 * S;
        el('path', {
            d: `${e.startHook ? `M ${e.x1} ${e.y + hook} L ${e.x1} ${e.y}` : `M ${e.x1} ${e.y}`} L ${e.x2} ${e.y}${e.closed ? ` L ${e.x2} ${e.y + hook}` : ''}`,
            class: 'ending',
        }, repeatLayer);
        if (e.label) {
            const t = el('text', { x: e.x1 + 0.5 * S, y: e.y + 1.35 * S, class: 'ending-label' }, repeatLayer);
            t.textContent = e.label;
        }
    }
    for (const s of layout.signs ?? [])
        drawSign(repeatLayer, s);
    const tieLayer = el('g', { class: 'ties' }, svg);
    for (const t of layout.ties) {
        const dir = t.below ? 1 : -1;
        const y = t.y + dir * 6;
        const h = Math.min(8, 3 + (t.x2 - t.x1) * 0.06);
        el('path', {
            d: `M ${t.x1} ${y} Q ${(t.x1 + t.x2) / 2} ${y + dir * h * 2} ${t.x2} ${y} Q ${(t.x1 + t.x2) / 2} ${y + dir * (h * 2 - 2.4)} ${t.x1} ${y} Z`,
            class: 'tie',
        }, tieLayer);
    }
    for (const r of layout.rests)
        drawRest(svg, r);
    for (const c of layout.chords) {
        const g = drawChord(svg, c, layout, heads);
        if (!chordGroups.has(c.partId))
            chordGroups.set(c.partId, []);
        chordGroups.get(c.partId).push(g);
    }
    const beamLayer = el('g', { class: 'beams' }, svg);
    for (const b of layout.beams) {
        const th = 0.5 * S;
        const off = b.up ? th : -th;
        el('polygon', { points: `${b.x1},${b.y1} ${b.x2},${b.y2} ${b.x2},${b.y2 + off} ${b.x1},${b.y1 + off}`, class: 'beam' }, beamLayer);
        const slope = b.x2 === b.x1 ? 0 : (b.y2 - b.y1) / (b.x2 - b.x1);
        const gap = (b.up ? 1 : -1) * 0.8 * S;
        for (const s2 of b.secondary) {
            const g2 = gap * ((s2.level ?? 2) - 1);
            const ya = b.y1 + (s2.x1 - b.x1) * slope + g2;
            const yb = b.y1 + (s2.x2 - b.x1) * slope + g2;
            el('polygon', { points: `${s2.x1},${ya} ${s2.x2},${yb} ${s2.x2},${yb + off} ${s2.x1},${ya + off}`, class: 'beam' }, beamLayer);
        }
    }
    // トレモロの斜線
    const tremLayer = el('g', { class: 'tremolos' }, svg);
    for (const t of layout.tremolos ?? []) {
        for (let i = 0; i < t.marks; i++) {
            const dy = (i - (t.marks - 1) / 2) * 0.75 * S;
            const th = 0.45 * S;
            el('polygon', { points: `${t.x1},${t.y1 + dy} ${t.x2},${t.y2 + dy} ${t.x2},${t.y2 + dy + th} ${t.x1},${t.y1 + dy + th}`, class: 'beam' }, tremLayer);
        }
    }
    // 連符の数字と括弧
    const tupLayer = el('g', { class: 'tuplets' }, svg);
    for (const t of layout.tuplets ?? []) {
        const cx = (t.x1 + t.x2) / 2;
        const txt = el('text', { x: cx, y: t.y + (t.above ? 0 : 0.6 * S), class: 'tuplet-number' }, tupLayer);
        txt.textContent = String(t.number);
        if (t.bracket) {
            const by = t.y - (t.above ? 0.35 * S : 0.05 * S);
            const hook = t.above ? 0.6 * S : -0.6 * S;
            el('path', { d: `M ${t.x1} ${by + hook} L ${t.x1} ${by} L ${cx - 0.8 * S} ${by} M ${cx + 0.8 * S} ${by} L ${t.x2} ${by} L ${t.x2} ${by + hook}`, class: 'tuplet-bracket' }, tupLayer);
        }
    }
    // スタッカート・アクセントなど、フェルマータ
    const markLayer = el('g', { class: 'marks' }, svg);
    for (const m of layout.marks ?? [])
        drawMark(markLayer, m);
    // アルペッジョの波線
    for (const a of layout.arpeggios ?? []) {
        el('path', { d: wavyPath(a.x, a.y2, a.x, a.y1), class: 'arpeggio' }, markLayer);
    }
    // グリッサンド
    for (const g of layout.glissandos ?? []) {
        el('path', { d: g.wavy ? wavyPath(g.x1, g.y1, g.x2, g.y2) : `M ${g.x1} ${g.y1} L ${g.x2} ${g.y2}`, class: 'glissando' }, markLayer);
        if (g.label) {
            // 線に沿わせて、線の右上に置く
            const deg = (Math.atan2(g.y2 - g.y1, g.x2 - g.x1) * 180) / Math.PI;
            const mx = (g.x1 + g.x2) / 2 + 0.7 * S;
            const my = (g.y1 + g.y2) / 2;
            const t = el('text', { x: mx, y: my, class: 'glissando-label', transform: `rotate(${deg} ${mx} ${my})`, 'text-anchor': 'middle' }, markLayer);
            t.textContent = g.label;
        }
    }
    // 強弱記号
    const dynLayer = el('g', { class: 'dynamics' }, svg);
    for (const d of layout.dynamics ?? []) {
        const t = el('text', { x: d.x, y: d.y, class: 'dynamic' }, dynLayer);
        t.textContent = d.text;
    }
    // 文字の指示（<words>。書体は MusicXML の font-style / font-weight のまま）
    const wordLayer = el('g', { class: 'words-layer' }, svg);
    for (const w of layout.words ?? []) {
        const t = el('text', { x: w.x, y: w.y, class: `words words-${w.kind}${w.italic ? ' italic' : ''}${w.bold ? ' bold' : ''}` }, wordLayer);
        t.textContent = w.text;
    }
    // 松葉（開いた側は h、閉じた側は 0。niente は閉じた先に小さな丸）
    const wedgeLayer = el('g', { class: 'wedges' }, svg);
    for (const w of layout.wedges ?? []) {
        const r = 0.28 * S;
        const x1 = w.niente1 ? w.x1 + 2 * r : w.x1;
        const x2 = w.niente2 ? w.x2 - 2 * r : w.x2;
        el('path', {
            class: 'wedge',
            d: `M${x2} ${w.y - w.h2 / 2} L${x1} ${w.y - w.h1 / 2} M${x1} ${w.y + w.h1 / 2} L${x2} ${w.y + w.h2 / 2}`,
        }, wedgeLayer);
        if (w.niente1)
            el('circle', { class: 'wedge-niente', cx: w.x1 + r, cy: w.y, r }, wedgeLayer);
        if (w.niente2)
            el('circle', { class: 'wedge-niente', cx: w.x2 - r, cy: w.y, r }, wedgeLayer);
    }
    // 前打音（小さな音符。斜線つきは短前打音）
    const graceLayer = el('g', { class: 'graces' }, svg);
    for (const g of layout.graces ?? [])
        drawGrace(graceLayer, g, layout);
    for (const b of layout.graceBeams ?? []) {
        const th = 0.5 * S * GRACE_SCALE;
        for (let i = 0; i < b.levels; i++) {
            const off = (b.up ? 1 : -1) * i * 0.75 * S * GRACE_SCALE;
            el('polygon', { points: `${b.x1},${b.y1 + off} ${b.x2},${b.y2 + off} ${b.x2},${b.y2 + off + (b.up ? th : -th)} ${b.x1},${b.y1 + off + (b.up ? th : -th)}`, class: 'beam' }, graceLayer);
        }
    }
    // スラー: 外側と内側の 2 本の曲線で囲んで塗る（真ん中が太く、端が細い）
    const slurLayer = el('g', { class: 'slurs' }, svg);
    for (const sl of layout.slurs ?? []) {
        const dir = sl.above ? -1 : 1;
        const d = sl.h / 0.75; // 3 次ベジェの山の高さ = 制御点のずれ × 0.75
        const th = 0.18 * S;
        const ax = sl.x1 + (sl.x2 - sl.x1) / 4;
        const bx = sl.x2 - (sl.x2 - sl.x1) / 4;
        const ay = sl.y1 + (sl.y2 - sl.y1) / 4;
        const by = sl.y2 - (sl.y2 - sl.y1) / 4;
        el('path', {
            d: `M ${sl.x1} ${sl.y1} C ${ax} ${ay + dir * d} ${bx} ${by + dir * d} ${sl.x2} ${sl.y2} `
                + `C ${bx} ${by + dir * (d - th / 0.75)} ${ax} ${ay + dir * (d - th / 0.75)} ${sl.x1} ${sl.y1} Z`,
            class: 'slur',
        }, slurLayer);
    }
    // 段の途中の音部記号（小さく）
    for (const cc of layout.clefChanges ?? []) {
        const sys = layout.systems[cc.system];
        const top = sys.staffTops[cc.staff];
        const g = el('g', { class: 'clef-change', transform: `translate(${cc.x} ${top}) scale(0.72) translate(${-cc.x} ${-top})` }, svg);
        drawClef(g, cc.clef, cc.x, top);
    }
    // オッターヴァ（「8va」と破線、終わりの鉤）
    const ottavaLayer = el('g', { class: 'ottavas' }, svg);
    for (const o of layout.ottavas) {
        const t = el('text', { x: o.x1, y: o.y + (o.below ? 0.9 * S : 0), class: 'ottava-label' }, ottavaLayer);
        t.textContent = o.label;
        const lineY = o.y - (o.below ? -0.2 * S : 0.35 * S);
        const lx = o.x1 + 2.4 * S + (o.label.length - 3) * 0.6 * S;
        if (o.x2 > lx)
            el('line', { x1: lx, x2: o.x2, y1: lineY, y2: lineY, class: 'ottava-line' }, ottavaLayer);
        if (o.endHook) {
            const hook = o.below ? -0.8 * S : 0.8 * S;
            el('line', { x1: o.x2, x2: o.x2, y1: lineY, y2: lineY + hook, class: 'ottava-line' }, ottavaLayer);
        }
    }
    // 連桁グループの色は最初の和音に合わせる
    return {
        svg,
        layout,
        heads,
        chordGroups,
        cursorAt: (beat) => cursorAt(layout, beat),
        measureAtPoint(x, y) {
            for (const lm of layout.measures) {
                const sys = layout.systems[lm.system];
                if (y >= sys.top && y <= sys.top + sys.height && x >= lm.x && x <= lm.x + lm.width)
                    return lm.index;
            }
            return null;
        },
    };
}
function cursorAt(layout, beat) {
    const ms = layout.measures;
    if (ms.length === 0)
        return null;
    let lm = ms[0];
    for (const m of ms)
        if (m.start <= beat + 1e-6)
            lm = m;
    const sys = layout.systems[lm.system];
    const marks = lm.marks;
    let x = marks[0].x;
    if (beat <= marks[0].beat) {
        x = marks[0].x;
    }
    else {
        for (let i = 0; i < marks.length; i++) {
            const a = marks[i];
            const nextBeat = i + 1 < marks.length ? marks[i + 1].beat : lm.end;
            const nextX = i + 1 < marks.length ? marks[i + 1].x : lm.x + lm.width - 4;
            if (beat < nextBeat || i === marks.length - 1) {
                const f = Math.max(0, Math.min(1, (beat - a.beat) / (nextBeat - a.beat || 1)));
                x = a.x + f * (nextX - a.x);
                break;
            }
        }
    }
    const top = sys.staffTops[0] - 2 * S;
    const bottom = sys.staffTops[sys.staffTops.length - 1] + STAFF_H + 2 * S;
    return { x, system: sys.index, top, height: bottom - top };
}
function drawSystemFrame(g, sys, layout) {
    sys.staffTops.forEach((top, si) => {
        const clef = sys.staffClefs?.[si] ?? layout.staves[si].clef;
        for (let i = 0; i < 5; i++) {
            el('line', { x1: sys.x0, x2: sys.x1, y1: top + i * S, y2: top + i * S, class: 'staff-line' }, g);
        }
        drawClef(g, clef, sys.headerX + 4, top);
        let x = sys.headerX + 40;
        for (const d of keySignaturePositions(sys.fifths, clef)) {
            const t = el('text', { x, y: yOf(top, clef, d) + (sys.fifths < 0 ? -2 : 0), class: 'accidental key' }, g);
            t.textContent = sys.fifths > 0 ? '♯' : '♭';
            x += 8;
        }
        if (sys.showTime) {
            const tx = x + (sys.fifths ? 8 : 2);
            const a = el('text', { x: tx, y: top + S, class: 'timesig' }, g);
            a.textContent = String(sys.time[0]);
            const b = el('text', { x: tx, y: top + 3 * S, class: 'timesig' }, g);
            b.textContent = String(sys.time[1]);
        }
    });
    const yTop = sys.staffTops[0];
    const yBot = sys.staffTops[sys.staffTops.length - 1] + STAFF_H;
    el('line', { x1: sys.x0, x2: sys.x0, y1: yTop, y2: yBot, class: 'barline' }, g);
    // 大譜表の括弧（{）: 同じ楽器・奏者の譜表ごと（連弾ならプリモとセコンドに 1 つずつ）。
    // 1 譜表ずつのパートだけなら（MIDI の主旋律＋伴奏など）、従来どおり全体を 1 つの括弧で
    const runs = [];
    layout.staves.forEach((st, si) => {
        const last = runs[runs.length - 1];
        if (last && layout.staves[last[1]].group === st.group)
            last[1] = si;
        else
            runs.push([si, si]);
    });
    const grand = runs.filter(([a, b]) => b > a);
    const braces = grand.length ? grand : sys.staffTops.length > 1 ? [[0, sys.staffTops.length - 1]] : [];
    const bx = sys.x0 - 5;
    for (const [a, b] of braces) {
        const y1 = sys.staffTops[a];
        const y2 = sys.staffTops[b] + STAFF_H;
        const ym = (y1 + y2) / 2;
        const h = y2 - y1;
        el('path', {
            d: `M ${bx} ${y1} C ${bx - 9} ${y1 + h * 0.08}, ${bx + 1} ${ym - h * 0.12}, ${bx - 7} ${ym} C ${bx + 1} ${ym + h * 0.12}, ${bx - 9} ${y2 - h * 0.08}, ${bx} ${y2}`,
            class: 'brace',
        }, g);
    }
    // 大譜表が 2 つ以上（連弾・2 台ピアノ）: 全体を角括弧（[）でまとめる
    if (grand.length >= 2 && grand.length === runs.length) {
        const kx = bx - 13;
        el('path', { d: `M ${kx + 6} ${yTop - 5} Q ${kx} ${yTop - 4} ${kx} ${yTop + 1} L ${kx} ${yBot - 1} Q ${kx} ${yBot + 4} ${kx + 6} ${yBot + 5}`, class: 'system-bracket' }, g);
    }
}
function drawGrace(parent, c, layout) {
    const g = el('g', { class: 'grace' }, parent);
    const sys = layout.systems[layout.measures.find((m) => m.index === c.measure).system];
    const top = sys.staffTops[c.staff];
    const bottomD = bottomLine(c.clef);
    const topD = bottomD + 8;
    const gw = HEAD_W * GRACE_SCALE;
    for (const h of c.heads) {
        for (let d = topD + 2; d <= h.d; d += 2)
            el('line', { x1: c.x - gw * 0.85, x2: c.x + gw * 0.85, y1: yOf(top, c.clef, d), y2: yOf(top, c.clef, d), class: 'ledger' }, g);
        for (let d = bottomD - 2; d >= h.d; d -= 2)
            el('line', { x1: c.x - gw * 0.85, x2: c.x + gw * 0.85, y1: yOf(top, c.clef, d), y2: yOf(top, c.clef, d), class: 'ledger' }, g);
        el('ellipse', { cx: c.x, cy: h.y, rx: gw / 2, ry: S * 0.4 * GRACE_SCALE, transform: `rotate(-20 ${c.x} ${h.y})`, class: 'head grace-head' }, g);
        if (h.accidental && h.accX !== undefined) {
            const t = el('text', { x: h.accX, y: h.y + (h.accidental === '♭' ? -1.5 : 0), class: 'accidental grace-acc' }, g);
            t.textContent = h.accidental;
        }
    }
    el('line', { x1: c.stemX, x2: c.stemX, y1: c.stemY1, y2: c.stemY2, class: 'stem grace-stem' }, g);
    const dir = c.stemUp ? 1 : -1;
    for (let i = 0; i < c.flags; i++) {
        const sx = c.stemX;
        const ey = c.stemY2 + dir * i * 7 * GRACE_SCALE;
        el('path', {
            d: `M ${sx} ${ey} C ${sx} ${ey + dir * 7}, ${sx + 9} ${ey + dir * 10}, ${sx + 7} ${ey + dir * 20} C ${sx + 7} ${ey + dir * 13}, ${sx + 3} ${ey + dir * 10}, ${sx} ${ey + dir * 9} Z`,
            transform: `translate(${sx} ${ey}) scale(${GRACE_SCALE}) translate(${-sx} ${-ey})`,
            class: 'flag',
        }, g);
    }
    if (c.slash) {
        // 符幹の先の近くを、左下から右上へ斜めに横切る線
        const y = c.stemY2 + dir * 1.1 * S;
        el('line', { x1: c.stemX - 0.55 * S, y1: y + dir * 0.45 * S, x2: c.stemX + 0.65 * S, y2: y - dir * 0.45 * S, class: 'grace-slash' }, g);
    }
}
/** (x1, y1) から (x2, y2) への波線 */
function wavyPath(x1, y1, x2, y2) {
    const len = Math.hypot(x2 - x1, y2 - y1);
    const n = Math.max(2, Math.round(len / (0.9 * S)));
    const ux = (x2 - x1) / len;
    const uy = (y2 - y1) / len;
    const amp = 0.3 * S;
    let d = `M ${x1} ${y1}`;
    for (let i = 1; i <= n; i++) {
        const t = (i - 0.5) / n;
        const side = i % 2 ? 1 : -1;
        const cx = x1 + (x2 - x1) * t - uy * amp * side;
        const cy = y1 + (y2 - y1) * t + ux * amp * side;
        d += ` Q ${cx} ${cy} ${x1 + (x2 - x1) * (i / n)} ${y1 + (y2 - y1) * (i / n)}`;
    }
    return d;
}
/** 𝄋（S 字と斜線、2 つの点）・𝄌（楕円と十字） */
function drawSign(parent, s) {
    const { x, y } = s;
    const g = el('g', { class: `sign sign-${s.kind}` }, parent);
    if (s.kind === 'coda') {
        el('ellipse', { cx: x, cy: y, rx: 0.55 * S, ry: 0.75 * S, class: 'sign-stroke' }, g);
        el('path', { d: `M ${x - 0.95 * S} ${y} L ${x + 0.95 * S} ${y} M ${x} ${y - 1.1 * S} L ${x} ${y + 1.1 * S}`, class: 'sign-line' }, g);
        return;
    }
    const w = 0.5 * S;
    const h = 0.9 * S;
    el('path', {
        d: `M ${x + w} ${y - h * 0.55} C ${x + w} ${y - h * 1.1}, ${x - w} ${y - h * 1.1}, ${x - w} ${y - h * 0.5}`
            + ` C ${x - w} ${y}, ${x + w} ${y}, ${x + w} ${y + h * 0.5} C ${x + w} ${y + h * 1.1}, ${x - w} ${y + h * 1.1}, ${x - w} ${y + h * 0.55}`,
        class: 'sign-stroke',
    }, g);
    el('line', { x1: x - 0.85 * S, y1: y + 1.05 * S, x2: x + 0.85 * S, y2: y - 1.05 * S, class: 'sign-line' }, g);
    el('circle', { cx: x - 0.75 * S, cy: y + 0.25 * S, r: 0.18 * S, class: 'sign-dot' }, g);
    el('circle', { cx: x + 0.75 * S, cy: y - 0.25 * S, r: 0.18 * S, class: 'sign-dot' }, g);
}
function drawMark(g, m) {
    const { x, y } = m;
    const dir = m.above ? -1 : 1;
    switch (m.kind) {
        case 'staccato':
            el('circle', { cx: x, cy: y, r: 0.2 * S, class: 'mark' }, g);
            break;
        case 'staccatissimo':
            el('path', { d: `M ${x - 0.18 * S} ${y - dir * 0.4 * S} L ${x + 0.18 * S} ${y - dir * 0.4 * S} L ${x} ${y + dir * 0.4 * S} Z`, class: 'mark' }, g);
            break;
        case 'tenuto':
            el('line', { x1: x - 0.6 * S, x2: x + 0.6 * S, y1: y, y2: y, class: 'mark-line' }, g);
            break;
        case 'accent':
            el('path', { d: `M ${x - 0.65 * S} ${y - 0.4 * S} L ${x + 0.65 * S} ${y} L ${x - 0.65 * S} ${y + 0.4 * S}`, class: 'mark-line' }, g);
            break;
        case 'strong-accent':
            el('path', { d: `M ${x - 0.45 * S} ${y - dir * 0.45 * S} L ${x} ${y + dir * 0.45 * S} L ${x + 0.45 * S} ${y - dir * 0.45 * S}`, class: 'mark-line' }, g);
            break;
        case 'fermata': {
            const r = 0.9 * S;
            const base = y + dir * -0.3 * S;
            el('path', { d: `M ${x - r} ${base} A ${r} ${r} 0 0 ${m.above ? 1 : 0} ${x + r} ${base}`, class: 'mark-line' }, g);
            el('circle', { cx: x, cy: base + dir * 0.25 * S, r: 0.18 * S, class: 'mark' }, g);
            break;
        }
    }
}
function drawClef(g, clef, x, top) {
    const shape = clefShape(clef);
    if (shape.octave) {
        // オクターブ付き: 下（8vb）または上（8va）に小さな 8
        const t = el('text', { x: x + (shape.sign === 'G' ? 10 : 12), y: shape.octave < 0 ? top + STAFF_H + (shape.sign === 'G' ? 2.6 : 1.4) * S : top - (shape.sign === 'G' ? 2.4 : 0.6) * S, class: 'clef-octave' }, g);
        t.textContent = '8';
    }
    if (shape.sign === 'C') {
        // ハ音記号: 中心（くびれ）が第 3 線（アルト）か第 4 線（テナー）
        const cy = top + STAFF_H - (shape.line - 1) * S;
        el('rect', { x, y: cy - 2 * S, width: 3.2, height: 4 * S, class: 'clef-fill' }, g);
        el('rect', { x: x + 4.6, y: cy - 2 * S, width: 1.2, height: 4 * S, class: 'clef-fill' }, g);
        for (const dir of [-1, 1]) {
            el('path', {
                d: `M ${x + 5.8} ${cy} L ${x + 9} ${cy + dir * 0.9 * S} C ${x + 11} ${cy + dir * 0.3 * S}, ${x + 12} ${cy + dir * 0.2 * S}, ${x + 13} ${cy + dir * 0.6 * S}`
                    + ` C ${x + 20} ${cy + dir * 0.5 * S}, ${x + 21} ${cy + dir * 1.9 * S}, ${x + 14} ${cy + dir * 2 * S} C ${x + 10} ${cy + dir * 2.05 * S}, ${x + 9} ${cy + dir * 1.6 * S}, ${x + 11} ${cy + dir * 1.35 * S}`,
                class: 'clef-stroke',
            }, g);
        }
        return;
    }
    if (shape.sign === 'G') {
        const gy = top + 3 * S; // G4 の線
        el('path', {
            d: `M ${x + 9} ${gy + 1} C ${x + 3} ${gy + 1}, ${x + 3} ${gy - 7}, ${x + 10} ${gy - 7}
          C ${x + 18} ${gy - 7}, ${x + 19} ${gy + 8}, ${x + 9} ${gy + 9}
          C ${x - 1} ${gy + 9}, ${x - 3} ${gy - 6}, ${x + 5} ${gy - 13}
          C ${x + 11} ${gy - 18}, ${x + 16} ${gy - 27}, ${x + 14} ${gy - 34}
          C ${x + 12} ${gy - 40}, ${x + 6} ${gy - 35}, ${x + 7} ${gy - 26}
          L ${x + 11} ${gy + 19}
          C ${x + 12} ${gy + 25}, ${x + 6} ${gy + 27}, ${x + 4} ${gy + 23}`,
            class: 'clef-stroke',
        }, g);
        el('circle', { cx: x + 6, cy: gy + 22, r: 2.7, class: 'clef-fill' }, g);
    }
    else {
        const fy = top + S; // F3 の線
        el('circle', { cx: x + 5, cy: fy, r: 3.3, class: 'clef-fill' }, g);
        el('path', {
            d: `M ${x + 3} ${fy} C ${x + 3} ${fy - 10}, ${x + 21} ${fy - 11}, ${x + 21} ${fy + 2} C ${x + 21} ${fy + 13}, ${x + 11} ${fy + 20}, ${x + 2} ${fy + 25}`,
            class: 'clef-stroke bass',
        }, g);
        el('circle', { cx: x + 26, cy: fy - S / 2, r: 1.8, class: 'clef-fill' }, g);
        el('circle', { cx: x + 26, cy: fy + S / 2, r: 1.8, class: 'clef-fill' }, g);
    }
}
function drawChord(parent, c, layout, heads) {
    const g = el('g', { class: 'chord', 'data-part': c.partId }, parent);
    const sys = layout.systems[layout.measures.find((m) => m.index === c.measure).system];
    const top = sys.staffTops[c.staff];
    const clef = c.clef ?? layout.staves[c.staff].clef;
    const bottomD = bottomLine(clef);
    const topD = bottomD + 8;
    // 加線
    for (const h of c.heads) {
        const lx1 = h.x - HEAD_W * 0.85;
        const lx2 = h.x + HEAD_W * 0.85;
        for (let d = topD + 2; d <= h.d; d += 2)
            el('line', { x1: lx1, x2: lx2, y1: yOf(top, clef, d), y2: yOf(top, clef, d), class: 'ledger' }, g);
        for (let d = bottomD - 2; d >= h.d; d -= 2)
            el('line', { x1: lx1, x2: lx2, y1: yOf(top, clef, d), y2: yOf(top, clef, d), class: 'ledger' }, g);
    }
    if (c.type !== 'w') {
        el('line', { x1: c.stemX, x2: c.stemX, y1: c.stemY1, y2: c.stemY2, class: 'stem' }, g);
    }
    if (c.flagged) {
        const n = c.type === 'e' ? 1 : c.type === 's' ? 2 : 3;
        for (let i = 0; i < n; i++) {
            const sx = c.stemX;
            const dir = c.stemUp ? 1 : -1;
            const ey = c.stemY2 + dir * i * 7;
            el('path', {
                d: `M ${sx} ${ey} C ${sx} ${ey + dir * 7}, ${sx + 9} ${ey + dir * 10}, ${sx + 7} ${ey + dir * 20} C ${sx + 7} ${ey + dir * 13}, ${sx + 3} ${ey + dir * 10}, ${sx} ${ey + dir * 9} Z`,
                class: 'flag',
            }, g);
        }
    }
    const hollow = c.type === 'w' || c.type === 'h';
    for (const h of c.heads) {
        const head = el('ellipse', {
            cx: h.x,
            cy: h.y,
            rx: HEAD_W / 2 - (hollow ? 0.8 : 0),
            ry: S * 0.4 - (hollow ? 0.6 : 0),
            transform: `rotate(-20 ${h.x} ${h.y})`,
            class: hollow ? 'head hollow' : 'head',
            'data-note': h.noteId,
        }, g);
        if (!heads.has(h.noteId))
            heads.set(h.noteId, []);
        heads.get(h.noteId).push(head);
        if (h.accidental && h.accX !== undefined) {
            const t = el('text', { x: h.accX, y: h.y + (h.accidental === '♭' ? -2 : 0), class: 'accidental' }, g);
            t.textContent = h.accidental;
        }
        for (let i = 0; i < c.dots; i++) {
            const onLine = (h.d - bottomD) % 2 === 0;
            const maxX = Math.max(...c.heads.map((k) => k.x));
            el('circle', { cx: maxX + HEAD_W / 2 + 4 + i * 4, cy: h.y - (onLine ? S / 2 : 0), r: 1.6, class: 'dot' }, g);
        }
    }
    return g;
}
function drawRest(parent, r) {
    const g = el('g', { class: 'rest' }, parent);
    const x = r.x;
    const t = r.staffTop + (r.dy ?? 0);
    switch (r.type) {
        case 'w':
            el('rect', { x: x - 5.5, y: t + S, width: 11, height: S * 0.5 }, g);
            break;
        case 'h':
            el('rect', { x: x - 5.5, y: t + 2 * S - S * 0.5, width: 11, height: S * 0.5 }, g);
            break;
        case 'q':
            el('path', {
                d: `M ${x - 1.5} ${t + 0.7 * S} L ${x + 3} ${t + 1.8 * S} L ${x - 1} ${t + 2.5 * S} L ${x + 3} ${t + 3.3 * S} Q ${x - 3} ${t + 2.9 * S} ${x + 0.5} ${t + 4.1 * S}`,
                class: 'rest-stroke',
            }, g);
            break;
        default: {
            const n = r.type === 'e' ? 1 : r.type === 's' ? 2 : 3;
            el('line', { x1: x + 3.5, y1: t + 1.4 * S, x2: x - 1, y2: t + (2.6 + n * 0.8) * S, class: 'rest-thin' }, g);
            for (let i = 0; i < n; i++) {
                const cy = t + (1.55 + i) * S;
                el('circle', { cx: x - 2.2 + i * -1, cy, r: 2, class: 'rest-dot' }, g);
                el('path', { d: `M ${x - 2.2 - i} ${cy} Q ${x} ${cy + 2.5} ${x + 3.6 - i * 1.1} ${cy - 1.7 + 0}`, class: 'rest-thin' }, g);
            }
        }
    }
    for (let i = 0; i < r.dots; i++)
        el('circle', { cx: x + 9 + i * 4, cy: t + 1.5 * S, r: 1.5, class: 'dot' }, g);
}
