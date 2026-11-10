/**
 * 楽譜のレイアウト計算（描画とは独立した純粋関数）。
 * Score → 段（システム）・小節・音符の座標を求める。描画は render-svg.ts。
 *
 * 簡易エングレーバーなので、対応範囲は「ピアノ練習用の読みやすい譜面」に絞っている:
 *   音部記号・調号・拍子・臨時記号・付点・連桁・旗・加線・休符・タイ
 * 将来、Verovio などの本格的な描画エンジンに差し替えるときは ScoreRenderer 単位で置き換える想定。
 */
import { diatonic, spellMidi } from "../core/score-utils.js";
import { EPS } from "../core/types.js";
export const S = 9; // 五線の間隔(px)
export const STAFF_H = 4 * S;
const TOP_PAD = 5 * S;
const STAFF_GAP = 7 * S;
const BOTTOM_PAD = 4.5 * S;
const LEFT_MARGIN = 22;
const RIGHT_MARGIN = 10;
const SYSTEM_GAP = 1.5 * S;
export const HEAD_W = 1.2 * S;
/** 休符の形の上端・下端（五線の上端からの線間。render-svg.ts の drawRest と同じ形） */
const REST_BOX = { w: [1, 1.5], h: [1.5, 2], q: [0.7, 4.1], e: [1.2, 3.2], s: [1.2, 4.0], t: [0.7, 4.0] };
/** 元の楽譜の改行に合わせるとき、小節をどこまで縮めてよいか（ふつうの幅に対する比） */
const SOURCE_SQUEEZE = 0.78;
/** 段の途中の音部記号（0.72 倍）がとる幅 */
const CLEF_W = 2.6 * S;
/** 前打音の大きさ（通常の音符に対する比） */
export const GRACE_SCALE = 0.65;
const GRACE_STEP = HEAD_W * GRACE_SCALE + 4; // 前打音の和音どうしの間隔
/** 反復記号（𝄆・𝄇。太線・細線・2 つの点）がとる幅 */
export const REPEAT_W = 10;
const DURATIONS = [
    [4, 'w', 0], [3, 'h', 1], [2, 'h', 0], [1.5, 'q', 1], [1, 'q', 0], [0.75, 'e', 1],
    [0.5, 'e', 0], [0.375, 's', 1], [0.25, 's', 0], [0.125, 't', 0],
];
/** 譜表を分けたパートの元のパート（MusicXML の P1-s1 / P1-s2 → P1） */
export function staffGroupOf(p) {
    return p.id.replace(/-s\d+$/, '');
}
function staffNumberOf(p) {
    return Number(/-s(\d+)$/.exec(p.id)?.[1] ?? 0);
}
// 拍の位置を 1/96 拍に丸める（3 連・6 連・32 分も正しく並ぶように）
const snap = (b) => Math.round(b * 96) / 96;
const TYPE_OF = { breve: 'w', whole: 'w', half: 'h', quarter: 'q', eighth: 'e', '16th': 's', '32nd': 't', '64th': 't', '128th': 't' };
function decompose(len) {
    const out = [];
    let rem = len;
    while (rem > EPS) {
        const d = DURATIONS.find(([v]) => v <= rem + EPS) ?? DURATIONS[DURATIONS.length - 1];
        out.push(d);
        rem -= d[0];
    }
    return out;
}
/** 五線のいちばん下の線の高さ（全音階の番号）。オクターブ付きの音部記号は、同じ見た目で鳴る高さが 1 オクターブずれる */
const BOTTOM_LINE = {
    treble: 30, // E4
    bass: 18, // G2
    alto: 24, // F3
    tenor: 22, // D3
    treble8vb: 23, // E3
    treble8va: 37, // E5
    bass8vb: 11, // G1
    bass8va: 25, // G3
};
export function bottomLine(clef) {
    return BOTTOM_LINE[clef] ?? 30;
}
/** 音部記号の形（ト音・ヘ音・ハ音）と、上下につく「8」 */
export function clefShape(clef) {
    if (clef === 'alto')
        return { sign: 'C', line: 3, octave: 0 };
    if (clef === 'tenor')
        return { sign: 'C', line: 4, octave: 0 };
    const sign = clef.startsWith('treble') ? 'G' : 'F';
    return { sign, line: sign === 'G' ? 2 : 4, octave: clef.endsWith('8vb') ? -1 : clef.endsWith('8va') ? 1 : 0 };
}
export function yOf(staffTop, clef, d) {
    return staffTop + STAFF_H - ((d - bottomLine(clef)) * S) / 2;
}
const SHARP_ORDER = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
const FLAT_ORDER = ['B', 'E', 'A', 'D', 'G', 'C', 'F'];
export function keyAlters(fifths) {
    const out = {};
    if (fifths > 0)
        SHARP_ORDER.slice(0, fifths).forEach((s) => (out[s] = 1));
    if (fifths < 0)
        FLAT_ORDER.slice(0, -fifths).forEach((s) => (out[s] = -1));
    return out;
}
/** 調号の各記号の五線上の位置（全音階番号） */
export function keySignaturePositions(fifths, clef) {
    const sharpT = [38, 35, 39, 36, 33, 37, 34]; // F5 C5 G5 D5 A4 E5 B4
    const flatT = [34, 37, 33, 36, 32, 35, 31]; // B4 E5 A4 D5 G4 C5 F4
    // テナー記号の ♯ だけは並びが違う（F3 C4 G3 D4 A3 E4 B3）
    if (clef === 'tenor' && fifths > 0)
        return [24, 28, 25, 29, 26, 30, 27].slice(0, fifths);
    // ト音記号での位置を、五線の見た目が同じになるようにずらす: ヘ音は 2 オクターブ下、ハ音（アルト・テナーの ♭）は 1 オクターブ下。
    // オクターブ付きの音部記号は、五線の下の線と一緒にずらす
    const sign = clefShape(clef).sign;
    const shift = sign === 'C' ? -7 : sign === 'F' ? -14 + bottomLine(clef) - BOTTOM_LINE.bass : bottomLine(clef) - BOTTOM_LINE.treble;
    const list = fifths >= 0 ? sharpT.slice(0, fifths) : flatT.slice(0, -fifths);
    return list.map((d) => d + shift);
}
function headerWidth(fifths, showTime) {
    return 38 + Math.abs(fifths) * 8 + (fifths ? 6 : 0) + (showTime ? 24 : 0);
}
function beatUnit(m) {
    if (m.denominator === 8 && m.numerator % 3 === 0 && m.numerator > 3)
        return 1.5;
    return 4 / m.denominator;
}
function layoutPass(score, width, spacing, breaks = 'fit') {
    // 高い声部を上の段に。ただし同じ MusicXML のパート（ピアノの右手・左手）の譜表は離さず、楽譜の順（右手が上）に並べる。
    // 連弾では、プリモの右手・左手、セコンドの右手・左手の順になる（譜表ごとに音の高さで並べると、両者の譜表が入り混じる）
    const avg = (ps) => {
        const n = ps.reduce((a, p) => a + p.notes.length, 0);
        return ps.reduce((a, p) => a + p.notes.reduce((s, nt) => s + nt.midi, 0), 0) / Math.max(1, n);
    };
    const byGroup = new Map();
    for (const p of score.parts) {
        const g = staffGroupOf(p);
        byGroup.set(g, [...(byGroup.get(g) ?? []), p]);
    }
    const parts = [...byGroup.values()].sort((a, b) => avg(b) - avg(a)).flatMap((ps) => ps.length > 1 ? [...ps].sort((a, b) => staffNumberOf(a) - staffNumberOf(b)) : ps);
    const staves = parts.map((p) => ({ partId: p.id, clef: p.clef, color: p.color, group: staffGroupOf(p) }));
    const measures = score.measures;
    const nm = measures.length;
    // --- 1. ノートを小節線とタイで表示用の区切り（セグメント）に分割 ---
    const segsBy = staves.map(() => measures.map(() => []));
    const measureIndexAt = (b) => {
        let i = 0;
        while (i + 1 < nm && measures[i + 1].start <= b + EPS)
            i++;
        return i;
    };
    parts.forEach((part, si) => {
        for (const n of part.notes) {
            // 元の楽譜の書き方（音符の種類・付点・声部）があれば、その音符の区切りのまま使う
            const nn = n.notation;
            const pieces = nn?.pieces ?? (nn?.type ? [{ start: n.start, duration: n.duration, notation: nn }] : null);
            if (pieces && pieces.every((pc) => pc.notation.type && TYPE_OF[pc.notation.type])) {
                let prevW = null;
                pieces.forEach((pc, k) => {
                    const st = snap(pc.start);
                    const mi = measureIndexAt(st);
                    const sounding = n.spelling ?? spellMidi(n.midi, measures[mi].fifths);
                    const written = n.ottava ? { ...sounding, octave: sounding.octave - n.ottava } : sounding;
                    const seg = {
                        noteId: n.id,
                        key: `${n.id}:${k}`,
                        spelling: written,
                        start: st,
                        dur: Math.max(snap(pc.duration), 1 / 96),
                        type: TYPE_OF[pc.notation.type],
                        dots: pc.notation.dots ?? 0,
                        tieNext: null,
                        voice: pc.notation.voice ?? nn?.voice ?? '1',
                        notation: { ...nn, articulations: undefined, fermata: undefined, arpeggiate: undefined, glissando: undefined, slurs: undefined, ...pc.notation, pieces: undefined },
                    };
                    if (prevW)
                        prevW.tieNext = seg.key;
                    segsBy[si][mi].push(seg);
                    prevW = seg;
                });
                continue;
            }
            const qs = snap(n.start);
            let qe = snap(n.start + n.duration);
            if (qe <= qs + EPS)
                qe = qs + 0.125;
            let cur = qs;
            let prev = null;
            let segNo = 0;
            while (cur < qe - EPS) {
                const mi = measureIndexAt(cur);
                const m = measures[mi];
                const mEnd = m.start + m.length;
                const pieceEnd = mi === nm - 1 ? qe : Math.min(qe, mEnd);
                // 8va などの下の音は、鳴る高さではなく書かれた高さ（ottava オクターブ下）の位置に描く
                const sounding = n.spelling ?? spellMidi(n.midi, m.fifths);
                const written = n.ottava ? { ...sounding, octave: sounding.octave - n.ottava } : sounding;
                for (const [len, type, dots] of decompose(pieceEnd - cur)) {
                    const seg = {
                        noteId: n.id,
                        key: `${n.id}:${segNo++}`,
                        spelling: written,
                        start: cur,
                        dur: len,
                        type,
                        dots,
                        tieNext: null,
                        voice: '1',
                    };
                    if (prev)
                        prev.tieNext = seg.key;
                    segsBy[si][mi].push(seg);
                    prev = seg;
                    cur += len;
                }
                if (pieceEnd <= cur + EPS && pieceEnd < qe - EPS)
                    cur = pieceEnd;
            }
        }
    });
    // 譜表をまたぐ連桁のまとまり（同じ番号の音が 2 つ以上の譜表にある）
    const beamStaves = new Map();
    segsBy.forEach((bySeg, si) => bySeg.forEach((list) => list.forEach((sg) => {
        const g = sg.notation?.beamGroup;
        if (g === undefined)
            return;
        if (!beamStaves.has(g))
            beamStaves.set(g, new Set());
        beamStaves.get(g).add(si);
    })));
    const scoreHasBeams = parts.some((p) => p.notes.some((n) => n.notation?.beams?.length || n.notation?.pieces?.some((pc) => pc.notation.beams?.length)));
    const crossGroups = new Set([...beamStaves].filter(([, st]) => st.size > 1).map(([g]) => g));
    const crossChords = [];
    // 小節線をまたぐ連桁のまとまり（同じ譜表の 2 つ以上の小節にある）。MusicXML として整ったものだけ:
    // 拍の順に、最初の音が begin・最後が end・あいだが continue（閉じない連桁などを、小節をまたぐ連桁として補わない）
    const barGroups = new Set();
    segsBy.forEach((bySeg) => {
        const segs = new Map();
        bySeg.forEach((list, mi) => list.forEach((seg) => {
            const g = seg.notation?.beamGroup;
            if (g === undefined || crossGroups.has(g))
                return;
            if (!segs.has(g))
                segs.set(g, []);
            segs.get(g).push({ mi, seg });
        }));
        for (const [g, list] of segs) {
            if (new Set(list.map((x) => x.mi)).size < 2)
                continue;
            // 和音の音は同じ拍に並ぶので、拍ごとに 1 つの印にまとめる
            const byStart = new Map();
            for (const { seg } of list.sort((a, b) => a.seg.start - b.seg.start)) {
                if (!byStart.has(seg.start))
                    byStart.set(seg.start, seg.notation?.beams?.[0]);
            }
            const marks = [...byStart.values()];
            if (marks[0] === 'begin' && marks[marks.length - 1] === 'end' && marks.slice(1, -1).every((m) => m === 'continue')
                && new Set(list.map((x) => x.seg.voice)).size === 1)
                barGroups.add(g);
        }
    });
    const barChords = [];
    const chordDrafts = measures.map(() => []);
    const restDrafts = measures.map(() => []);
    const onsetWeights = [];
    const minWidths = [];
    const graceDrafts = measures.map(() => []);
    parts.forEach((p, si) => {
        const byKey = new Map();
        for (const g of p.graces ?? []) {
            const st = snap(g.start);
            const mi = measureIndexAt(st);
            const k = `${mi}:${st}:${g.voice}`;
            if (!byKey.has(k)) {
                const d = { staff: si, start: st, voice: g.voice, chords: [] };
                byKey.set(k, d);
                graceDrafts[mi].push(d);
            }
            const d = byKey.get(k);
            const last = d.chords[d.chords.length - 1];
            if (last && last[0].group === g.group)
                last.push(g);
            else
                d.chords.push([g]);
        }
    });
    const graceWidth = (d) => d.chords.length * GRACE_STEP + (d.chords.some((c) => c.some((g) => g.spelling.alter !== 0 || g.accidental)) ? 7 : 0) + 4.5;
    // 音部記号の変更: 小節線の上（前の小節の終わり・次の小節の頭）の変更は、前の小節の終わり（小節線の手前）に描く。
    // そのぶん前の小節の終わりに場所をとる（endClef）。小節の途中の変更は、その拍の音の前に場所をとる（clefAt の拍に pre を足す）
    const endClef = measures.map(() => false);
    const midClefBeats = measures.map(() => new Set());
    parts.forEach((p) => {
        for (const cc of p.clefChanges ?? []) {
            const mi = measureIndexAt(cc.beat);
            if (Math.abs(measures[mi].start - cc.beat) < EPS) {
                if (mi > 0)
                    endClef[mi - 1] = true;
            }
            else
                midClefBeats[mi].add(snap(cc.beat));
        }
    });
    measures.forEach((m, mi) => {
        const mEnd = m.start + m.length;
        staves.forEach((_, si) => {
            const segs = segsBy[si][mi];
            const groups = new Map();
            for (const s of segs) {
                // 同じ声部・同じ位置・同じ長さの音を 1 つの和音にする（声部が違えば別の和音: 符幹の向きも別）
                const k = `${s.voice}:${s.start}:${s.dur}`;
                if (!groups.has(k))
                    groups.set(k, { staff: si, start: s.start, dur: s.dur, type: s.type, dots: s.dots, segs: [], voice: s.voice, notation: s.notation });
                groups.get(k).segs.push(s);
            }
            const chords = [...groups.values()].sort((a, b) => a.start - b.start);
            // 和音の記譜（連桁・符幹など）は、<beam> を持つ音のものを使う（MusicXML では和音の最初の音にだけ書くことが多く、
            // モデルの中の音の順はそれと限らない）
            for (const c of chords) {
                const withBeam = c.segs.find((sg) => sg.notation?.beams?.length);
                if (withBeam)
                    c.notation = withBeam.notation;
            }
            chordDrafts[mi].push(...chords);
            // 楽譜に休符が書いてあれば（MusicXML）、それをそのまま使う
            const notated = parts[si].rests;
            if (notated) {
                for (const r of notated) {
                    const rs = snap(r.start);
                    if (rs < m.start - EPS || rs >= mEnd - EPS)
                        continue;
                    const full = !!r.measure || (Math.abs(r.duration - m.length) < EPS && (r.notation.type === 'whole' || !r.notation.type));
                    const t = r.notation.type && TYPE_OF[r.notation.type];
                    const [len, type, dots] = t ? [r.duration, t, r.notation.dots ?? 0] : decompose(r.duration)[0];
                    restDrafts[mi].push({ staff: si, start: rs, dur: len, type: full ? 'w' : type, dots: full ? 0 : dots, whole: full, voice: r.notation.voice ?? '1', fermata: !!r.notation.fermata, fermataPlacement: r.notation.fermataPlacement });
                }
                if (chords.length === 0 && !restDrafts[mi].some((r) => r.staff === si)) {
                    restDrafts[mi].push({ staff: si, start: m.start, dur: m.length, type: 'w', dots: 0, whole: true, voice: '1' });
                }
                return;
            }
            if (chords.length === 0) {
                restDrafts[mi].push({ staff: si, start: m.start, dur: m.length, type: 'w', dots: 0, whole: true, voice: '1' });
                return;
            }
            let cursor = m.start;
            const pushRest = (a, b) => {
                let t = a;
                for (const [len, type, dots] of decompose(b - a)) {
                    restDrafts[mi].push({ staff: si, start: t, dur: len, type, dots, whole: false, voice: '1' });
                    t += len;
                }
            };
            for (const c of chords) {
                if (c.start > cursor + EPS)
                    pushRest(cursor, c.start);
                cursor = Math.max(cursor, c.start + c.dur);
            }
            if (cursor < mEnd - EPS)
                pushRest(cursor, mEnd);
        });
        const onsetSet = new Set();
        for (const c of chordDrafts[mi])
            onsetSet.add(c.start);
        for (const r of restDrafts[mi])
            if (!r.whole)
                onsetSet.add(r.start);
        for (const g of graceDrafts[mi])
            onsetSet.add(Math.min(g.start, mEnd - 1 / 96));
        for (const b of midClefBeats[mi])
            onsetSet.add(b);
        if (onsetSet.size === 0)
            onsetSet.add(m.start);
        const onsets = [...onsetSet].sort((a, b) => a - b);
        const weights = onsets.map((b, i) => {
            const next = i + 1 < onsets.length ? onsets[i + 1] : mEnd;
            // 前打音があれば、その拍の前に置き場所をとる（主音の位置は前打音の分だけ右へ）
            const pre = Math.max(0, ...graceDrafts[mi].filter((g) => Math.abs(Math.min(g.start, mEnd - 1 / 96) - b) < EPS).map(graceWidth))
                + ([...midClefBeats[mi]].some((c) => Math.abs(c - b) < EPS) ? CLEF_W : 0);
            return { beat: b, w: 13 + 23 * Math.sqrt(Math.max(next - b, 0.125)) + pre, pre };
        });
        onsetWeights.push(weights);
        const prevM = measures[mi - 1];
        const showTime = !!prevM && (prevM.numerator !== m.numerator || prevM.denominator !== m.denominator);
        minWidths.push(16 + (showTime ? 24 : 0) + weights.reduce((a, w) => a + w.w, 0) + 6 + (endClef[mi] ? CLEF_W : 0) + repeatPad(m));
    });
    // 譜表ごとの、ある拍の位置で効いている音部記号
    const clefAt = (si, beat) => {
        let c = staves[si].clef;
        for (const cc of parts[si].clefChanges ?? [])
            if (cc.beat <= beat + EPS)
                c = cc.clef;
        return c;
    };
    // --- 3. 段（システム）に分ける ---
    const systems = [];
    const lMeasures = [];
    const n = staves.length;
    // 上の譜表より上に出る音（加線の多い音・8va の括弧）のぶん、段の上の余白を広げる（通常の楽譜は変わらない）
    const ottavaIds = new Set(parts.flatMap((p) => p.notes.filter((nt) => nt.ottava).map((nt) => nt.id)));
    const topPadFor = (members) => {
        if (!staves.length)
            return TOP_PAD;
        const topLine = bottomLine(staves[0].clef) + 8;
        let maxD = topLine;
        let ott = false;
        for (const k of members) {
            for (const sg of segsBy[0][k]) {
                maxD = Math.max(maxD, diatonic(sg.spelling));
                ott = ott || ottavaIds.has(sg.noteId);
            }
        }
        const need = ((maxD - topLine) * S) / 2 + 3.5 * S + (ott ? 2.8 * S : 0) + S;
        return Math.max(TOP_PAD, need);
    };
    let mi = 0;
    let top = 0;
    while (mi < nm) {
        const first = measures[mi];
        const before = measures[mi - 1];
        // 拍子は曲の始めと、段の頭で拍子が変わるときに書く
        const showTime = mi === 0 || before.numerator !== first.numerator || before.denominator !== first.denominator;
        const header = headerWidth(first.fifths, showTime);
        const avail = width - LEFT_MARGIN - RIGHT_MARGIN - header;
        let sum = 0;
        const members = [];
        const useSource = breaks === 'source' && measures.some((x) => x.newSystem);
        // 元の楽譜の改行のときは、元の 1 段を、小節の幅を SOURCE_SQUEEZE まで縮めてでも 1 段に入れる（それでも入らなければ分ける）
        const cap = useSource ? avail / SOURCE_SQUEEZE : avail;
        while (mi < nm && (members.length === 0 || (sum + minWidths[mi] <= cap && !(useSource && measures[mi].newSystem)))) {
            sum += minWidths[mi];
            members.push(mi++);
        }
        const isLastSystem = mi >= nm;
        let scale = avail / sum;
        if (isLastSystem && scale > 1.35)
            scale = 1;
        if (scale < 1)
            scale = avail / sum; // 1 小節が収まらない場合は縮める
        const sysIndex = systems.length;
        const sp = spacing?.[sysIndex];
        const topPad = topPadFor(members) + (sp?.top ?? 0);
        const gaps = staves.slice(1).map((_, k) => STAFF_GAP + (sp?.gaps[k] ?? 0));
        const staffTops = [];
        staves.forEach((_, k) => staffTops.push(k === 0 ? top + topPad : staffTops[k - 1] + STAFF_H + gaps[k - 1]));
        const height = topPad + n * STAFF_H + gaps.reduce((a, g) => a + g, 0) + BOTTOM_PAD + (sp?.bottom ?? 0);
        let x = LEFT_MARGIN + header;
        for (const k of members) {
            const m = measures[k];
            const w = minWidths[k] * scale;
            const prevM = measures[k - 1];
            const showT = !!prevM && k !== members[0] && (prevM.numerator !== m.numerator || prevM.denominator !== m.denominator);
            const leftPad = 16 + (showT ? 24 : 0) + (m.repeat?.forward ? REPEAT_W : 0);
            const inner = w - leftPad - 6 - (endClef[k] ? CLEF_W : 0) - (m.repeat?.backward ? REPEAT_W : 0);
            const totalW = onsetWeights[k].reduce((a, o) => a + o.w, 0);
            let cx = x + leftPad;
            const marks = onsetWeights[k].map((o) => {
                const mark = { beat: o.beat, x: cx + (o.pre / totalW) * inner };
                cx += (o.w / totalW) * inner;
                return mark;
            });
            lMeasures.push({
                index: k,
                number: m.number,
                system: sysIndex,
                x,
                width: w,
                showTime: showT,
                time: [m.numerator, m.denominator],
                marks,
                start: m.start,
                end: m.start + m.length,
                isLast: k === nm - 1,
                ...(m.barEnd ? { barEnd: m.barEnd } : {}),
                ...(m.repeat ? { repeat: m.repeat } : {}),
            });
            x += w;
        }
        systems.push({
            index: sysIndex,
            top,
            height,
            staffTops,
            x0: LEFT_MARGIN,
            x1: x,
            headerX: LEFT_MARGIN,
            fifths: first.fifths,
            showTime,
            time: [first.numerator, first.denominator],
            firstMeasure: members[0],
            staffClefs: staves.map((_, k) => clefAt(k, first.start)),
        });
        top += height + SYSTEM_GAP;
    }
    // --- 4. 音符・休符の座標 ---
    const chords = [];
    const rests = [];
    const graces = [];
    const graceBeams = [];
    const beams = [];
    const tuplets = [];
    const tremolos = [];
    const marks = [];
    const arpeggios = [];
    // 符幹の長さは連桁で決まるので、記号は連桁を組んだあとに置く
    const markJobs = [];
    const glissEnds = [];
    const headPos = new Map();
    const segChord = new Map();
    const slurEnds = [];
    const segTie = new Map();
    for (const lm of lMeasures) {
        const m = measures[lm.index];
        const sys = systems[lm.system];
        const xAt = (b) => lm.marks.find((mk) => Math.abs(mk.beat - b) < EPS)?.x ?? lm.marks[0].x;
        staves.forEach((st, si) => {
            const staffTop = sys.staffTops[si];
            // 臨時記号の管理（小節内で持続）
            const keyAlt = keyAlters(m.fifths);
            const current = new Map();
            const myChords = chordDrafts[lm.index].filter((c) => c.staff === si).sort((a, b) => a.start - b.start);
            const voices = [...new Set(myChords.map((c) => c.voice).concat(restDrafts[lm.index].filter((r) => r.staff === si).map((r) => r.voice)))].sort();
            const multi = voices.length > 1;
            const lchords = [];
            const drafts = new Map();
            // 前打音の臨時記号は、主音より前に（小節の中の臨時記号の状態に）数える
            const myGraces = graceDrafts[lm.index].filter((g) => g.staff === si).sort((a, b) => a.start - b.start);
            const graceAcc = new Map();
            let gi = 0;
            const takeGraces = (upTo) => {
                for (; gi < myGraces.length && myGraces[gi].start <= upTo + EPS; gi++) {
                    for (const ch of myGraces[gi].chords) {
                        for (const g of ch) {
                            const w = g.ottava ? { ...g.spelling, octave: g.spelling.octave - g.ottava } : g.spelling;
                            const key = `${w.step}${w.octave}`;
                            const expected = current.get(key) ?? keyAlt[w.step] ?? 0;
                            const sym = { 1: '♯', [-1]: '♭', 0: '♮', 2: '𝄪', [-2]: '𝄫' }[w.alter];
                            if (w.alter !== expected || g.accidental)
                                graceAcc.set(g, sym);
                            current.set(key, w.alter);
                        }
                    }
                }
            };
            for (const c of myChords) {
                takeGraces(c.start);
                const x = xAt(c.start);
                const clef = clefAt(si, c.start);
                const mid = bottomLine(clef) + 4;
                const ds = c.segs.map((s) => diatonic(s.spelling));
                const maxD = Math.max(...ds);
                const minD = Math.min(...ds);
                // 符幹の向き: 元の楽譜の指定 → 声部が複数なら上の声部は上向き・下の声部は下向き → 音の高さから
                const up = c.notation?.stem ? c.notation.stem === 'up' : multi ? voices.indexOf(c.voice) % 2 === 0 : maxD - mid <= mid - minD;
                const heads = c.segs
                    .map((s) => {
                    const d = diatonic(s.spelling);
                    const key = `${s.spelling.step}${s.spelling.octave}`;
                    const expected = current.get(key) ?? keyAlt[s.spelling.step] ?? 0;
                    let accidental;
                    const tiedFromPrev = [...segTie.values()].includes(s.key);
                    if ((s.spelling.alter !== expected || s.notation?.accidental) && !tiedFromPrev) {
                        accidental = { 1: '♯', [-1]: '♭', 0: '♮', 2: '𝄪', [-2]: '𝄫' }[s.spelling.alter];
                    }
                    current.set(key, s.spelling.alter);
                    if (s.tieNext)
                        segTie.set(s.key, s.tieNext);
                    return { noteId: s.noteId, segKey: s.key, d, x, y: yOf(staffTop, clef, d), accidental };
                })
                    .sort((a, b) => a.d - b.d);
                // 2 度でぶつかる符頭をずらす
                const order = up ? heads : [...heads].reverse();
                let prevShifted = false;
                for (let i = 1; i < order.length; i++) {
                    if (Math.abs(order[i].d - order[i - 1].d) === 1 && !prevShifted) {
                        order[i].x += up ? HEAD_W - 1 : -(HEAD_W - 1);
                        prevShifted = true;
                    }
                    else
                        prevShifted = false;
                }
                // 臨時記号を左にずらしながら配置
                let col = 0;
                let lastAccD = Infinity;
                const minHeadX = Math.min(...heads.map((h) => h.x));
                for (const h of [...heads].reverse()) {
                    if (!h.accidental)
                        continue;
                    col = lastAccD - h.d < 6 ? col + 1 : 0;
                    h.accX = minHeadX - HEAD_W / 2 - 6 - col * 8;
                    lastAccD = h.d;
                }
                const topY = Math.min(...heads.map((h) => h.y));
                const botY = Math.max(...heads.map((h) => h.y));
                const midY = yOf(staffTop, clef, mid);
                const stemX = up ? x + HEAD_W / 2 - 0.7 : x - HEAD_W / 2 + 0.7;
                let stemY2 = up ? topY - 3.5 * S : botY + 3.5 * S;
                if (!multi && up && stemY2 > midY)
                    stemY2 = midY;
                if (!multi && !up && stemY2 < midY)
                    stemY2 = midY;
                const ch = {
                    staff: si,
                    partId: st.partId,
                    measure: lm.index,
                    start: c.start,
                    dur: c.dur,
                    type: c.type,
                    dots: c.dots,
                    x,
                    heads,
                    stemUp: up,
                    stemX,
                    stemY1: up ? botY : topY,
                    stemY2,
                    flagged: c.type === 'e' || c.type === 's' || c.type === 't',
                    clef,
                    ...(c.notation?.beamGroup !== undefined ? { beamGroup: c.notation.beamGroup } : {}),
                };
                for (const h of heads) {
                    headPos.set(h.segKey, { x: h.x, y: h.y, system: lm.system, up, end: lm.x + lm.width });
                    segChord.set(h.segKey, ch);
                }
                // 同じ音で終わって始まるスラーは、終わりを先に
                for (const sg of c.segs) {
                    for (const sl of [...(sg.notation?.slurs ?? [])].sort((a, b) => (a.type === 'stop' ? 0 : 1) - (b.type === 'stop' ? 0 : 1))) {
                        slurEnds.push({ si, segKey: sg.key, type: sl.type, number: sl.number, placement: sl.placement, multi, beat: c.start });
                    }
                }
                markJobs.push(() => placeMarks(ch, c, multi, staffTop, lm.index, marks, arpeggios));
                for (const sg of c.segs) {
                    for (const g of sg.notation?.glissando ?? []) {
                        glissEnds.push({ si, segKey: sg.key, type: g.type, number: g.number, wavy: g.line === 'wavy', order: glissEnds.length });
                    }
                }
                lchords.push(ch);
                chords.push(ch);
                drafts.set(ch, c);
            }
            takeGraces(Infinity);
            // 前打音の位置: 主音（同じ拍の和音）の左端（臨時記号を含む）から左へ、和音ごとに並べる
            for (const gd of myGraces) {
                const at = lchords.filter((ch) => Math.abs(ch.start - gd.start) < EPS);
                const left = at.length
                    ? Math.min(...at.flatMap((ch) => ch.heads.map((h) => h.accX ?? h.x - HEAD_W / 2)))
                    : xAt(Math.min(gd.start, m.start + m.length - 1 / 96)) - HEAD_W / 2;
                const clef = clefAt(si, gd.start);
                const gw = HEAD_W * GRACE_SCALE;
                const lowerVoice = multi && voices.indexOf(gd.voice) % 2 === 1;
                const placed = [];
                let x = left - 4.5 - gw / 2;
                for (let k = gd.chords.length - 1; k >= 0; k--) {
                    const ch = gd.chords[k];
                    const hasAcc = ch.some((g) => graceAcc.has(g));
                    const heads = ch.map((g) => {
                        const w = g.ottava ? { ...g.spelling, octave: g.spelling.octave - g.ottava } : g.spelling;
                        const d = diatonic(w);
                        return { d, y: yOf(staffTop, clef, d), accidental: graceAcc.get(g), accX: graceAcc.has(g) ? x - gw / 2 - 5 : undefined };
                    }).sort((a, b) => a.d - b.d);
                    const stem = ch[0].notation.stem;
                    const up = stem ? stem === 'up' : !lowerVoice;
                    const top = Math.min(...heads.map((h) => h.y));
                    const bot = Math.max(...heads.map((h) => h.y));
                    const stemX = up ? x + gw / 2 - 0.5 : x - gw / 2 + 0.5;
                    const flagsOf = { eighth: 1, '16th': 2, '32nd': 3 };
                    placed.unshift({
                        staff: si, measure: lm.index, x, heads, clef, stemUp: up, stemX,
                        stemY1: up ? bot : top, stemY2: up ? top - 2.6 * S : bot + 2.6 * S,
                        flags: flagsOf[ch[0].notation.type ?? 'eighth'] ?? 0, slash: ch[0].slash,
                    });
                    x -= GRACE_STEP + (hasAcc ? 7 : 0);
                }
                // 2 つ以上の前打音（旗のある種類）は連桁でつなぐ
                if (placed.length > 1 && placed.every((g) => g.flags > 0 && g.stemUp === placed[0].stemUp)) {
                    const up = placed[0].stemUp;
                    const y = up ? Math.min(...placed.map((g) => g.stemY2)) : Math.max(...placed.map((g) => g.stemY2));
                    for (const g of placed)
                        g.stemY2 = y;
                    graceBeams.push({ x1: placed[0].stemX, y1: y, x2: placed[placed.length - 1].stemX, y2: y, up, levels: Math.min(...placed.map((g) => g.flags)) });
                    for (const g of placed)
                        g.flags = 0;
                }
                // 前打音のスラーの始まり・終わり: 前打音の和音を、スラーの端として主音と同じ一覧に入れる（同じ拍の主音より前の順に）
                placed.forEach((g, k) => {
                    const slurs = gd.chords[k].flatMap((n) => n.notation.slurs ?? []);
                    if (!slurs.length)
                        return;
                    const key = `grace:${si}:${graces.length + k}`;
                    segChord.set(key, {
                        staff: si, partId: staves[si].partId, measure: lm.index, start: gd.start, dur: 0, type: 'e', dots: 0, x: g.x,
                        heads: g.heads.map((h) => ({ noteId: -1, segKey: key, d: h.d, x: g.x, y: h.y })),
                        stemUp: g.stemUp, stemX: g.stemX, stemY1: g.stemY1, stemY2: g.stemY2, flagged: false, clef: g.clef, grace: true,
                    });
                    const beat = gd.start - (placed.length - k) * 1e-6;
                    for (const sl of [...slurs].sort((a, b) => (a.type === 'stop' ? 0 : 1) - (b.type === 'stop' ? 0 : 1))) {
                        slurEnds.push({ si, segKey: key, type: sl.type, number: sl.number, placement: sl.placement, multi, beat });
                    }
                });
                graces.push(...placed);
            }
            const byVoice = new Map();
            for (const ch of lchords) {
                const v = drafts.get(ch).voice;
                if (!byVoice.has(v))
                    byVoice.set(v, []);
                byVoice.get(v).push(ch);
            }
            const notationOf = (ch) => drafts.get(ch).notation;
            // 2 音間のトレモロ（start〜stop）: 符幹のある音なら符幹の先をつなぐ線、全音符なら 2 つの音の間に線
            for (const list of byVoice.values()) {
                for (let i = 0; i + 1 < list.length; i++) {
                    const a = notationOf(list[i])?.tremolo;
                    const b = notationOf(list[i + 1])?.tremolo;
                    if (a?.type === 'start' && b?.type === 'stop') {
                        const ca = list[i];
                        const cb = list[i + 1];
                        ca.flagged = cb.flagged = false;
                        const up = ca.stemUp;
                        if (ca.type !== 'w' && cb.type !== 'w' && cb.stemUp === up) {
                            // 符幹のある音: 連桁のように、2 つの符幹の先をつなぐ線（符幹は線が収まる長さまで伸ばす）
                            const span = (a.marks - 1) * 0.75 * S + 0.45 * S;
                            const tip = (ch) => {
                                const ys = ch.heads.map((h) => h.y);
                                return up ? Math.min(ch.stemY2, Math.min(...ys) - span - 2 * S) : Math.max(ch.stemY2, Math.max(...ys) + span + 2 * S);
                            };
                            ca.stemY2 = tip(ca);
                            cb.stemY2 = tip(cb);
                            // 描画は線の並びの中心を y に、各線は y から下へ太さ 0.45S: 一番外の線の外側の辺が符幹の先になるように
                            const mid = up ? span / 2 - 0.225 * S : -(span / 2 + 0.225 * S);
                            tremolos.push({ staff: si, measure: lm.index, x1: ca.stemX, x2: cb.stemX, y1: ca.stemY2 + mid, y2: cb.stemY2 + mid, marks: a.marks });
                            continue;
                        }
                        const ya = up ? Math.min(...ca.heads.map((h) => h.y)) - 2.2 * S : Math.max(...ca.heads.map((h) => h.y)) + 2.2 * S;
                        const yb = up ? Math.min(...cb.heads.map((h) => h.y)) - 2.2 * S : Math.max(...cb.heads.map((h) => h.y)) + 2.2 * S;
                        const x1 = ca.type === 'w' ? ca.x + HEAD_W : ca.stemX + 3;
                        const x2 = cb.type === 'w' ? cb.x - HEAD_W : cb.stemX - 3;
                        tremolos.push({ staff: si, measure: lm.index, x1, x2, y1: ya, y2: yb, marks: a.marks });
                    }
                }
            }
            // 1 音のトレモロ: 符幹の上に斜線
            for (const ch of lchords) {
                const t = notationOf(ch)?.tremolo;
                if (t?.type === 'single') {
                    const yMid = (ch.stemY1 + ch.stemY2) / 2;
                    tremolos.push({ staff: si, measure: lm.index, x1: ch.stemX - 4, x2: ch.stemX + 4, y1: yMid + 2, y2: yMid - 2, marks: t.marks });
                }
            }
            // 連桁: 元の楽譜の連桁（MusicXML の <beam>）があればそのとおりに。なければ拍ごとにまとめる。
            // 楽譜のどこかに <beam> があれば、<beam> のない音は旗のまま（書いた人が分けて書いた: Christmas 9 小節の左手の 8 分音符 2 つ）
            const beamsBefore = beams.length;
            const hasBeams = scoreHasBeams || lchords.some((ch) => notationOf(ch)?.beams?.length);
            if (hasBeams) {
                for (const list of byVoice.values()) {
                    let group = [];
                    for (const ch of list) {
                        // 譜表をまたぐ連桁は、あとで両方の譜表の和音をまとめて組む
                        if (ch.beamGroup !== undefined && crossGroups.has(ch.beamGroup)) {
                            ch.flagged = false;
                            crossChords.push({ ch, levels: notationOf(ch)?.beams ?? [] });
                            group = [];
                            continue;
                        }
                        // 小節線をまたぐ連桁も、あとで小節をまたいでまとめて組む
                        if (ch.beamGroup !== undefined && barGroups.has(ch.beamGroup)) {
                            barChords.push({ ch, levels: notationOf(ch)?.beams ?? [], stem: notationOf(ch)?.stem });
                            group = [];
                            continue;
                        }
                        const b1 = notationOf(ch)?.beams?.[0];
                        if (b1 === 'begin')
                            group = [ch];
                        else if ((b1 === 'continue' || b1 === 'end') && group.length)
                            group.push(ch);
                        if (b1 === 'end' || !b1) {
                            if (group.length >= 2) {
                                const lv = group.map((g) => notationOf(g)?.beams ?? []);
                                beams.push({ ...makeBeam(group, staffTop, group[0].clef, bottomLine(group[0].clef) + 4, lv, notationOf(group[0])?.stem), ...(group[0].beamGroup !== undefined ? { group: group[0].beamGroup } : {}) });
                            }
                            group = [];
                        }
                    }
                }
            }
            else {
                const unit = beatUnit(m);
                for (const list of byVoice.values()) {
                    let group = [];
                    const flush = () => {
                        if (group.length >= 2)
                            beams.push(makeBeam(group, staffTop, group[0].clef, bottomLine(group[0].clef) + 4));
                        group = [];
                    };
                    for (const ch of list) {
                        const beamable = ch.flagged;
                        const beatIdx = Math.floor((ch.start - m.start + EPS) / unit);
                        const last = group[group.length - 1];
                        if (beamable &&
                            last &&
                            Math.floor((last.start - m.start + EPS) / unit) === beatIdx &&
                            Math.abs(last.start + last.dur - ch.start) < EPS) {
                            group.push(ch);
                        }
                        else {
                            flush();
                            if (beamable)
                                group = [ch];
                        }
                    }
                    flush();
                }
            }
            for (let i = beamsBefore; i < beams.length; i++) {
                beams[i].staff = si;
                beams[i].measure = lm.index;
            }
            // 連符の数字（と括弧）: <tuplet> の始まり〜終わり、なければ同じ比率の音を actual 個ずつ
            for (const list of byVoice.values()) {
                let run = [];
                let need = 0;
                let number = 0;
                let explicit = false;
                const flush = () => {
                    if (run.length) {
                        const beamed = beams.some((bm) => run.every((ch) => ch.stemX >= Math.min(bm.x1, bm.x2) - 0.5 && ch.stemX <= Math.max(bm.x1, bm.x2) + 0.5));
                        const nt = notationOf(run[0])?.tuplet;
                        // 譜表をまたぐ連桁の連符: 連桁は 2 つの譜表のあいだにあるので、数字は符頭の外側（上の譜表なら上、下の譜表なら下）に
                        const cross = run.some((ch) => ch.beamGroup !== undefined && crossGroups.has(ch.beamGroup));
                        const heads = run.flatMap((ch) => ch.heads.map((h) => h.y));
                        let above = run[0].stemUp;
                        let y;
                        // 元の楽譜が上下を決めていれば（<tuplet placement>）それに従う。連桁と反対の側なら符頭と五線の外側に
                        const placed = nt?.placement !== undefined;
                        if (placed)
                            above = nt.placement === 'above';
                        const beamSide = !cross && beamed && above === run[0].stemUp;
                        if (cross || (placed && !beamSide)) {
                            if (cross && !placed) {
                                // 連符の最初の音が連桁に入っていないこともあるので、譜表をまたぐ連桁に入っている音のまとまりで決める
                                const g = run.find((ch) => ch.beamGroup !== undefined && crossGroups.has(ch.beamGroup)).beamGroup;
                                above = si < staves.length - 1 && staves.length > 1 && si === Math.min(...beamStaves.get(g));
                            }
                            y = above ? Math.min(...heads, staffTop) - 1.5 * S : Math.max(...heads, staffTop + STAFF_H) + 1.8 * S;
                        }
                        else {
                            const ys = run.map((ch) => ch.stemY2);
                            y = above ? Math.min(...ys, ...heads) - 1.3 * S : Math.max(...ys, ...heads) + 1.8 * S;
                        }
                        // 括弧: 書いてあればそれに従い、なければ連桁がないときと、数字が連桁と反対の側にあるとき
                        const bracket = nt?.bracket ?? (!beamed || (placed && !beamSide));
                        if (nt?.showNumber !== false)
                            tuplets.push({ staff: si, measure: lm.index, x1: run[0].x - HEAD_W / 2, x2: run[run.length - 1].x + HEAD_W / 2, y, number, above, bracket, ...(placed ? { placed: true } : {}) });
                    }
                    run = [];
                    explicit = false;
                };
                for (const ch of list) {
                    const t = notationOf(ch)?.tuplet;
                    if (!t) {
                        flush();
                        continue;
                    }
                    if (t.start || !run.length) {
                        flush();
                        number = t.actual;
                        need = t.actual;
                        explicit = !!t.start;
                    }
                    run.push(ch);
                    if (t.stop || (!explicit && run.length >= need))
                        flush();
                }
                flush();
            }
            for (const r of restDrafts[lm.index].filter((r) => r.staff === si)) {
                if (r.fermata) {
                    // 休符のフェルマータ: MusicXML の向き（upright = 上・inverted = 下）。向きがなければ、上の声部（声部が 1 つなら常に）は上、下の声部は下
                    const above = r.fermataPlacement ? r.fermataPlacement === 'above' : !multi || voices.indexOf(r.voice) % 2 === 0;
                    marks.push({ staff: si, measure: lm.index, x: r.whole ? lm.x + lm.width / 2 : xAt(r.start), y: above ? staffTop - S : staffTop + STAFF_H + S, kind: 'fermata', above });
                }
                const rx = r.whole ? lm.x + lm.width / 2 : xAt(r.start);
                let dy = multi && !r.whole ? (voices.indexOf(r.voice) % 2 === 0 ? -1.5 * S : 1.5 * S) : multi && r.whole ? (voices.indexOf(r.voice) % 2 === 0 ? -S : S) : 0;
                if (multi) {
                    // 声部が複数: ほかの声部の符頭（同じ位置のあたり）にかからないところまで、線間ずつ上（上の声部）・下（下の声部）へ
                    const upper = voices.indexOf(r.voice) % 2 === 0;
                    const [b0, b1] = REST_BOX[r.type];
                    const others = lchords.filter((c) => drafts.get(c).voice !== r.voice && Math.abs(c.x - rx) < (r.whole ? lm.width / 2 : 1.6 * HEAD_W));
                    const ys = others.flatMap((c) => c.heads.map((h) => h.y));
                    if (ys.length) {
                        if (upper) {
                            const limit = Math.min(...ys) - 0.9 * S; // 休符の下端
                            const need = limit - (staffTop + dy + b1 * S);
                            if (need < 0)
                                dy += Math.floor(need / S) * S;
                        }
                        else {
                            const limit = Math.max(...ys) + 0.9 * S; // 休符の上端
                            const need = limit - (staffTop + dy + b0 * S);
                            if (need > 0)
                                dy += Math.ceil(need / S) * S;
                        }
                    }
                }
                rests.push({ staff: si, x: rx, staffTop, type: r.type, dots: r.dots, start: r.start, dy });
            }
        });
    }
    // 段の途中の音部記号の変更（段の頭の音部記号は段の枠に描く）
    const clefChanges = [];
    parts.forEach((p, si) => {
        for (const cc of p.clefChanges ?? []) {
            const mi = measureIndexAt(cc.beat);
            const lm = lMeasures.find((x) => x.index === mi);
            if (!lm)
                continue;
            if (Math.abs(measures[mi].start - cc.beat) < EPS) {
                // 小節線の上の変更: 前の小節の終わり（段の終わりなら、段の終わりの予告の音部記号。次の段の頭の音部記号は段の枠が描く）
                const prev = lMeasures.find((x) => x.index === mi - 1);
                if (!prev)
                    continue;
                clefChanges.push({ staff: si, system: prev.system, x: prev.x + prev.width - CLEF_W + 1, clef: cc.clef });
                continue;
            }
            const next = chords.filter((c) => c.staff === si && c.measure === mi && c.start >= cc.beat - EPS).sort((a, b) => a.start - b.start)[0];
            const restNext = rests.filter((r) => r.staff === si && r.start >= cc.beat - EPS && lm.system === systems.findIndex((sy) => sy.staffTops.includes(r.staffTop))).sort((a, b) => a.start - b.start)[0];
            const minX = Math.min(next ? Math.min(...next.heads.map((h) => h.accX ?? h.x - HEAD_W / 2)) : Infinity, restNext && restNext.x > lm.x ? restNext.x - 0.7 * S : Infinity, lm.x + lm.width - 4);
            clefChanges.push({ staff: si, system: lm.system, x: minX - CLEF_W, clef: cc.clef });
        }
    });
    // タイ
    const ties = [];
    for (const [from, to] of segTie) {
        const a = headPos.get(from);
        const b = headPos.get(to);
        if (!a || !b)
            continue;
        if (a.system === b.system)
            ties.push({ x1: a.x + 5, x2: b.x - 5, y: a.y, below: a.up });
        else {
            ties.push({ x1: a.x + 5, x2: systems[a.system].x1 - 2, y: a.y, below: a.up });
            ties.push({ x1: systems[b.system].x0 + headerWidth(systems[b.system].fifths, false) - 6, x2: b.x - 5, y: b.y, below: b.up });
        }
    }
    const crossBeams = layoutCrossStaffBeams(crossChords, systems, lMeasures);
    beams.push(...crossBeams);
    beams.push(...layoutBarlineBeams(barChords, systems, lMeasures));
    // 譜表をまたぐ連桁の連符の数字は、その連桁の上に置き直す（譜表ごとに置いた位置は、もう符幹の先ではない）
    for (const b of crossBeams) {
        for (const t of tuplets) {
            if (t.placed)
                continue;
            if (t.measure === b.measure && t.x1 >= Math.min(b.x1, b.x2) - HEAD_W && t.x2 <= Math.max(b.x1, b.x2) + HEAD_W) {
                t.y = b.y1 - 0.7 * S;
                t.above = true;
                t.bracket = false;
            }
        }
    }
    for (const job of markJobs)
        job();
    const L = {
        width, height: top, staves, systems, measures: lMeasures, chords, rests, beams, ties,
        ottavas: layoutOttavas(score, chords, lMeasures, systems, tuplets), tuplets, tremolos, clefChanges,
        marks, arpeggios, glissandos: pairGlissandos(glissEnds, headPos, systems),
        slurs: layoutSlurs(slurEnds, segChord, chords, systems, lMeasures, parts.map((p) => p.id.replace(/-s\d+$/, ''))),
        graces, graceBeams,
        ...dynamicsAndWedges(parts, lMeasures, systems, chords),
        endings: [],
        signs: [],
    };
    return { ...L, ...layoutRepeatMarks(L) };
}
/** 反復記号のために小節の左右にとる幅 */
const repeatPad = (m) => (m.repeat?.forward ? REPEAT_W : 0) + (m.repeat?.backward ? REPEAT_W : 0);
/**
 * n 番かっこと 𝄋・𝄌 の位置。上の譜表の上で、その範囲の音符・記号・文字より上に置く（段の上の余白は layoutScore が広げる）。
 * かっこは、同じ番号が続く小節を 1 本にまとめ（反復記号で終わる小節で切る）、段ごとに分ける。
 * 𝄌 は、同じ小節の上の譜表に「Coda」「To Coda」の文字があればその右に並べる
 */
function layoutRepeatMarks(L) {
    const endings = [];
    const signs = [];
    if (!L.measures.some((m) => m.repeat))
        return { endings, signs };
    const boxes = occupiedBoxes(L).filter((b) => b.staff === 0 && b.kind !== 'staff');
    const topIn = (system, x1, x2) => Math.min(Infinity, ...boxes.filter((b) => b.system === system && b.x1 < x2 && x1 < b.x2).map((b) => b.y1));
    const ms = L.measures;
    for (let i = 0; i < ms.length; i++) {
        const nums = ms[i].repeat?.ending;
        if (!nums)
            continue;
        const key = nums.join(',');
        let j = i;
        while (j + 1 < ms.length && !ms[j].repeat?.backward && ms[j + 1].repeat?.ending?.join(',') === key)
            j++;
        // 段ごとに分ける
        for (let a = i; a <= j;) {
            let b = a;
            while (b + 1 <= j && ms[b + 1].system === ms[a].system)
                b++;
            const sys = L.systems[ms[a].system];
            const x1 = ms[a].x + (a === i ? 2 : 0);
            const x2 = ms[b].x + ms[b].width - (b === j ? 2 : 0);
            const y = Math.min(sys.staffTops[0] - 2.5 * S, topIn(sys.index, x1, x2) - 1.8 * S);
            endings.push({
                system: sys.index, x1, x2, y, startHook: a === i, closed: b === j && !!ms[j].repeat?.backward,
                ...(a === i ? { label: `${nums.join(', ')}.` } : {}),
            });
            a = b + 1;
        }
        i = j;
    }
    for (const lm of ms) {
        const r = lm.repeat;
        if (!r)
            continue;
        const sys = L.systems[lm.system];
        const place = (kind, x) => {
            // 同じ小節の上の譜表の「Coda」「To Coda」の文字の右に並べる
            const word = kind === 'coda'
                ? L.words.find((w) => w.system === lm.system && w.staff === 0 && w.above && /coda/i.test(w.text) && w.x >= lm.x - 1 && w.x < lm.x + lm.width)
                : undefined;
            if (word) {
                signs.push({ system: lm.system, kind, x: word.x + wordWidth(word.text) + 1.2 * S, y: word.y - 0.4 * S });
                return;
            }
            const over = endings.filter((e) => e.system === lm.system && e.x1 < x + S && x - S < e.x2).map((e) => e.y - 0.4 * S);
            const y = Math.min(sys.staffTops[0] - 2 * S, topIn(lm.system, x - S, x + S) - 1.3 * S, ...over.map((v) => v - 1.2 * S));
            signs.push({ system: lm.system, kind, x, y });
        };
        if (r.segno)
            place('segno', lm.x + 1.2 * S);
        if (r.coda)
            place('coda', lm.x + 1.2 * S);
        if (r.toCoda)
            place('coda', lm.x + lm.width - 1.2 * S);
    }
    return { endings, signs };
}
const OTTAVA_LABEL = { 1: '8va', 2: '15ma', [-1]: '8vb', [-2]: '15mb' };
/** 同じ譜表で続けてオッターヴァの下にある和音を、段ごとに 1 本の括弧にまとめる */
function layoutOttavas(score, chords, lMeasures, systems, tuplets = []) {
    const shiftOf = new Map();
    for (const p of score.parts)
        for (const n of p.notes)
            if (n.ottava)
                shiftOf.set(n.id, n.ottava);
    if (shiftOf.size === 0)
        return [];
    const out = [];
    const byStaff = new Map();
    for (const c of chords) {
        if (!byStaff.has(c.staff))
            byStaff.set(c.staff, []);
        byStaff.get(c.staff).push(c);
    }
    for (const [staff, list] of byStaff) {
        list.sort((a, b) => a.start - b.start || a.x - b.x);
        let run = [];
        let runShift = 0;
        const flush = (continues) => {
            if (!run.length)
                return;
            const sysIndex = lMeasures[run[0].measure].system;
            const sys = systems[sysIndex];
            const staffTop = sys.staffTops[staff];
            const below = runShift < 0;
            const ys = run.flatMap((c) => [...c.heads.map((h) => h.y), c.stemY2]);
            let y = below ? Math.max(staffTop + STAFF_H + 2.6 * S, Math.max(...ys) + 1.6 * S) : Math.min(staffTop - 2.2 * S, Math.min(...ys) - 1.6 * S);
            // 同じ側の連符の数字より外に（8va の線は連符の外側に書く）
            const x1 = run[0].x - HEAD_W / 2;
            const x2 = run[run.length - 1].x + HEAD_W / 2 + 4;
            for (const t of tuplets) {
                if (t.staff !== staff || lMeasures[t.measure].system !== sysIndex || t.above === below || t.x2 < x1 || t.x1 > x2)
                    continue;
                y = below ? Math.max(y, t.y + 1.8 * S) : Math.min(y, t.y - 1.8 * S);
            }
            out.push({
                staff,
                system: sysIndex,
                x1,
                x2,
                y,
                label: OTTAVA_LABEL[runShift] ?? '8va',
                below,
                endHook: !continues,
            });
            run = [];
        };
        for (const c of list) {
            const shift = shiftOf.get(c.heads[0]?.noteId ?? -1) ?? 0;
            const sys = lMeasures[c.measure].system;
            if (run.length && (shift !== runShift || lMeasures[run[0].measure].system !== sys)) {
                // 同じオッターヴァのまま段が変わるなら、鉤を付けずに次の段で続ける
                flush(shift === runShift && shift !== 0);
            }
            if (shift) {
                run.push(c);
                runShift = shift;
            }
        }
        flush(false);
    }
    return out;
}
function makeBeam(group, staffTop, clef, mid, levels, stem) {
    const all = group.flatMap((c) => c.heads.map((h) => h.d));
    const up = stem ? stem === 'up' : Math.max(...all) - mid <= mid - Math.min(...all);
    const midY = yOf(staffTop, clef, mid);
    for (const c of group) {
        c.stemUp = up;
        const xs = c.heads.map((h) => h.x);
        const x = up ? Math.min(...xs) : Math.max(...xs);
        c.stemX = up ? x + HEAD_W / 2 - 0.7 : x - HEAD_W / 2 + 0.7;
        const topY = Math.min(...c.heads.map((h) => h.y));
        const botY = Math.max(...c.heads.map((h) => h.y));
        c.stemY1 = up ? botY : topY;
        c.flagged = false;
    }
    const first = group[0];
    const last = group[group.length - 1];
    const natural = (c) => {
        const topY = Math.min(...c.heads.map((h) => h.y));
        const botY = Math.max(...c.heads.map((h) => h.y));
        return up ? Math.min(topY - 3.25 * S, midY) : Math.max(botY + 3.25 * S, midY);
    };
    let y1 = natural(first);
    let y2 = natural(last);
    const dy = Math.max(-S, Math.min(S, y2 - y1));
    y2 = y1 + dy;
    const x1 = first.stemX;
    const x2 = last.stemX;
    const beamY = (x) => (x2 === x1 ? y1 : y1 + ((x - x1) / (x2 - x1)) * (y2 - y1));
    // すべての符幹が短くなりすぎないように連桁全体をずらす
    let shift = 0;
    for (const c of group) {
        const topY = Math.min(...c.heads.map((h) => h.y));
        const botY = Math.max(...c.heads.map((h) => h.y));
        const by = beamY(c.stemX);
        if (up)
            shift = Math.min(shift, topY - 2.6 * S - by);
        else
            shift = Math.max(shift, botY + 2.6 * S - by);
    }
    y1 += shift;
    y2 += shift;
    for (const c of group)
        c.stemY2 = beamY(c.stemX);
    return { x1, y1, x2, y2, up, secondary: secondaryBeams(group, levels) };
}
/** 2 本目以降の連桁: 元の楽譜の <beam number="2.."> があればそのとおりに。なければ音符の種類から */
function secondaryBeams(group, levels) {
    const secondary = [];
    const levelOf = (c) => (c.type === 's' ? 2 : c.type === 't' ? 3 : 1);
    for (let level = 2; level <= 4; level++) {
        for (let i = 0; i < group.length; i++) {
            const c = group[i];
            const v = levels?.[i]?.[level - 1];
            if (levels) {
                if (v === 'begin' || v === 'continue') {
                    const next = group[i + 1];
                    if (next)
                        secondary.push({ x1: c.stemX, x2: next.stemX, level });
                }
                else if (v === 'forward hook')
                    secondary.push({ x1: c.stemX, x2: c.stemX + S, level });
                else if (v === 'backward hook')
                    secondary.push({ x1: c.stemX - S, x2: c.stemX, level });
                continue;
            }
            if (levelOf(c) < level)
                continue;
            const next = group[i + 1];
            const prev = group[i - 1];
            if (next && levelOf(next) >= level)
                secondary.push({ x1: c.stemX, x2: next.stemX, level });
            else if (!(prev && levelOf(prev) >= level)) {
                const dir = next ? 1 : -1;
                secondary.push({ x1: c.stemX, x2: c.stemX + dir * S, level });
            }
        }
    }
    return secondary;
}
/**
 * 譜表をまたぐ連桁: 同じまとまりの和音を、上の譜表は符幹を下へ、下の譜表は符幹を上へのばし、
 * 2 つの譜表のあいだに 1 本の連桁を渡す（水平）。2 本目以降の線は下側に重ね、上の譜表の符幹はそこまでのばす。
 * 段をまたぐまとまりは組まない（段ごとの和音は旗も連桁もないまま）
 */
/**
 * 小節線をまたぐ連桁: 同じ譜表のまとまりの和音を、小節をまたいで 1 本の連桁にする。
 * 段をまたぐものは段ごとに分けて組む（段の中に 1 つしか和音がなければ旗のまま）
 */
function layoutBarlineBeams(items, systems, measures) {
    const out = [];
    const groups = new Map();
    for (const it of items) {
        if (!groups.has(it.ch.beamGroup))
            groups.set(it.ch.beamGroup, []);
        groups.get(it.ch.beamGroup).push(it);
    }
    for (const list of groups.values()) {
        list.sort((a, b) => a.ch.start - b.ch.start);
        const bySystem = new Map();
        for (const it of list) {
            const sy = measures[it.ch.measure].system;
            if (!bySystem.has(sy))
                bySystem.set(sy, []);
            bySystem.get(sy).push(it);
        }
        for (const [sy, run] of bySystem) {
            if (run.length < 2)
                continue;
            const first = run[0].ch;
            const staffTop = systems[sy].staffTops[first.staff];
            const stem = run.map((it) => it.stem).find((x) => x);
            out.push({
                ...makeBeam(run.map((it) => it.ch), staffTop, first.clef, bottomLine(first.clef) + 4, run.map((it) => it.levels), stem),
                staff: first.staff, measure: first.measure, group: first.beamGroup,
            });
        }
    }
    return out;
}
function layoutCrossStaffBeams(items, systems, measures) {
    const out = [];
    const groups = new Map();
    for (const it of items) {
        if (!groups.has(it.ch.beamGroup))
            groups.set(it.ch.beamGroup, []);
        groups.get(it.ch.beamGroup).push(it);
    }
    for (const list of groups.values()) {
        list.sort((a, b) => a.ch.start - b.ch.start || a.ch.staff - b.ch.staff);
        const sysIdx = new Set(list.map((it) => measures[it.ch.measure].system));
        if (list.length < 2 || sysIdx.size > 1)
            continue;
        const sys = systems[[...sysIdx][0]];
        const upper = Math.min(...list.map((it) => it.ch.staff));
        const top = (c) => Math.min(...c.heads.map((h) => h.y));
        const bot = (c) => Math.max(...c.heads.map((h) => h.y));
        const ups = list.filter((it) => it.ch.staff === upper).map((it) => it.ch);
        const downs = list.filter((it) => it.ch.staff !== upper).map((it) => it.ch);
        const maxLevel = Math.max(1, ...list.map((it) => it.levels.length), ...list.map((it) => (it.ch.type === 's' ? 2 : it.ch.type === 't' ? 3 : 1)));
        const gap = 0.8 * S;
        // 上の譜表の符頭の下・下の譜表の符頭の上に、それぞれ 2 線間以上あける。あいだが足りなければ中ほど
        const lo = Math.max(...ups.map((c) => bot(c) + 2.5 * S - (maxLevel - 1) * gap), -Infinity);
        const hi = Math.min(...downs.map((c) => top(c) - 2.5 * S), Infinity);
        const between = (sys.staffTops[upper] + STAFF_H + sys.staffTops[Math.max(...list.map((it) => it.ch.staff))]) / 2;
        const y = lo <= hi ? Math.max(lo, Math.min(hi, between - ((maxLevel - 1) * gap) / 2)) : (lo + hi) / 2;
        for (const c of [...ups, ...downs])
            c.cross = true;
        for (const c of ups) {
            c.stemUp = false;
            c.stemX = Math.max(...c.heads.map((h) => h.x)) - HEAD_W / 2 + 0.7;
            c.stemY1 = top(c);
            c.stemY2 = y + (maxLevel - 1) * gap + 0.5 * S;
            c.flagged = false;
        }
        for (const c of downs) {
            c.stemUp = true;
            c.stemX = Math.min(...c.heads.map((h) => h.x)) + HEAD_W / 2 - 0.7;
            c.stemY1 = bot(c);
            c.stemY2 = y;
            c.flagged = false;
        }
        const chords = list.map((it) => it.ch);
        const hasLevels = list.some((it) => it.levels.length);
        out.push({
            staff: upper, measure: chords[0].measure, cross: true,
            x1: chords[0].stemX, y1: y, x2: chords[chords.length - 1].stemX, y2: y, up: true,
            secondary: secondaryBeams(chords, hasLevels ? list.map((it) => it.levels) : undefined),
            group: chords[0].beamGroup,
        });
    }
    return out;
}
const MARK_ORDER = ['tenuto', 'staccato', 'staccatissimo', 'accent', 'strong-accent'];
/**
 * 和音に付く記号を置く。符頭の側（声部が複数なら符幹の側）に、符頭に近いものから順に重ねる。
 * スタッカート・テヌートは五線の中なら間（線と線のあいだ）に置く。フェルマータは五線の外。
 */
function placeMarks(ch, c, multi, staffTop, measure, marks, arpeggios) {
    const ns = c.segs.map((sg) => sg.notation).filter((n) => !!n);
    const kinds = MARK_ORDER.filter((k) => ns.some((n) => n.articulations?.includes(k)));
    const topY = Math.min(...ch.heads.map((h) => h.y));
    const botY = Math.max(...ch.heads.map((h) => h.y));
    const x = ch.stemUp ? Math.min(...ch.heads.map((h) => h.x)) : Math.max(...ch.heads.map((h) => h.x));
    const above = multi ? ch.stemUp : !ch.stemUp;
    const beamed = !ch.flagged && (ch.type === 'e' || ch.type === 's' || ch.type === 't');
    const onStemSide = above === ch.stemUp && ch.type !== 'w';
    let y = onStemSide ? ch.stemY2 + (above ? -1 : 1) * (beamed ? 1.4 : 1) * S : above ? topY - S : botY + S;
    for (const k of kinds) {
        if ((k === 'staccato' || k === 'tenuto') && y > staffTop && y < staffTop + STAFF_H) {
            // 五線の中では線の上を避け、間の中央へ
            const rel = (y - staffTop) / S;
            const space = above ? Math.floor(rel) + 0.5 : Math.ceil(rel) - 0.5;
            y = staffTop + Math.max(0.5, Math.min(3.5, space)) * S;
            if (above ? y > topY - 0.7 * S : y < botY + 0.7 * S)
                y += (above ? -1 : 1) * S;
        }
        marks.push({ staff: ch.staff, measure, x, y, kind: k, above });
        y += (above ? -1 : 1) * (k === 'staccato' || k === 'staccatissimo' ? 0.9 : 1.2) * S;
    }
    if (ns.some((n) => n.fermata)) {
        const fp = ns.find((n) => n.fermata).fermataPlacement;
        const fAbove = fp ? fp === 'above' : above || !multi;
        const fy = fAbove ? Math.min(y, topY - S, staffTop - S, ch.stemUp ? ch.stemY2 - S : Infinity) : Math.max(y, botY + S, staffTop + STAFF_H + S);
        marks.push({ staff: ch.staff, measure, x: ch.x, y: fy, kind: 'fermata', above: fAbove });
    }
    if (ns.some((n) => n.arpeggiate)) {
        const accX = Math.min(...ch.heads.map((h) => h.accX ?? h.x - HEAD_W / 2));
        arpeggios.push({ staff: ch.staff, measure, x: Math.min(accX, Math.min(...ch.heads.map((h) => h.x)) - HEAD_W / 2) - 0.6 * S, y1: topY - 0.6 * S, y2: botY + 0.6 * S });
    }
}
/**
 * グリッサンドの始まりと終わり（同じ譜表・同じ番号で、出てきた順）を結ぶ。段をまたぐものは描かない。
 * 終わりのない始まりは、音を落とすグリッサンドとして右下（五線の下の線まで）へ短く描く
 */
function pairGlissandos(ends, headPos, systems) {
    const out = [];
    const open = new Map();
    // 終わりの音がないグリッサンド: 演奏（src/engine/performance.ts。推定は 1 オクターブまで）と同じく 1 オクターブ下（7 度ぶん = 3.5 線間）まで、
    // 小節の終わりの近くまで斜めに伸ばす（原譜の「Gliss.」の波線のように、はっきり見える長さで）
    const fall = (a) => {
        const p = headPos.get(a.segKey);
        if (!p)
            return;
        const x1 = p.x + HEAD_W * 0.8;
        const y2 = p.y + 3.5 * S;
        const x2 = Math.max(x1 + 2.5 * S, Math.min(x1 + 5 * S, (p.end ?? x1 + 5 * S) - 0.6 * S));
        out.push({ system: p.system, x1, y1: p.y, x2, y2, wavy: a.wavy, label: 'gliss.' });
    };
    for (const e of ends) {
        const k = `${e.si}:${e.number}`;
        if (e.type === 'start') {
            const prev = open.get(k);
            if (prev)
                fall(prev);
            open.set(k, e);
        }
        else {
            const a = open.get(k);
            open.delete(k);
            const p = a && headPos.get(a.segKey);
            const q = headPos.get(e.segKey);
            if (!p || !q || p.system !== q.system || q.x <= p.x)
                continue;
            out.push({ system: p.system, x1: p.x + HEAD_W * 0.8, y1: p.y, x2: q.x - HEAD_W * 0.8, y2: q.y, wavy: a.wavy });
        }
    }
    for (const a of open.values())
        fall(a);
    return out;
}
/**
 * スラー: 始まりと終わり（同じ譜表・同じ番号で、出てきた順）を結ぶ。
 * 上下は、MusicXML の placement → 声部が複数なら声部の側（上の声部は上）→ 符幹が全部上向きなら下、それ以外は上。
 * 端は符頭の側なら符頭のすぐ外、符幹の側なら符幹の先の外。間の和音にかからない高さにする。段をまたぐものは段ごとに分けて描く
 */
function layoutSlurs(ends, segChord, chords, systems, measures, 
/** 譜表 → もとの MusicXML のパート（ピアノの 2 つの譜表は同じパート） */
partOf) {
    const out = [];
    const open = new Map();
    const systemOf = (c) => measures[c.measure].system;
    const endY = (c, above) => {
        const top = Math.min(...c.heads.map((h) => h.y));
        const bot = Math.max(...c.heads.map((h) => h.y));
        // 前打音は小さく描くので、符頭・符幹の先からのすき間も小さく。前打音から主音へのスラーは、前打音の符幹の反対側（符頭の側）から
        const k = c.grace ? GRACE_SCALE : 1;
        const stemSide = c.type !== 'w' && c.stemUp === above && !c.grace;
        if (above)
            return stemSide ? Math.min(c.stemY2, top) - 0.6 * S : top - 0.8 * S * k;
        return stemSide ? Math.max(c.stemY2, bot) + 0.6 * S : bot + 0.8 * S * k;
    };
    const endX = (c, above) => (c.type !== 'w' && c.stemUp === above && !c.grace ? c.stemX : c.x);
    let ids = { fromNote: -1, toNote: -1 };
    const piece = (system, staff, x1, y1, x2, y2, above, between, cross = false) => {
        if (x2 - x1 < 2)
            return;
        const len = x2 - x1;
        let h = Math.min(2 * S, 0.5 * S + len * 0.06);
        // 間の和音（符頭と符幹の先）にかからないよう高くする。弧だけで足りなければ（線間 3 つ分まで）、両端も持ち上げる
        const gaps = between.map((c) => {
            const t = Math.max(0.15, Math.min(0.85, (c.x - x1) / len));
            const line = y1 + (y2 - y1) * t;
            const ext = above ? Math.min(...c.heads.map((hd) => hd.y), c.stemUp ? c.stemY2 : Infinity) - 0.4 * S
                : Math.max(...c.heads.map((hd) => hd.y), c.stemUp ? -Infinity : c.stemY2) + 0.4 * S;
            return { w: 4 * t * (1 - t), gap: above ? line - ext : ext - line };
        });
        for (const g of gaps)
            h = Math.max(h, g.gap / g.w);
        let lift = 0;
        if (h > 3 * S) {
            h = 3 * S;
            lift = Math.max(0, ...gaps.map((g) => g.gap - h * g.w));
        }
        const dy = above ? -lift : lift;
        out.push({ system, staff, x1, y1: y1 + dy, x2, y2: y2 + dy, above, h, ...ids, ...(cross ? { cross: true } : {}) });
    };
    // 拍の順に（同じ拍は、譜表ごとに並べた順のまま）
    const ordered = ends.map((e, i) => ({ e, i })).sort((a, b) => a.e.beat - b.e.beat || a.i - b.i).map((x) => x.e);
    for (const e of ordered) {
        if (e.type === 'continue')
            continue;
        const k = `${e.si}:${e.number}`;
        if (e.type === 'start') {
            open.set(k, e);
            continue;
        }
        // 同じ譜表の始まりがなければ、同じパートの別の譜表の始まり（譜表をまたぐスラー）
        let key = k;
        if (!open.has(k)) {
            key = [...open.keys()].find((ok) => {
                const o = open.get(ok);
                return o.number === e.number && o.si !== e.si && partOf[o.si] === partOf[e.si];
            }) ?? k;
        }
        const a = open.get(key);
        open.delete(key);
        const p = a && segChord.get(a.segKey);
        const q = segChord.get(e.segKey);
        if (!a || !p || !q || p === q)
            continue;
        const sp = systemOf(p);
        const sq = systemOf(q);
        if (sq < sp || (sq === sp && q.x <= p.x))
            continue;
        // 前打音の端は音の id を持たない（-1）。fromGrace / toGrace で区別する
        ids = { fromNote: p.heads[0].noteId, toNote: q.heads[0].noteId, ...(p.grace ? { fromGrace: true } : {}), ...(q.grace ? { toGrace: true } : {}) };
        if (p.staff !== q.staff && sp === sq) {
            // 譜表をまたぐスラー: 上の譜表の音の下から、下の譜表の音の上へ（2 つの譜表のあいだを通る）
            const upper = p.staff < q.staff ? p : q;
            const yP = p === upper ? endY(p, false) : endY(p, true);
            const yQ = q === upper ? endY(q, false) : endY(q, true);
            piece(sp, upper.staff, endX(p, p !== upper) + 0.3 * S, yP, endX(q, q !== upper) - 0.3 * S, yQ, false, [], true);
            continue;
        }
        // 前打音から主音へのスラー（指定がなければ）: 前打音の符頭の側（符幹の反対側）。符幹が上なら下に
        const above = a.placement ? a.placement === 'above' : p.grace ? !p.stemUp : a.multi ? p.stemUp : !(p.stemUp && q.stemUp);
        const y1 = endY(p, above);
        // 前打音からのスラーは、主音の符頭（符幹の先ではなく）の手前で終わる
        const headEnd = (c) => (above ? Math.min(...c.heads.map((h) => h.y)) - 0.8 * S : Math.max(...c.heads.map((h) => h.y)) + 0.8 * S);
        const y2 = p.grace ? headEnd(q) : endY(q, above);
        const x1 = endX(p, above) + 0.3 * S;
        const x2 = p.grace ? q.x - HEAD_W / 2 : endX(q, above) - 0.3 * S;
        const inSystem = (sys, lo, hi) => chords.filter((c) => c.staff === p.staff && systemOf(c) === sys && c !== p && c !== q && c.x > lo && c.x < hi);
        if (sp === sq) {
            piece(sp, p.staff, x1, y1, x2, y2, above, inSystem(sp, p.x, q.x));
        }
        else {
            // 段の終わりまでと、次の段の頭から（間に段があればその段は端から端まで）
            piece(sp, p.staff, x1, y1, systems[sp].x1 - 0.5 * S, y1, above, inSystem(sp, p.x, systems[sp].x1));
            for (let sy = sp + 1; sy < sq; sy++) {
                const top = systems[sy].staffTops[p.staff];
                const y = above ? top - S : top + STAFF_H + S;
                piece(sy, p.staff, systems[sy].headerX, y, systems[sy].x1 - 0.5 * S, y, above, inSystem(sy, systems[sy].headerX, systems[sy].x1));
            }
            piece(sq, p.staff, systems[sq].headerX + S, y2, x2, y2, above, inSystem(sq, systems[sq].headerX, q.x));
        }
    }
    return out;
}
/**
 * 強弱記号: 拍の位置（小節の中の拍 → x は前後の拍の印から線形に）に、譜表の下（placement="above" なら上）へ置く。
 * 上の譜表の下は 2 つの譜表のあいだになる
 */
/**
 * 拍の位置 → 小節と x（小節の中の拍の印から線形に）。atEnd なら、小節の終わりちょうどの拍はその小節の終わり（次の小節の頭ではなく）
 */
function beatX(measures, beat, atEnd = false) {
    const lm = (atEnd ? measures.find((m) => beat > m.start + EPS && beat <= m.end + EPS) : undefined)
        ?? measures.find((m) => beat >= m.start - EPS && beat < m.end - EPS) ?? measures[measures.length - 1];
    if (!lm)
        return null;
    if (atEnd && Math.abs(beat - lm.end) < EPS)
        return { lm, x: lm.x + lm.width - 0.8 * S };
    const marks = lm.marks;
    for (let i = 0; i < marks.length; i++) {
        const a = marks[i];
        const b = marks[i + 1];
        if (beat >= a.beat - EPS && (!b || beat < b.beat - EPS)) {
            const bx = b ? b.x : lm.x + lm.width;
            const bb = b ? b.beat : lm.end;
            return { lm, x: a.x + ((beat - a.beat) / Math.max(EPS, bb - a.beat)) * (bx - a.x) };
        }
    }
    return { lm, x: marks[0]?.x ?? lm.x };
}
/**
 * 強弱記号・松葉の高さ（文字のベースライン）: 譜表の下（placement="above" なら上）。x1〜x2 の和音（符頭・符幹）にかからない。
 * 下に譜表があれば、その譜表の上に出た和音（符頭・上向きの符幹・連桁）にもかからないようにし、あいだが狭ければ空いたところの中ほどに置く
 */
function dynamicsY(placement, sys, si, near, nearBelow = []) {
    const top = sys.staffTops[si];
    // 譜表をまたぐ連桁の和音は、符頭だけを見る（符幹は 2 つの譜表のあいだの連桁へ伸びる。強弱記号・松葉は、元の楽譜と同じく符幹にかかってよい）
    const stemUpEnd = (c) => (c.stemUp && !c.cross ? c.stemY2 : Infinity);
    const stemDownEnd = (c) => (c.stemUp || c.cross ? -Infinity : c.stemY2);
    if (placement === 'above') {
        return Math.min(top - 1.6 * S, ...near.map((c) => Math.min(...c.heads.map((h) => h.y), stemUpEnd(c)) - 1.2 * S));
    }
    const upperBottom = Math.max(top + STAFF_H, ...near.map((c) => Math.max(...c.heads.map((h) => h.y), stemDownEnd(c))));
    let y = Math.max(top + STAFF_H + 2.6 * S, upperBottom + 2 * S);
    const below = sys.staffTops[si + 1];
    if (below !== undefined) {
        const lowerTop = Math.min(below, ...nearBelow.map((c) => Math.min(...c.heads.map((h) => h.y), stemUpEnd(c)) - 0.6 * S));
        if (lowerTop > upperBottom + 1.4 * S) {
            // 上下の和音のあいだに空きがある: 下の和音にかからないところまで。上に近すぎれば（文字の高さ 1.4 線間）空きの中ほど
            y = Math.min(y, lowerTop - 0.6 * S);
            if (y - 1.4 * S < upperBottom + 0.4 * S)
                y = (upperBottom + lowerTop) / 2 + 0.7 * S;
        }
        // 空きがなければ（上下の和音が重なる高さにある）、これまでどおり下の譜表の手前まで
        y = Math.min(y, below - 0.6 * S);
    }
    return y;
}
/** 強弱記号の文字の幅（太字の斜体 15px の目安） */
const dynWidth = (text) => text.length * 0.95 * S;
/**
 * 強弱記号: 拍の位置に、譜表の下（placement="above" なら上）へ置く。上の譜表の下は 2 つの譜表のあいだになる。
 * 松葉: 始まりと終わりの拍のあいだに引く。段をまたぐものは段ごとに分け、開きは拍の割合で続ける。
 * 同じ拍に強弱記号があれば、その文字を避けて始まり・終わりを縮め、高さを文字にそろえる
 */
function dynamicsAndWedges(parts, measures, systems, chords) {
    const dynamics = [];
    const wedges = [];
    const words = [];
    parts.forEach((p, si) => {
        const mine = [];
        for (const d of p.dynamics ?? []) {
            const at = beatX(measures, d.beat);
            if (!at)
                continue;
            const near = chords.filter((c) => c.staff === si && c.measure === at.lm.index && Math.abs(c.x - at.x) < 3 * S);
            const nearBelow = chords.filter((c) => c.staff === si + 1 && c.measure === at.lm.index && c.x > at.x - S && c.x < at.x + dynWidth(d.mark) + S);
            const ld = { staff: si, system: at.lm.system, x: at.x, y: dynamicsY(d.placement, systems[at.lm.system], si, near, nearBelow), text: d.mark };
            dynamics.push(ld);
            mine.push({ ...ld, beat: d.beat });
        }
        for (const w of p.wedges ?? []) {
            const a = beatX(measures, w.start);
            const b = beatX(measures, w.end, true);
            if (!a || !b)
                continue;
            const full = ((w.spread ?? 15) / 10) * S;
            const span = Math.max(EPS, w.end - w.start);
            const hAt = (beat) => full * (w.type === 'crescendo' ? (beat - w.start) / span : 1 - (beat - w.start) / span);
            for (let sy = a.lm.system; sy <= b.lm.system; sy++) {
                const sys = systems[sy];
                const inSys = measures.filter((m) => m.system === sy);
                if (!inSys.length)
                    continue;
                const first = inSys[0];
                const last = inSys[inSys.length - 1];
                let x1 = sy === a.lm.system ? a.x : first.marks[0]?.x - 1.2 * S;
                let x2 = sy === b.lm.system ? b.x : last.x + last.width - 0.4 * S;
                const b1 = sy === a.lm.system ? w.start : first.start;
                const b2 = sy === b.lm.system ? w.end : last.end;
                const startDyn = sy === a.lm.system ? mine.find((d) => d.system === sy && Math.abs(d.beat - w.start) < EPS) : undefined;
                const endDyn = sy === b.lm.system ? mine.find((d) => d.system === sy && Math.abs(d.beat - w.end) < EPS) : undefined;
                if (startDyn)
                    x1 = Math.max(x1, startDyn.x + dynWidth(startDyn.text) + 0.4 * S);
                if (endDyn)
                    x2 = Math.min(x2, endDyn.x - 0.5 * S);
                // 小節の終わりで止まる松葉の後ろに次の小節の頭の強弱記号があれば、その文字の手前まで
                const nextDyn = mine.find((d) => d.system === sy && d.x > x1 && d.x < x2 + 0.5 * S && d !== startDyn);
                if (nextDyn && !endDyn)
                    x2 = Math.min(x2, nextDyn.x - 0.5 * S);
                if (x2 - x1 < 1.5 * S)
                    x2 = x1 + 1.5 * S;
                const inRange = (c) => measures[c.measure]?.system === sy && c.x > x1 - S && c.x < x2 + S;
                const near = chords.filter((c) => c.staff === si && inRange(c));
                const nearBelow = chords.filter((c) => c.staff === si + 1 && inRange(c));
                let y = dynamicsY(w.placement, sys, si, near, nearBelow);
                const aligned = [startDyn, endDyn].filter((d) => !!d);
                if (aligned.length)
                    y = w.placement === 'above' ? Math.min(y, ...aligned.map((d) => d.y)) : Math.max(y, ...aligned.map((d) => d.y));
                wedges.push({
                    staff: si, system: sy, x1, x2, y: y - 0.35 * S, h1: hAt(b1), h2: hAt(b2),
                    ...(w.niente && w.type === 'crescendo' && sy === a.lm.system ? { niente1: true } : {}),
                    ...(w.niente && w.type === 'diminuendo' && sy === b.lm.system ? { niente2: true } : {}),
                });
            }
        }
        // 文字の指示: 置き場所の指定がなければ、強弱の文字は強弱記号と同じく譜表の下、それ以外は上。
        // 同じ拍・同じ側に強弱記号があれば、その右に続けて同じ高さに書く（「p cresc.」など）
        for (const w of p.words ?? []) {
            const at = beatX(measures, w.beat);
            if (!at)
                continue;
            const placement = w.placement ?? (w.kind === 'dynamics' ? 'below' : 'above');
            const sys = systems[at.lm.system];
            const dyn = mine.find((d) => d.system === at.lm.system && Math.abs(d.beat - w.beat) < EPS && (d.y < sys.staffTops[si]) === (placement === 'above'));
            const x = dyn ? dyn.x + dynWidth(dyn.text) + 0.4 * S : at.x;
            const near = chords.filter((c) => c.staff === si && c.measure === at.lm.index && c.x > x - S && c.x < x + wordWidth(w.text) + S);
            const nearBelow = chords.filter((c) => c.staff === si + 1 && c.measure === at.lm.index && c.x > x - S && c.x < x + wordWidth(w.text) + S);
            const y = dyn ? dyn.y : dynamicsY(placement, sys, si, near, nearBelow);
            words.push({ staff: si, system: at.lm.system, x, y, text: w.text, kind: w.kind, above: placement === 'above',
                ...(w.italic ? { italic: true } : {}), ...(w.bold ? { bold: true } : {}) });
        }
    });
    return { dynamics, wedges, words };
}
/** 文字の指示の幅（13px の Times の目安） */
export const wordWidth = (text) => text.length * 0.62 * S;
/** 譜表のあいだにあける最小の余白（別の譜表の要素どうし） */
const CLEAR = 0.4 * S;
/** 段の上下で、となりの段に向けてあける余白 */
const EDGE = 0.3 * S;
/** 自動で広げる上限（1 つの譜表のあいだ・段の上下とも） */
const MAX_EXTRA = 16 * S;
/** 組み直す回数の上限 */
const MAX_PASSES = 6;
/**
 * 要素ごとの占有領域。符頭・臨時記号・符幹・連桁（二次の連桁を含む）・休符・記号・連符・強弱記号・松葉・スラー・タイ・前打音・オッターヴァ・五線。
 * 譜表をまたぐ連桁と、その和音の符幹、譜表をまたぐスラーは、2 つの譜表のあいだに置くものなので数えない（符頭は数える）。
 * 数えると、あいだを広げるたびに下の譜表の端が一緒に動いて、いつまでも足りない（上限まで広がる）
 */
export function occupiedBoxes(L) {
    const out = [];
    const add = (system, staff, kind, x1, x2, y1, y2) => out.push({ system, staff, kind, x1: Math.min(x1, x2), x2: Math.max(x1, x2), y1: Math.min(y1, y2), y2: Math.max(y1, y2) });
    const sysOfMeasure = (mi) => L.measures.find((m) => m.index === mi)?.system ?? 0;
    const sysOfY = (y) => {
        let best = 0;
        for (const sy of L.systems)
            if (y >= sy.top - S)
                best = sy.index;
        return best;
    };
    const staffOfY = (sy, y) => {
        let best = 0;
        sy.staffTops.forEach((t, k) => { if (Math.abs(t + STAFF_H / 2 - y) < Math.abs(sy.staffTops[best] + STAFF_H / 2 - y))
            best = k; });
        return best;
    };
    for (const sy of L.systems) {
        sy.staffTops.forEach((t, k) => add(sy.index, k, 'staff', sy.x0, sy.x1, t, t + STAFF_H));
    }
    for (const c of L.chords) {
        const sy = sysOfMeasure(c.measure);
        for (const h of c.heads) {
            add(sy, c.staff, 'head', h.x - HEAD_W * 0.6, h.x + HEAD_W * 0.6, h.y - 0.55 * S, h.y + 0.55 * S);
            if (h.accidental && h.accX !== undefined)
                add(sy, c.staff, 'accidental', h.accX - 0.45 * S, h.accX + 0.45 * S, h.y - 1.3 * S, h.y + 1.0 * S);
        }
        if (c.type !== 'w' && !c.cross)
            add(sy, c.staff, 'stem', c.stemX - 1, c.stemX + 1, c.stemY1, c.stemY2);
    }
    for (const b of L.beams) {
        if (b.cross || b.staff === undefined)
            continue;
        const sy = b.measure !== undefined ? sysOfMeasure(b.measure) : sysOfY(b.y1);
        const th = b.up ? 0.5 * S : -0.5 * S;
        const slope = b.x2 === b.x1 ? 0 : (b.y2 - b.y1) / (b.x2 - b.x1);
        const seg = (x1, x2, dy) => {
            // 傾いた連桁は、横 2 線間ずつの矩形で近づける
            for (let x = x1; x < x2 - 0.01; x += 2 * S) {
                const xe = Math.min(x2, x + 2 * S);
                const ya = b.y1 + (x - b.x1) * slope + dy, yb = b.y1 + (xe - b.x1) * slope + dy;
                add(sy, b.staff, 'beam', x, xe, Math.min(ya, yb, ya + th, yb + th), Math.max(ya, yb, ya + th, yb + th));
            }
        };
        seg(b.x1, b.x2, 0);
        for (const s2 of b.secondary)
            seg(s2.x1, s2.x2, (b.up ? 1 : -1) * 0.8 * S * ((s2.level ?? 2) - 1));
    }
    for (const r of L.rests) {
        const sy = sysOfY(r.staffTop);
        const t = r.staffTop + (r.dy ?? 0);
        add(sy, r.staff, 'rest', r.x - 0.7 * S, r.x + 0.7 * S, t + 0.5 * S, t + 4.2 * S);
    }
    for (const m of L.marks)
        add(sysOfMeasure(m.measure), m.staff, 'mark', m.x - 0.5 * S, m.x + 0.5 * S, m.y - 0.5 * S, m.y + 0.5 * S);
    // 連符の数字（譜表をまたぐ連桁のものも、符頭の外側に置くので、その譜表のものとして数える）
    for (const t of L.tuplets)
        add(sysOfMeasure(t.measure), t.staff, 'tuplet', t.x1, t.x2, t.y - 0.8 * S, t.y + 0.8 * S);
    for (const d of L.dynamics ?? [])
        add(d.system, d.staff, 'dynamic', d.x, d.x + dynWidth(d.text), d.y - 1.2 * S, d.y + 0.45 * S);
    for (const w of L.words ?? [])
        add(w.system, w.staff, 'words', w.x, w.x + wordWidth(w.text), w.y - 1.05 * S, w.y + 0.35 * S);
    for (const w of L.wedges ?? []) {
        const h = Math.max(w.h1, w.h2) / 2;
        add(w.system, w.staff, 'wedge', w.x1, w.x2, w.y - h, w.y + h);
    }
    for (const sl of L.slurs ?? []) {
        if (sl.cross)
            continue;
        const lo = Math.min(sl.y1, sl.y2), hi = Math.max(sl.y1, sl.y2);
        add(sl.system, sl.staff, 'slur', sl.x1, sl.x2, sl.above ? lo - sl.h - 0.2 * S : lo, sl.above ? hi : hi + sl.h + 0.2 * S);
    }
    for (const t of L.ties) {
        const sy = L.systems[sysOfY(t.y)];
        add(sy.index, staffOfY(sy, t.y), 'tie', t.x1, t.x2, t.below ? t.y : t.y - 0.9 * S, t.below ? t.y + 0.9 * S : t.y);
    }
    for (const g of L.graces ?? []) {
        const sy = sysOfMeasure(g.measure);
        for (const h of g.heads)
            add(sy, g.staff, 'grace', g.x - HEAD_W * 0.4, g.x + HEAD_W * 0.4, h.y - 0.4 * S, h.y + 0.4 * S);
        add(sy, g.staff, 'grace', g.stemX - 1, g.stemX + 1, g.stemY1, g.stemY2);
    }
    for (const o of L.ottavas ?? [])
        add(o.system, o.staff, 'ottava', o.x1, o.x2, o.y - 1.1 * S, o.y + 0.6 * S);
    for (const e of L.endings ?? [])
        add(e.system, 0, 'ending', e.x1, e.x2, e.y - 0.2 * S, e.y + 1.6 * S);
    for (const g of L.signs ?? [])
        add(g.system, 0, 'sign', g.x - 0.9 * S, g.x + 0.9 * S, g.y - 1.1 * S, g.y + 1.1 * S);
    return out;
}
/**
 * 段ごとに、要素が重ならないために足す余白。
 *   譜表のあいだ: 上の譜表の要素と、下の譜表の要素（五線を含む）が横に重なるところで、縦に CLEAR だけ離れるまで
 *   段の上・下: 要素が段の範囲（となりの段との境）からはみ出すぶん
 * 下の譜表の要素は、あいだを広げたぶんだけ下へ動く（強弱記号や譜表をまたぐ連桁のように、あいだに置くものは組み直すと動くので、もう一度確かめる）
 */
export function spacingNeeds(L, boxes = occupiedBoxes(L)) {
    return L.systems.map((sy) => {
        const mine = boxes.filter((b) => b.system === sy.index);
        const gaps = sy.staffTops.slice(1).map((_, k) => {
            const up = mine.filter((b) => b.staff === k);
            const lo = mine.filter((b) => b.staff === k + 1);
            let need = 0;
            for (const a of up) {
                for (const b of lo) {
                    if (a.x1 < b.x2 && b.x1 < a.x2)
                        need = Math.max(need, a.y2 + CLEAR - b.y1);
                }
            }
            return need;
        });
        const minY = Math.min(...mine.map((b) => b.y1));
        const maxY = Math.max(...mine.map((b) => b.y2));
        return {
            gaps,
            top: Math.max(0, sy.top + EDGE - minY),
            bottom: Math.max(0, maxY - (sy.top + sy.height - EDGE)),
        };
    });
}
/**
 * 楽譜のレイアウト。譜表の間隔と段の上下の余白は、記譜の内容で決める:
 * 既定の間隔で組み、要素の占有領域が重なる段だけ、そのぶん広げて組み直す（狭めはしない）。
 * 広げた位置で、あいだに置く要素（強弱記号・松葉・譜表をまたぐ連桁）が置き直されるので、重なりがなくなるまで最大 MAX_PASSES 回くり返す。
 * 余白は増えるだけなので、くり返しは振動しない（上限 MAX_EXTRA）。
 * MusicXML の <staff-layout><staff-distance> は使わない: 段の分け方・小節の幅が原譜と違う（このアプリが組み直す）ので、
 * 原譜の段ごとの間隔は、ここで組んだ段に対応しない。docs/NOTATION.md
 */
export function layoutScore(score, width, opts = {}) {
    const breaks = opts.breaks ?? 'fit';
    let L = layoutPass(score, width, undefined, breaks);
    if (opts.autoSpacing === false)
        return L;
    let spacing;
    for (let pass = 0; pass < MAX_PASSES; pass++) {
        const need = spacingNeeds(L);
        if (need.every((n) => n.top < 0.5 && n.bottom < 0.5 && n.gaps.every((g) => g < 0.5)))
            break;
        const cap = (v) => Math.min(MAX_EXTRA, Math.ceil(v));
        // 一度広げたのにまだ足りないところは、あいだに置く要素が一緒に動いている（強弱記号・松葉が譜表に付いて動く、
        // 譜表をまたぐ連桁があいだの中ほどに動く）ので、足りないぶんの 2 倍を足す
        const step = (prev, g) => (g < 0.5 ? 0 : prev > 0 ? 2 * g : g);
        spacing = need.map((n, i) => {
            const prev = spacing?.[i] ?? { gaps: n.gaps.map(() => 0), top: 0, bottom: 0 };
            return {
                gaps: n.gaps.map((g, k) => cap(prev.gaps[k] + step(prev.gaps[k], g))),
                top: cap(prev.top + step(prev.top, n.top)),
                bottom: cap(prev.bottom + step(prev.bottom, n.bottom)),
            };
        });
        L = layoutPass(score, width, spacing, breaks);
    }
    return L;
}
