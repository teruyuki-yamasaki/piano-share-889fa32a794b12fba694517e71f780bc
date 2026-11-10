/**
 * 演奏のための音の並び。楽曲の構造（Score）は変えず、鳴らす音の時刻だけをここで決める。
 *
 * いま扱うのは前打音（Part.graces）だけ。前打音を鳴らすために、主音（または前の音）の発音時刻・長さを変えることがある。
 * その変更は Transform として記録する（どの音を、何の規則で、どれだけ動かしたか）。前打音のない箇所の音は、元の NoteEvent をそのまま返す。
 *
 * 演奏の長さの決め方（docs/PERFORMANCE.md）:
 *   - MusicXML に指定があればそれを使う
 *       steal-time-previous = p … 前の音（同じ声部で、前打音の拍に終わる音）の長さの p% を借り、拍の前に鳴らす
 *       steal-time-following = p … 主音の長さの p% を借り、拍の上で鳴らす（主音はその分遅れて短くなる）
 *       make-time = t … 長さ t を拍の上で鳴らす（新しく時間を作ることはせず、主音から借りる近似。Transform に approx と記録）
 *   - 指定がなければアプリの推定（保守的な規則。主音の拍の上で、主音から借りる）
 *       斜線つき（短前打音）: 1 つの和音 = min(書かれた長さ, 1/8 拍)
 *       斜線なし（前打音）  : 1 つの和音 = min(書かれた長さ, 1/4 拍)
 *     どちらも合計は主音の長さの半分まで（越えるときは同じ割合で縮める）
 *   - 同じ group の前打音は同時に鳴らす（和音）。group が違えば順に鳴らす
 *   - 主音は、同じパート・同じ声部で前打音の拍に始まる音（なければ同じ拍のそのパートの音）。ほかの声部の音は動かさない
 *   - 強さは主音（前の音から借りるときは前の音）と同じ
 *
 * 松葉（Part.wedges）: 始まりと終わりの強さが MusicXML から決まるときだけ、あいだに始まる音の強さ（velocity）を直線で変える。
 *   始まり = 松葉の拍に鳴っている強さ（読み込みで強弱記号から決めた velocity）、終わり = 松葉の終わりの拍（から 1 拍以内）の同じ譜表の強弱記号。
 *   終わりの強弱記号がない松葉は変えない（行き先の強さを推定しない）。向きが強弱記号と合わない松葉も変えない。
 *   変えられるのは音の出だしの強さだけ（鳴っている音を途中で大きく・小さくすることは、いまの再生ではできない）
 *
 * グリッサンド（音の notation.glissando の start / stop）: 始まりの音から終わりの音へ、鍵盤をなぞる音の並びを足す（docs/PERFORMANCE.md）。
 *   終わりの音: MusicXML の stop の音 → なければ次の音（同じパートで、始まりの音のあとに始まる最初の音の和音の最高音。推定）→ なければ 1 オクターブ下（推定）。
 *     推定のときは 1 オクターブまで（GLISS_INFERRED_RANGE。Christmas 19 小節は、次の音が 3 オクターブ下でも、原譜の波線は五線の上で終わる）
 *   なぞる鍵: 設定（glissMode・glissOverrides）→ なければ推定: 始まりの和音が 2 音以上ですべて黒鍵なら黒鍵、それ以外は白鍵（半音階は設定のときだけ）。
 *     黒鍵 1 音から始まるだけでは黒鍵にしない
 *   時間: 始まりの音の拍から、始まりの音の長さの 1/4（最大 1/8 拍）だけ遅れて始め、終わりの音の拍（stop がなければ始まりの音の終わり）まで等間隔。
 *     毎秒 GLISS_MAX_RATE 音を越えるときは、等間隔に間引く
 *   始まりの音・終わりの音・ほかの音は動かさない。足した音の id は負の数、強さは始まりの音と同じ
 */
import { TempoMap } from "../core/tempo.js";
import { DYNAMICS, EPS } from "../core/types.js";
/** グリッサンドの音の数の上限（毎秒）。越えるときは等間隔に間引く */
export const GLISS_MAX_RATE = 40;
/** 幅の上限（半音）: 終わりの音が MusicXML・設定で決まるとき / 推定（次の音・1 オクターブ）のとき */
const GLISS_MAX_RANGE = 36;
export const GLISS_INFERRED_RANGE = 12;
const STEP_SEMI = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const TYPE_BEATS = { whole: 4, half: 2, quarter: 1, eighth: 0.5, '16th': 0.25, '32nd': 0.125, '64th': 0.0625 };
function graceMidi(g) {
    return (g.spelling.octave + 1) * 12 + STEP_SEMI[g.spelling.step] + g.spelling.alter;
}
function writtenBeats(g) {
    const base = TYPE_BEATS[g.notation.type ?? 'eighth'] ?? 0.5;
    let d = base;
    for (let k = 1; k <= (g.notation.dots ?? 0); k++)
        d += base / 2 ** k;
    return d;
}
export function perform(score, opts = {}) {
    const notes = new Map();
    const transforms = [];
    let graceId = -1; // 前打音の音の id（負の数）
    for (const part of score.parts) {
        const out = new Map(part.notes.map((n) => [n.id, n]));
        const extra = [];
        if (opts.graces && part.graces?.length)
            graceNotes(part, out, extra, transforms, () => graceId--);
        if (opts.wedges && part.wedges?.length)
            wedgeVelocities(part, out, transforms);
        if (opts.tremolos && part.notes.some((n) => n.notation?.tremolo))
            tremoloNotes(part, score, opts, out, extra, transforms, () => graceId--);
        if (opts.glissandos && part.notes.some((n) => n.notation?.glissando?.some((g) => g.type === 'start'))) {
            glissandoNotes(part, opts, new TempoMap(score.tempos), extra, transforms, () => graceId--);
        }
        // 何も変えなければ元の配列のまま（従来の演奏と同じものを使う）
        const orig = new Map(part.notes.map((n) => [n.id, n]));
        const changed = extra.length > 0 || [...out].some(([id, n]) => n !== orig.get(id));
        notes.set(part.id, changed ? [...out.values(), ...extra].sort((a, b) => a.start - b.start || a.midi - b.midi) : part.notes);
    }
    return { notes, transforms };
}
function wedgeVelocities(part, out, transforms) {
    for (const w of part.wedges ?? []) {
        const inside = part.notes.filter((n) => n.start >= w.start - EPS && n.start < w.end - EPS);
        const base = { kind: 'wedge', partId: part.id, beat: w.start, voice: '', source: 'musicxml', graces: [] };
        if (!inside.length)
            continue;
        const target = (part.dynamics ?? []).find((d) => d.beat >= w.end - EPS && d.beat <= w.end + 1 + EPS && DYNAMICS[d.mark]);
        if (!target) {
            transforms.push({ ...base, rule: 'wedge-no-target', changed: [] });
            continue;
        }
        const v0 = inside[0].velocity;
        const v1 = DYNAMICS[target.mark];
        if ((w.type === 'crescendo' && v1 <= v0) || (w.type === 'diminuendo' && v1 >= v0)) {
            transforms.push({ ...base, rule: 'wedge-contradicts', changed: [] });
            continue;
        }
        const changed = [];
        for (const n of inside) {
            const cur = out.get(n.id);
            const v = Math.max(1, Math.min(127, Math.round(v0 + ((v1 - v0) * (n.start - w.start)) / Math.max(EPS, w.end - w.start))));
            if (v === cur.velocity)
                continue;
            out.set(n.id, { ...cur, velocity: v });
            changed.push({ noteId: n.id, start: cur.start, duration: cur.duration, newStart: cur.start, newDuration: cur.duration, velocity: cur.velocity, newVelocity: v });
        }
        transforms.push({ ...base, rule: 'wedge-to-dynamic', changed });
    }
}
function graceNotes(part, out, extra, transforms, nextId) {
    // 声部・拍ごとの前打音の並び（group ごとの和音）
    const seqs = new Map();
    for (const g of part.graces ?? []) {
        const key = `${g.voice}@${g.start.toFixed(6)}`;
        const seq = seqs.get(key) ?? seqs.set(key, []).get(key);
        const last = seq[seq.length - 1];
        if (last && last[0].group === g.group)
            last.push(g);
        else
            seq.push([g]);
    }
    for (const seq of seqs.values()) {
        const { start: beat, voice } = seq[0][0];
        const at = part.notes.filter((n) => Math.abs(n.start - beat) < EPS);
        const main = at.filter((n) => n.notation?.voice === voice).length ? at.filter((n) => n.notation?.voice === voice) : at;
        const ends = part.notes.filter((n) => Math.abs(n.start + n.duration - beat) < EPS && n.start < beat - EPS);
        const prev = ends.filter((n) => n.notation?.voice === voice).length ? ends.filter((n) => n.notation?.voice === voice) : [];
        const first = seq[0][0];
        let rule;
        let durs;
        const mainDur = main.length ? Math.min(...main.map((n) => n.duration)) : 0;
        const prevDur = prev.length ? Math.min(...prev.map((n) => n.duration)) : 0;
        if (first.stealPrevious !== undefined && prev.length) {
            rule = 'steal-previous';
            durs = seq.map((c) => ((c[0].stealPrevious ?? first.stealPrevious) / 100) * prevDur);
        }
        else if (!main.length) {
            rule = 'no-main-note';
            durs = seq.map((c) => Math.min(writtenBeats(c[0]), c[0].slash ? 1 / 8 : 1 / 4));
        }
        else if (first.stealFollowing !== undefined) {
            rule = 'steal-following';
            durs = seq.map((c) => ((c[0].stealFollowing ?? first.stealFollowing) / 100) * mainDur);
        }
        else if (first.makeTime !== undefined) {
            rule = 'make-time-approx';
            durs = seq.map((c) => c[0].makeTime ?? first.makeTime);
        }
        else {
            rule = first.slash ? 'default-acciaccatura' : 'default-appoggiatura';
            durs = seq.map((c) => Math.min(writtenBeats(c[0]), c[0].slash ? 1 / 8 : 1 / 4));
        }
        // 借りる相手の長さを越えない（推定は半分まで、指定は 95% まで）
        const from = rule === 'steal-previous' ? prevDur : mainDur;
        const cap = rule.startsWith('default') || rule === 'no-main-note' ? 0.5 : 0.95;
        const total = durs.reduce((a, b) => a + b, 0);
        if (from > 0 && total > from * cap)
            durs = durs.map((d) => (d * from * cap) / total);
        const sum = durs.reduce((a, b) => a + b, 0);
        // 前の音から借りる / 主音がない: 拍の前に鳴らす。それ以外: 拍の上で鳴らし、主音を遅らせる
        const before = rule === 'steal-previous' || rule === 'no-main-note';
        let t = before ? beat - sum : beat;
        const vel = (before && prev.length ? prev : main)[0]?.velocity ?? 64;
        const played = [];
        seq.forEach((chord, k) => {
            for (const g of chord) {
                const n = { id: nextId(), partId: part.id, midi: graceMidi(g), start: t, duration: durs[k], velocity: vel };
                extra.push(n);
                played.push({ midi: n.midi, start: n.start, duration: n.duration });
            }
            t += durs[k];
        });
        const changed = [];
        for (const n of rule === 'steal-previous' ? prev : rule === 'no-main-note' ? [] : main) {
            const cur = out.get(n.id);
            const moved = rule === 'steal-previous'
                ? { ...cur, duration: cur.duration - sum }
                : { ...cur, start: cur.start + sum, duration: cur.duration - sum };
            out.set(n.id, moved);
            changed.push({ noteId: n.id, start: cur.start, duration: cur.duration, newStart: moved.start, newDuration: moved.duration });
        }
        transforms.push({
            kind: 'grace', partId: part.id, beat, voice, rule, graces: played, changed,
            source: rule.startsWith('default') || rule === 'no-main-note' ? 'app' : 'musicxml',
        });
    }
}
const BLACK = new Set([1, 3, 6, 8, 10]);
export const isBlackKey = (midi) => BLACK.has(((midi % 12) + 12) % 12);
function glissandoNotes(part, opts, tm, extra, transforms, nextId) {
    const notes = [...part.notes].sort((a, b) => a.start - b.start || a.midi - b.midi);
    const done = new Set();
    for (const s of notes) {
        for (const g of s.notation?.glissando ?? []) {
            if (g.type !== 'start')
                continue;
            // 和音のグリッサンド: 同じ拍で同じ番号の始まりを持つ音のうち、最高音から（1 本の流れとして鳴らす）
            const key = `${s.start}:${g.number}`;
            if (done.has(key))
                continue;
            done.add(key);
            const chord = notes.filter((n) => Math.abs(n.start - s.start) < EPS && n.notation?.glissando?.some((x) => x.type === 'start' && x.number === g.number));
            const top = chord.reduce((a, b) => (b.midi > a.midi ? b : a));
            const ov = opts.glissOverrides?.[`${part.id}:${top.id}`];
            // 終わり: あとの音の、同じ番号の stop（8 拍以内）。その前に同じ番号の start があれば、この記号には stop がない
            const after = notes.find((n) => n.start > top.start + EPS && n.start <= top.start + 8 + EPS && n.notation?.glissando?.some((x) => x.number === g.number));
            const stop = after?.notation?.glissando?.some((x) => x.type === 'stop' && x.number === g.number) ? after : undefined;
            const nextOnset = notes.find((n) => n.start > top.start + EPS)?.start;
            const next = nextOnset !== undefined ? notes.filter((n) => Math.abs(n.start - nextOnset) < EPS).reduce((a, b) => (b.midi > a.midi ? b : a)) : undefined;
            let to;
            let endSource;
            let rule;
            let endPlayed; // 終わりの音は、その音自身が鳴る（なぞる音には含めない）
            if (ov?.endMidi !== undefined) {
                to = ov.endMidi;
                endSource = 'setting';
                rule = 'gliss-override';
                endPlayed = false;
            }
            else if (stop) {
                to = stop.midi;
                endSource = 'musicxml';
                rule = 'gliss-to-stop';
                endPlayed = true;
            }
            else if (next && next.midi !== top.midi) {
                to = next.midi;
                endSource = 'app';
                rule = 'gliss-to-next-note';
                endPlayed = true;
            }
            else {
                to = top.midi - 12;
                endSource = 'app';
                rule = 'gliss-open';
                endPlayed = false;
            }
            // 幅の上限: 終わりが記号・設定で決まるときは 3 オクターブ、推定のときは 1 オクターブ（次の音が遠くても、そこまでは滑らせない）
            const range = endSource === 'app' ? GLISS_INFERRED_RANGE : GLISS_MAX_RANGE;
            const clipped = Math.abs(to - top.midi) > range;
            if (clipped) {
                to = top.midi + Math.sign(to - top.midi) * range;
                endPlayed = false;
            }
            const dir = Math.sign(to - top.midi);
            if (!dir)
                continue;
            let mode;
            let modeSource;
            if (ov?.mode) {
                mode = ov.mode;
                modeSource = 'setting';
            }
            else if (opts.glissMode && opts.glissMode !== 'auto') {
                mode = opts.glissMode;
                modeSource = 'setting';
            }
            else {
                mode = chord.length >= 2 && chord.every((n) => isBlackKey(n.midi)) ? 'black' : 'white';
                modeSource = 'app';
            }
            const pitches = [];
            for (let m = top.midi + dir; dir > 0 ? m <= to : m >= to; m += dir) {
                if (m === to && endPlayed)
                    break;
                if (mode === 'chromatic' || (mode === 'black') === isBlackKey(m))
                    pitches.push(m);
            }
            if (!pitches.length)
                continue;
            const lead = Math.min(0.125, top.duration / 4);
            const t0 = top.start + lead;
            const t1 = ov?.beats !== undefined ? t0 + ov.beats : stop ? stop.start : top.start + top.duration;
            if (t1 <= t0 + EPS)
                continue;
            // 毎秒 GLISS_MAX_RATE 音を越えるなら、等間隔に間引く（端の向きは保つ）
            const seconds = tm.beatToSec(t1) - tm.beatToSec(t0);
            const max = Math.max(1, Math.floor(seconds * GLISS_MAX_RATE));
            const thinned = pitches.length > max;
            const use = thinned ? Array.from({ length: max }, (_, i) => pitches[Math.round((i * (pitches.length - 1)) / Math.max(1, max - 1))]) : pitches;
            const step = (t1 - t0) / use.length;
            const made = use.map((midi, i) => ({ midi, start: t0 + i * step, duration: step }));
            for (const m of made)
                extra.push({ id: nextId(), partId: part.id, midi: m.midi, start: m.start, duration: m.duration, velocity: top.velocity });
            transforms.push({
                kind: 'glissando', partId: part.id, beat: top.start, voice: top.notation?.voice ?? '', source: endSource === 'musicxml' ? 'musicxml' : 'app', rule,
                graces: [], changed: [],
                gliss: { mode, modeSource, endSource, from: top.midi, to, startBeat: t0, endBeat: t1, notes: made, thinned, clipped },
            });
        }
    }
}
/**
 * トレモロ（notation.tremolo）: 書かれた音のかわりに、細かく繰り返す音の並びを鳴らす（自動で弾くパートだけ）。
 *   2 音間（start〜stop。同じパート・同じ声部で続く 2 つの音）: 2 つの音を、2 つの長さを合わせたあいだ交互に。最初の音から
 *   1 音（single）: 同じ音を、その長さのあいだ繰り返す
 *   細かさ: 斜線の数 n → 1 つ 2^-n 拍（1 本 = 8 分音符、2 本 = 16 分、3 本 = 32 分）
 *   強さ: 書かれた音の強さ。トレモロに重なる松葉（同じパートか、ピアノのもう片方の譜表のもの）の終わりから 1 拍以内に強弱記号があれば、
 *         トレモロの長さのあいだ、その強さへ直線で変える（Christmas 3 小節目: 右手の下のクレッシェンドから 4 小節目の f へ）
 *   書かれた音は鳴らさず（Transform の changed に元の音）、足した音の id は負の数
 */
function tremoloNotes(part, score, opts, out, extra, transforms, nextId) {
    const notes = [...part.notes].sort((a, b) => a.start - b.start || a.midi - b.midi);
    const base = part.id.replace(/-s\d+$/, '');
    const siblings = score.parts.filter((p) => p.id.replace(/-s\d+$/, '') === base);
    const wedges = siblings.flatMap((p) => p.wedges ?? []);
    const dynamics = siblings.flatMap((p) => p.dynamics ?? []);
    const done = new Set();
    for (const a of notes) {
        const t = a.notation?.tremolo;
        if (!t || done.has(a.id))
            continue;
        let span;
        let written;
        if (t.type === 'start') {
            const b = notes.find((n) => n.notation?.tremolo?.type === 'stop' && (n.notation?.voice ?? '') === (a.notation?.voice ?? '')
                && Math.abs(n.start - (a.start + a.duration)) < EPS);
            if (!b)
                continue;
            // 和音のトレモロ（同じ拍の音もトレモロ）: 和音ごとに鳴らす
            const chordA = notes.filter((n) => Math.abs(n.start - a.start) < EPS && n.notation?.tremolo?.type === 'start');
            const chordB = notes.filter((n) => Math.abs(n.start - b.start) < EPS && n.notation?.tremolo?.type === 'stop');
            written = [...chordA, ...chordB];
            span = [a.start, b.start + b.duration];
            const step = 2 ** -t.marks;
            const count = Math.max(2, Math.round((span[1] - span[0]) / step));
            emit([chordA, chordB], Array.from({ length: count }, (_, i) => i % 2), 'tremolo-two-note');
        }
        else if (t.type === 'single') {
            const chord = notes.filter((n) => Math.abs(n.start - a.start) < EPS && n.notation?.tremolo?.type === 'single' && (n.notation?.voice ?? '') === (a.notation?.voice ?? ''));
            written = chord;
            span = [a.start, a.start + a.duration];
            const step = 2 ** -t.marks;
            const count = Math.max(1, Math.round(a.duration / step));
            emit([chord], Array.from({ length: count }, () => 0), 'tremolo-single');
        }
        function emit(groups, order, rule) {
            const [t0, t1] = span;
            const step = (t1 - t0) / order.length;
            // 松葉: トレモロに重なり、終わりの強弱記号がわかるもの
            const v0 = groups[0][0].velocity;
            const w = wedges.find((x) => x.start < t1 - EPS && x.end > t0 + EPS);
            const target = w ? dynamics.find((d) => d.beat >= w.end - EPS && d.beat <= Math.max(w.end, t1) + 1 + EPS && DYNAMICS[d.mark]) : undefined;
            const v1 = target ? DYNAMICS[target.mark] : v0;
            const ok = w && target && ((w.type === 'crescendo' && v1 > v0) || (w.type === 'diminuendo' && v1 < v0));
            const made = [];
            order.forEach((g, i) => {
                const start = t0 + i * step;
                const vel = ok ? Math.round(v0 + ((v1 - v0) * i) / Math.max(1, order.length - 1)) : v0;
                for (const n of groups[g]) {
                    extra.push({ id: nextId(), partId: part.id, midi: n.midi, start, duration: step, velocity: Math.max(1, Math.min(127, vel)) });
                    made.push({ midi: n.midi, start, duration: step });
                }
            });
            for (const n of written) {
                out.delete(n.id);
                done.add(n.id);
            }
            transforms.push({
                kind: 'tremolo', partId: part.id, beat: t0, voice: groups[0][0].notation?.voice ?? '', source: 'musicxml', rule,
                graces: made, changed: written.map((n) => ({ noteId: n.id, start: n.start, duration: n.duration, newStart: n.start, newDuration: 0, velocity: n.velocity, ...(ok ? { newVelocity: v1 } : {}) })),
            });
        }
    }
}
