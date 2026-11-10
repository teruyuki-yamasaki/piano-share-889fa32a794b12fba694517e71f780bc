import { EPS } from "./types.js";
export const ROLE_COLORS = {
    melody: '#4A7DFF',
    accompaniment: '#E3A33C',
    other: '#2FB3A1',
};
const EXTRA_COLORS = ['#2FB3A1', '#A472F2', '#E2607A', '#6FB04A'];
const SHARP_NAMES = [
    ['C', 0], ['C', 1], ['D', 0], ['D', 1], ['E', 0], ['F', 0], ['F', 1], ['G', 0], ['G', 1], ['A', 0], ['A', 1], ['B', 0],
];
const FLAT_NAMES = [
    ['C', 0], ['D', -1], ['D', 0], ['E', -1], ['E', 0], ['F', 0], ['G', -1], ['G', 0], ['A', -1], ['A', 0], ['B', -1], ['B', 0],
];
const STEP_SEMITONE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
export const STEP_INDEX = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };
export function spellingToMidi(s) {
    return (s.octave + 1) * 12 + STEP_SEMITONE[s.step] + s.alter;
}
/** 調号に合わせて MIDI 番号から綴りを推定（シャープ系 or フラット系） */
export function spellMidi(midi, fifths = 0) {
    const pc = ((midi % 12) + 12) % 12;
    const [step, alter] = (fifths < 0 ? FLAT_NAMES : SHARP_NAMES)[pc];
    const octave = Math.floor(midi / 12) - 1;
    return { step, alter, octave };
}
/** "C4", "F#5" のような表示名 */
export function midiName(midi) {
    const s = spellMidi(midi, 0);
    return `${s.step}${s.alter > 0 ? '#' : ''}${s.octave}`;
}
/** 五線上の位置（C0 = 0 から全音階で数えた番号） */
export function diatonic(s) {
    return s.octave * 7 + STEP_INDEX[s.step];
}
export function averagePitch(notes) {
    if (notes.length === 0)
        return 60;
    let sum = 0;
    for (const n of notes)
        sum += n.midi;
    return sum / notes.length;
}
/** 拍子記号・調号のイベント列から小節リストを作る（MIDI 読み込みなど小節情報がない場合） */
export function buildMeasures(timeSigs, keySigs, length) {
    const ts = [...timeSigs].sort((a, b) => a.beat - b.beat);
    if (ts.length === 0 || ts[0].beat > EPS)
        ts.unshift({ beat: 0, numerator: 4, denominator: 4 });
    const ks = [...keySigs].sort((a, b) => a.beat - b.beat);
    const measures = [];
    let beat = 0;
    let i = 0;
    const end = Math.max(length, EPS);
    while (beat < end - EPS && measures.length < 10000) {
        while (i + 1 < ts.length && ts[i + 1].beat <= beat + EPS)
            i++;
        const t = ts[i];
        const len = (t.numerator * 4) / t.denominator;
        let fifths = 0;
        for (const k of ks)
            if (k.beat <= beat + EPS)
                fifths = k.fifths;
        measures.push({
            index: measures.length,
            number: String(measures.length + 1),
            start: beat,
            length: len,
            numerator: t.numerator,
            denominator: t.denominator,
            fifths,
        });
        beat += len;
    }
    return measures;
}
/**
 * インポーターが作った下書きを最終的な Score に整える。
 * - 空パートを除外 / ノートを時間順に整列し ID を付与
 * - ロール（主旋律/伴奏）が未指定なら平均音高から推定
 * - 音部記号・表示色を決定
 */
export function finalizeScore(input) {
    let nextId = 1;
    const parts = [];
    for (const dp of input.parts) {
        if (dp.notes.length === 0)
            continue;
        const sorted = [...dp.notes].sort((a, b) => a.start - b.start || b.midi - a.midi);
        const notes = sorted.map((n) => ({ ...n, id: nextId++, partId: dp.id }));
        const avg = averagePitch(notes);
        parts.push({
            id: dp.id,
            name: dp.name,
            role: dp.role ?? 'other',
            hand: dp.hand,
            ...(dp.player ? { player: dp.player } : {}),
            clef: dp.clef ?? (avg >= 57 ? 'treble' : 'bass'),
            ...(dp.clefChanges?.length ? { clefChanges: dp.clefChanges } : {}),
            ...(dp.rests?.length ? { rests: dp.rests } : {}),
            ...(dp.graces?.length ? { graces: dp.graces } : {}),
            ...(dp.dynamics?.length ? { dynamics: dp.dynamics } : {}),
            ...(dp.wedges?.length ? { wedges: dp.wedges } : {}),
            ...(dp.words?.length ? { words: dp.words } : {}),
            color: '',
            notes,
        });
    }
    // ロール推定: 明示がなければ最も高いパートを主旋律、それ以外を伴奏に
    if (parts.length > 0 && !input.parts.some((p) => p.role)) {
        const byPitch = [...parts].sort((a, b) => averagePitch(b.notes) - averagePitch(a.notes));
        byPitch.forEach((p, i) => (p.role = i === 0 ? 'melody' : 'accompaniment'));
    }
    let extra = 0;
    const usedRoles = new Set();
    for (const p of parts) {
        if (p.role !== 'other' && !usedRoles.has(p.role)) {
            p.color = ROLE_COLORS[p.role];
            usedRoles.add(p.role);
        }
        else {
            p.color = EXTRA_COLORS[extra++ % EXTRA_COLORS.length];
        }
    }
    let length = 0;
    for (const p of parts)
        for (const n of p.notes)
            length = Math.max(length, n.start + n.duration);
    const lastMeasure = input.measures[input.measures.length - 1];
    if (lastMeasure)
        length = Math.max(length, lastMeasure.start + lastMeasure.length);
    const pedals = normalizePedals(input.pedals ?? []);
    return {
        meta: input.meta,
        parts,
        measures: input.measures,
        tempos: input.tempos.length ? input.tempos : [{ beat: 0, bpm: 100, source: 'default' }],
        length,
        ...(pedals.length ? { pedals } : {}),
    };
}
/**
 * ペダルの記録を「踏む / 離す」が交互に並ぶ形に整える。
 * MusicXML は <pedal> と <sound damper-pedal> の両方で同じペダルを書くことがあり、
 * 複数パート・複数トラックにも同じペダルが入るので、重複を取り除く。
 */
export function normalizePedals(events) {
    // 安定ソート: 同じ拍では書かれた順（踏み替えの up → down）を保つ
    const sorted = events.map((e, i) => ({ e, i })).sort((a, b) => a.e.beat - b.e.beat || a.i - b.i).map((x) => x.e);
    const out = [];
    let down = false;
    for (const e of sorted) {
        if (e.down === down)
            continue;
        // 同じ拍で離してすぐ踏む（踏み替え）は残すが、踏んですぐ離す（無意味）は打ち消す
        const last = out[out.length - 1];
        if (last && !e.down && last.down && Math.abs(last.beat - e.beat) < 1e-6) {
            out.pop();
        }
        else {
            out.push({ beat: e.beat, down: e.down });
        }
        down = e.down;
    }
    return out;
}
/**
 * 1 トラックにまとまったピアノ曲を「主旋律（各時刻の最高音）」と「伴奏（残り）」に分ける。
 * MIDI ファイルが単一トラックのときに使う簡易スカイライン法。
 */
export function splitSkyline(notes) {
    const sorted = [...notes].sort((a, b) => a.start - b.start || b.midi - a.midi);
    const melody = [];
    const accompaniment = [];
    let i = 0;
    while (i < sorted.length) {
        let j = i;
        while (j < sorted.length && Math.abs(sorted[j].start - sorted[i].start) < 0.05)
            j++;
        const group = sorted.slice(i, j);
        const top = group[0];
        // 中央 C より十分低い単音は伴奏のまま
        if (top.midi >= 55) {
            melody.push(top);
            accompaniment.push(...group.slice(1));
        }
        else {
            accompaniment.push(...group);
        }
        i = j;
    }
    // 旋律の音が重ならないよう、次の旋律音で切る
    for (let k = 0; k + 1 < melody.length; k++) {
        const gap = melody[k + 1].start - melody[k].start;
        if (melody[k].duration > gap)
            melody[k] = { ...melody[k], duration: gap };
    }
    return { melody, accompaniment };
}
/**
 * パートの切り替えボタンの並び。ピアノの両手は鍵盤の並びに合わせて左手を先に。
 * 連弾（奏者 player のあるパート）は、鍵盤の左側に座る奏者（音の低いセコンド）から、奏者ごとに左手・右手の順
 */
export function partChipOrder(parts) {
    const out = [...parts];
    if (!parts.some((p) => p.player)) {
        const r = out.findIndex((p) => p.hand === 'right');
        const l = out.findIndex((p) => p.hand === 'left');
        if (r >= 0 && l > r)
            [out[r], out[l]] = [out[l], out[r]];
        return out;
    }
    const groups = new Map();
    for (const p of parts)
        groups.set(p.player ?? '', [...(groups.get(p.player ?? '') ?? []), p]);
    const handOrder = (p) => (p.hand === 'left' ? 0 : p.hand === 'right' ? 1 : 2);
    return [...groups.values()]
        .sort((a, b) => averagePitch(a.flatMap((p) => p.notes)) - averagePitch(b.flatMap((p) => p.notes)))
        .flatMap((g) => [...g].sort((a, b) => handOrder(a) - handOrder(b)));
}
export function measureAt(score, beat) {
    const ms = score.measures;
    let lo = 0;
    let hi = ms.length - 1;
    if (hi < 0)
        return undefined;
    if (beat < ms[0].start)
        return ms[0];
    while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (ms[mid].start <= beat + EPS)
            lo = mid;
        else
            hi = mid - 1;
    }
    return ms[lo];
}
