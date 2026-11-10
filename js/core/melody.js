import { EPS } from "./types.js";
const COST = {
    /** 上に 1 音あるごと */
    below: 1.2,
    /** 右手が鳴っている間の左手 */
    leftHand: 1.5,
    /** 右手が休んでいる間の左手（伴奏だけの前奏などを、なるべく旋律にしない） */
    leftAlone: 0.3,
    /** 番号の大きい声部 */
    innerVoice: 0.8,
    /** 長さ（四分音符を基準に 2 倍ごと）。上限 lengthMax */
    length: 0.25,
    lengthMax: 0.4,
    /** 半音ごとの跳躍。1 オクターブを超えた分は leapOver も */
    leap: 0.06,
    leapOver: 0.15,
    /** 譜表（手）の行き来 */
    switchPart: 0.5,
    /** 前の旋律の音が鳴っている途中の発音 */
    overlap: 0.7,
    /** 旋律の音が終わったあと、何も選ばない */
    rest: 0.9,
};
/** 主旋律を探す範囲のパート。両手のある主旋律のパート（ピアノの右手・連弾のプリモ）なら、同じ奏者の両手 */
export function melodyCandidates(score) {
    const melody = score.parts.filter((p) => p.role === 'melody');
    if (!melody.length || melody.every((p) => !p.hand))
        return [];
    const players = new Set(melody.map((p) => p.player));
    return score.parts.filter((p) => p.hand && players.has(p.player));
}
export function extractMelody(score) {
    const parts = melodyCandidates(score);
    if (!parts.length) {
        const melody = score.parts.filter((p) => p.role === 'melody');
        const src = melody.length ? melody : score.parts.slice(0, 1);
        return { ids: new Set(src.flatMap((p) => p.notes.map((n) => n.id))), tracked: false };
    }
    const left = new Set(parts.filter((p) => p.hand === 'left').map((p) => p.id));
    // 右手が入るまで（左手だけの前奏）は伴奏とみなす
    const firstRight = Math.min(...parts.filter((p) => !left.has(p.id)).map((p) => p.notes[0]?.start ?? Infinity));
    const from = Number.isFinite(firstRight) ? firstRight : -Infinity;
    const notes = parts.flatMap((p) => p.notes).filter((n) => n.start >= from - EPS).sort((a, b) => a.start - b.start || b.midi - a.midi);
    // 発音の時点（同じ拍の音をまとめる）
    const slices = [];
    for (const n of notes) {
        const last = slices[slices.length - 1];
        if (last && n.start - last.t < EPS)
            last.notes.push(n);
        else
            slices.push({ t: n.start, notes: [n] });
    }
    const steps = [];
    let prev = [{ cost: 0, back: -1, last: null }];
    let active = [];
    for (const s of slices) {
        active = active.filter((n) => n.start + n.duration > s.t + EPS).concat(s.notes);
        const rightSounding = active.some((n) => !left.has(n.partId));
        const states = [];
        // 候補の音
        for (const n of s.notes) {
            const above = new Set(active.filter((m) => m.midi > n.midi).map((m) => m.midi)).size;
            let e = COST.below * above;
            if (left.has(n.partId))
                e += rightSounding ? COST.leftHand : COST.leftAlone;
            const voices = new Set(active.filter((m) => m.partId === n.partId).map((m) => m.notation?.voice ?? ''));
            if (voices.size > 1 && (n.notation?.voice ?? '') !== [...voices].sort(byVoice)[0])
                e += COST.innerVoice;
            e -= Math.max(-COST.lengthMax, Math.min(COST.lengthMax, COST.length * Math.log2(Math.max(n.duration, EPS))));
            let best = null;
            prev.forEach((p, i) => {
                const c = p.cost + e + transition(p.last, n);
                if (!best || c < best.cost)
                    best = { cost: c, back: i, last: n };
            });
            states.push(best);
        }
        // 何も選ばない（前の旋律の音を伸ばす / 休む）
        let hold = null;
        prev.forEach((p, i) => {
            const c = p.cost + (p.last && p.last.start + p.last.duration > s.t + EPS ? 0 : COST.rest);
            if (!hold || c < hold.cost)
                hold = { cost: c, back: i, last: p.last };
        });
        states.push(hold);
        steps.push(states);
        prev = states;
    }
    const ids = new Set();
    let k = prev.reduce((bi, st, i) => (st.cost < prev[bi].cost ? i : bi), 0);
    for (let i = steps.length - 1; i >= 0; i--) {
        if (k < slices[i].notes.length)
            ids.add(slices[i].notes[k].id);
        k = steps[i][k].back;
    }
    return { ids, tracked: true };
}
function transition(last, n) {
    if (!last)
        return 0;
    const d = Math.abs(n.midi - last.midi);
    let c = COST.leap * d + (d > 12 ? COST.leapOver * (d - 12) : 0);
    if (last.partId !== n.partId)
        c += COST.switchPart;
    if (last.start + last.duration > n.start + EPS)
        c += COST.overlap;
    return c;
}
/** 声部の番号の順（"1" < "2" < "10"）。番号でなければ文字の順 */
function byVoice(a, b) {
    const x = Number(a);
    const y = Number(b);
    return Number.isFinite(x) && Number.isFinite(y) && a !== '' && b !== '' ? x - y : a.localeCompare(b);
}
export function noteKey(n) {
    return `${n.partId}|${Math.round(n.start * 1e4) / 1e4}|${n.midi}`;
}
/** 推定した主旋律（estimate）に手直しを当てた、音の id の集まり */
export function applyMelodyEdits(score, estimate, edits) {
    const add = new Set(edits.add);
    const remove = new Set(edits.remove);
    const ids = new Set();
    for (const p of score.parts) {
        for (const n of p.notes) {
            const k = noteKey(n);
            if (estimate.has(n.id) ? !remove.has(k) : add.has(k))
                ids.add(n.id);
        }
    }
    return ids;
}
/** 音を主旋律に足す / 外す（推定どおりに戻すときは、手直しの記録を消す） */
export function toggleMelodyEdit(edits, n, estimated) {
    const k = noteKey(n);
    const [mine, other] = estimated ? [edits.remove, edits.add] : [edits.add, edits.remove];
    const next = mine.includes(k) ? mine.filter((x) => x !== k) : [...mine, k];
    return estimated ? { add: other, remove: next } : { add: next, remove: other };
}
