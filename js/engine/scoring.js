import { measureAt } from "../core/score-utils.js";
import { EPS } from "../core/types.js";
/** タイミングのずれ（ミリ秒）の判定幅 */
export const GRADE_WINDOWS_MS = { perfect: 50, great: 100, good: 200 };
export function gradeFor(offsetMs) {
    const a = Math.abs(offsetMs);
    if (a <= GRADE_WINDOWS_MS.perfect)
        return 'perfect';
    if (a <= GRADE_WINDOWS_MS.great)
        return 'great';
    if (a <= GRADE_WINDOWS_MS.good)
        return 'good';
    return 'miss';
}
const GRADE_POINTS = { perfect: 1, great: 0.85, good: 0.6, miss: 0 };
/** 1 音あたりの得点（0..1） */
export function notePoints(j) {
    if (j.grade === 'miss')
        return 0;
    let p = GRADE_POINTS[j.grade];
    // 長さ: 最後まで押さえていれば満点、すぐ離すと最大 25% 減
    if (j.hold !== undefined)
        p *= 0.75 + 0.25 * Math.max(0, Math.min(1, j.hold));
    // 音程: 50 セントずれで最大 30% 減（半音ずれは別の音として判定されるのでここには来ない）
    if (j.cents !== undefined)
        p *= 1 - 0.3 * Math.min(1, Math.abs(j.cents) / 50);
    return p;
}
/** 間違った音 1 回あたり、何音ぶんの得点を引くか */
const WRONG_PENALTY = 0.25;
export function summarize(score, notes, judgements, wrong) {
    const byId = new Map(judgements.map((j) => [j.noteId, j]));
    const counts = { perfect: 0, great: 0, good: 0, miss: 0 };
    const perMeasure = new Map();
    let pts = 0;
    for (const n of notes) {
        const j = byId.get(n.id) ?? { noteId: n.id, grade: 'miss', offsetMs: 0 };
        counts[j.grade]++;
        const p = notePoints(j);
        pts += p;
        const m = measureAt(score, n.start + EPS);
        if (m) {
            const e = perMeasure.get(m.index) ?? { pts: 0, n: 0, number: m.number };
            e.pts += p;
            e.n++;
            perMeasure.set(m.index, e);
        }
    }
    const hits = judgements.filter((j) => j.grade !== 'miss' && notes.some((n) => n.id === j.noteId));
    const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
    const total = notes.length;
    return {
        score: total ? Math.round(Math.max(0, (pts - WRONG_PENALTY * wrong) / total) * 100) : 0,
        total,
        counts,
        wrong,
        meanOffsetMs: Math.round(avg(hits.map((j) => j.offsetMs)) ?? 0),
        meanAbsOffsetMs: Math.round(avg(hits.map((j) => Math.abs(j.offsetMs))) ?? 0),
        meanHold: avg(hits.filter((j) => j.hold !== undefined).map((j) => j.hold)),
        meanAbsCents: avg(hits.filter((j) => j.cents !== undefined).map((j) => Math.abs(j.cents))),
        measures: [...perMeasure.entries()].sort((a, b) => a[0] - b[0]).map(([, e]) => ({ number: e.number, ratio: e.pts / e.n })),
    };
}
export function rangeLabel(score, start, end) {
    if (start <= EPS && end >= score.length - EPS)
        return undefined;
    const a = measureAt(score, start + EPS);
    const b = measureAt(score, end - EPS);
    return a && b ? `${a.number}-${b.number}` : undefined;
}
