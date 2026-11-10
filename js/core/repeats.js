import { TempoMap } from "./tempo.js";
import { EPS } from "./types.js";
/**
 * 反復記号・n 番かっこ・D.C.・D.S.・Fine・コーダに従った、小節を弾く順番（小節の index の並び）。
 * - 反復区間は 𝄆 から（なければ曲の頭か、前の反復の終わりの次から）𝄇 まで、指定の回数（ふつう 2 回）弾く
 * - n 番かっこは、いま何回目かで弾くかっこを選ぶ（番号のない回は、最後のかっこ）
 * - D.C. / D.S. で戻るのは 1 回だけ。戻ったあとは反復せず、かっこは最後のものを弾き、Fine で終わり、To Coda でコーダへ飛ぶ
 */
export function playOrder(measures) {
    const n = measures.length;
    // n 番かっこのまとまり（同じ番号の続いた小節）と、隣りあうかっこの組
    const blocks = [];
    for (let i = 0; i < n; i++) {
        const e = measures[i].repeat?.ending;
        if (!e)
            continue;
        const prev = blocks[blocks.length - 1];
        if (prev && prev.end === i - 1 && measures[i - 1].repeat?.ending === e)
            prev.end = i;
        else
            blocks.push({ numbers: e, start: i, end: i, groupEnd: i, groupMax: 0, last: true });
    }
    for (let k = 0; k < blocks.length;) {
        let j = k;
        while (j + 1 < blocks.length && blocks[j + 1].start === blocks[j].end + 1)
            j++;
        const groupMax = Math.max(...blocks.slice(k, j + 1).flatMap((b) => b.numbers));
        // 戻る反復記号のない（読み取りの崩れた）かっこの組は、かっことして扱わずにそのまま弾く
        const repeats = blocks.slice(k, j).some((b) => measures.slice(b.start, b.end + 1).some((m) => m.repeat?.backward));
        for (let x = k; x <= j; x++)
            Object.assign(blocks[x], { groupEnd: blocks[j].end, groupMax, last: x === j, ignore: !repeats });
        k = j + 1;
    }
    const blockAt = new Map(blocks.filter((b) => !b.ignore).map((b) => [b.start, b]));
    const groupEnds = new Set(blocks.filter((b) => !b.ignore).map((b) => b.groupEnd));
    const segnos = measures.filter((m) => m.repeat?.segno).map((m) => m.index);
    const codas = measures.filter((m) => m.repeat?.coda).map((m) => m.index);
    const order = [];
    const counts = new Map();
    let i = 0;
    let pass = 1;
    let sectionStart = 0;
    let jumped = false;
    let back = false;
    const limit = n * 20 + 100;
    while (i < n && order.length < limit) {
        const b = blockAt.get(i);
        if (b) {
            const p = jumped ? Infinity : pass;
            if (!b.numbers.includes(p) && !(p > b.groupMax && b.last)) {
                i = b.end + 1;
                if (b.end === b.groupEnd) {
                    pass = 1;
                    sectionStart = i;
                }
                continue;
            }
        }
        const r = measures[i].repeat ?? {};
        if (r.forward && !back) {
            sectionStart = i;
            pass = 1;
        }
        back = false;
        order.push(i);
        if (jumped && r.fine)
            break;
        if (jumped && r.toCoda) {
            const c = codas.find((x) => x > i);
            if (c !== undefined) {
                i = c;
                continue;
            }
        }
        if (r.backward && !jumped) {
            const c = counts.get(i) ?? 1;
            if (c < r.backward) {
                counts.set(i, c + 1);
                pass = c + 1;
                i = sectionStart;
                back = true;
                continue;
            }
            counts.delete(i);
            pass = 1;
            sectionStart = i + 1;
        }
        if (!jumped && (r.daCapo || r.dalSegno)) {
            const target = r.daCapo ? 0 : ([...segnos].reverse().find((s) => s <= i) ?? segnos[0]);
            if (target !== undefined) {
                jumped = true;
                i = target;
                continue;
            }
        }
        if (groupEnds.has(i)) {
            pass = 1;
            sectionStart = i + 1;
        }
        i++;
    }
    return order;
}
/**
 * 楽譜（written）と、反復を展開した演奏用の楽曲（played）の対応。
 * 演奏のエンジンは played を一直線に鳴らし、楽譜の表示は位置と音を written に読み替える。
 * 反復のない曲では played = written（読み替えはそのまま）
 */
export class PlayMap {
    written;
    played;
    segments;
    /** played の音の id → written の音の id */
    source = new Map();
    /** written の音の id → played での出現（拍の順） */
    occurrences = new Map();
    statusCache = null;
    constructor(written) {
        this.written = written;
        const order = playOrder(written.measures);
        const identity = order.length === written.measures.length && order.every((m, i) => m === i);
        if (identity) {
            this.played = written;
            this.segments = written.measures.map((m) => ({ playedStart: m.start, writtenStart: m.start, length: m.length, measure: m.index }));
            return;
        }
        let t = 0;
        this.segments = order.map((mi) => {
            const m = written.measures[mi];
            const s = { playedStart: t, writtenStart: m.start, length: m.length, measure: mi };
            t += m.length;
            return s;
        });
        this.played = this.unfold();
    }
    get unfolded() {
        return this.played !== this.written;
    }
    /** played の拍が入っている小節（の segments の位置） */
    segmentIndexAt(beat) {
        const segs = this.segments;
        let lo = 0;
        let hi = segs.length - 1;
        while (lo < hi) {
            const mid = (lo + hi + 1) >> 1;
            if (segs[mid].playedStart <= beat + EPS)
                lo = mid;
            else
                hi = mid - 1;
        }
        return lo;
    }
    /** played の拍 → 楽譜の拍 */
    toWritten(beat) {
        if (!this.unfolded)
            return beat;
        const s = this.segments[this.segmentIndexAt(beat)];
        if (!s)
            return beat;
        // カウント中（曲の頭より前）は、そのまま前へ
        const off = beat - s.playedStart;
        return s.writtenStart + (beat < 0 ? off : Math.min(Math.max(off, 0), s.length));
    }
    /** 楽譜の小節 → played でのその小節の始まり。何度も弾く小節は near にいちばん近い回 */
    measureStart(measure, near = 0) {
        let best;
        for (const s of this.segments) {
            if (s.measure !== measure)
                continue;
            if (!best || Math.abs(s.playedStart - near) < Math.abs(best.playedStart - near))
                best = s;
        }
        return best ? best.playedStart : (this.written.measures[measure]?.start ?? 0);
    }
    /** 楽譜の小節 a〜b（くり返し区間）→ played の範囲。a の最初の回から、そのあと初めて b を弾き終えるまで */
    playedRange(a, b) {
        const ia = Math.max(0, this.segments.findIndex((s) => s.measure === a));
        let ib = this.segments.findIndex((s, k) => k >= ia && s.measure === b);
        if (ib < 0)
            ib = ia;
        const sb = this.segments[ib];
        return { start: this.segments[ia].playedStart, end: sb.playedStart + sb.length };
    }
    writtenId(playedId) {
        return this.unfolded ? this.source.get(playedId) : playedId;
    }
    /**
     * 楽譜に描く音の状態（弾けた・見逃し）。何度も弾く音は、カーソルより前の音は直前の回、後ろの音はこれから弾く回の状態
     */
    writtenStatus(status, version, pos) {
        if (!this.unfolded)
            return status;
        const seg = this.segmentIndexAt(pos);
        const key = `${version}|${seg}`;
        if (this.statusCache?.key === key)
            return this.statusCache.map;
        const wpos = this.toWritten(pos);
        const map = new Map();
        const seen = new Set();
        for (const pid of status.keys()) {
            const wid = this.source.get(pid);
            if (wid === undefined || seen.has(wid))
                continue;
            seen.add(wid);
            const occ = this.occurrences.get(wid);
            const wnote = occ.length ? this.writtenStart(wid) : 0;
            let pick;
            if (wnote >= wpos - EPS)
                pick = occ.find((o) => o.start >= pos - EPS) ?? occ[occ.length - 1];
            else
                pick = [...occ].reverse().find((o) => o.start < pos + EPS) ?? occ[0];
            const st = pick && status.get(pick.id);
            if (st !== undefined)
                map.set(wid, st);
        }
        this.statusCache = { key, map: map };
        return map;
    }
    writtenStarts = new Map();
    writtenStart(wid) {
        return this.writtenStarts.get(wid) ?? 0;
    }
    /** 演奏の順番どおりに小節を並べ直した楽曲を作る */
    unfold() {
        const w = this.written;
        const segs = this.segments;
        const tempo = new TempoMap(w.tempos);
        // 次に弾く小節が楽譜でもすぐ次の小節か（タイなどで小節をまたぐ音を、飛ぶところで切る）
        const contiguous = (k) => k + 1 < segs.length && segs[k + 1].measure === segs[k].measure + 1;
        const inSeg = (s, beat) => beat >= s.writtenStart - EPS && beat < s.writtenStart + s.length - EPS;
        /** 音などを、それが始まる小節ごとに写す */
        const copy = (items, startOf, place) => {
            const out = [];
            if (!items)
                return out;
            segs.forEach((s, k) => {
                const delta = s.playedStart - s.writtenStart;
                for (const x of items)
                    if (inSeg(s, startOf(x)))
                        out.push(place(x, delta, k));
            });
            return out;
        };
        /** played の k 番目の小節から始まる音の、続けて弾ける終わり（written の拍） */
        const reach = (k) => {
            let e = segs[k].writtenStart + segs[k].length;
            while (contiguous(k))
                e = segs[++k].writtenStart + segs[k].length;
            return e;
        };
        let nextId = 0;
        const parts = w.parts.map((p) => {
            const notes = copy(p.notes, (n) => n.start, (n, delta, k) => {
                const end = Math.min(n.start + n.duration, reach(k));
                const id = nextId++;
                this.source.set(id, n.id);
                this.writtenStarts.set(n.id, n.start);
                const list = this.occurrences.get(n.id) ?? (this.occurrences.set(n.id, []), this.occurrences.get(n.id));
                list.push({ id, start: n.start + delta });
                const note = { ...n, id, start: n.start + delta, duration: Math.max(end - n.start, EPS) };
                if (n.notation?.pieces) {
                    note.notation = { ...n.notation, pieces: n.notation.pieces.map((pc) => ({ ...pc, start: pc.start + delta })) };
                }
                return note;
            }).sort((a, b) => a.start - b.start);
            const part = { ...p, notes };
            delete part.clefChanges;
            if (p.rests)
                part.rests = copy(p.rests, (r) => r.start, (r, d) => ({ ...r, start: r.start + d }));
            if (p.graces)
                part.graces = copy(p.graces, (g) => g.start, (g, d) => ({ ...g, start: g.start + d }));
            if (p.dynamics)
                part.dynamics = copy(p.dynamics, (x) => x.beat, (x, d) => ({ ...x, beat: x.beat + d }));
            if (p.words)
                part.words = copy(p.words, (x) => x.beat, (x, d) => ({ ...x, beat: x.beat + d }));
            if (p.wedges)
                part.wedges = copy(p.wedges, (x) => x.start, (x, d, k) => ({ ...x, start: x.start + d, end: Math.min(x.end, reach(k)) + d }));
            return part;
        });
        // テンポとペダル: 飛んだ先では、楽譜のその位置で効いている状態から始める
        const tempos = [];
        const pedals = [];
        let pedalDown = false;
        const wp = w.pedals ?? [];
        segs.forEach((s, k) => {
            const delta = s.playedStart - s.writtenStart;
            const jumpedIn = k === 0 || segs[k - 1].measure + 1 !== s.measure;
            if (jumpedIn) {
                tempos.push({ beat: s.playedStart, bpm: tempo.bpmAt(s.writtenStart) });
                let want = false;
                for (const e of wp)
                    if (e.beat < s.writtenStart - EPS)
                        want = e.down;
                if (want !== pedalDown && w.pedals) {
                    pedals.push({ beat: s.playedStart, down: want });
                    pedalDown = want;
                }
            }
            for (const t of w.tempos)
                if (inSeg(s, t.beat) && !(jumpedIn && Math.abs(t.beat - s.writtenStart) < EPS && t.bpm === tempo.bpmAt(s.writtenStart)))
                    tempos.push({ ...t, beat: t.beat + delta });
            for (const e of wp) {
                if (!inSeg(s, e.beat))
                    continue;
                pedals.push({ beat: e.beat + delta, down: e.down });
                pedalDown = e.down;
            }
        });
        const measures = segs.map((s, k) => {
            const m = w.measures[s.measure];
            const { repeat: _r, newSystem: _n, ...rest } = m;
            return { ...rest, index: k, start: s.playedStart };
        });
        const last = segs[segs.length - 1];
        return {
            ...w,
            parts,
            measures,
            tempos,
            ...(w.pedals ? { pedals } : {}),
            length: last ? last.playedStart + last.length : 0,
        };
    }
}
