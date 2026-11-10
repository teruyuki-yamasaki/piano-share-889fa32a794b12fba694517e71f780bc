import { EPS } from "../core/types.js";
/**
 * ウェイトモードの判定。ユーザーが弾くパートのノートを「同時に鳴らす音のまとまり（グループ）」に分け、
 * 現在のグループの音がすべて押されたら次へ進める。和音は同時に押さなくてもよい（初心者向け）。
 */
export class FollowTracker {
    groups = [];
    index = 0;
    /** 何拍前まで先取りして弾いてよいか */
    earlyWindow = 1;
    constructor(notes, rangeStart = -Infinity, rangeEnd = Infinity) {
        const sorted = notes
            .filter((n) => n.start >= rangeStart - EPS && n.start < rangeEnd - EPS)
            .sort((a, b) => a.start - b.start);
        for (const n of sorted) {
            const last = this.groups[this.groups.length - 1];
            if (last && Math.abs(last.beat - n.start) < 1e-3) {
                if (!last.midis.includes(n.midi))
                    last.midis.push(n.midi);
                last.noteIds.push(n.id);
            }
            else {
                this.groups.push({ beat: n.start, midis: [n.midi], noteIds: [n.id], pressed: new Set() });
            }
        }
    }
    get current() {
        return this.groups[this.index];
    }
    get finished() {
        return this.index >= this.groups.length;
    }
    /** 位置 beat 以降の最初のグループから再開 */
    reset(beat) {
        for (const g of this.groups)
            g.pressed.clear();
        this.index = this.groups.findIndex((g) => g.beat >= beat - EPS);
        if (this.index < 0)
            this.index = this.groups.length;
    }
    /** anyOfChord: 和音のどれか 1 音で、その和音を弾けたことにする（単音しか拾えないマイク入力向け） */
    press(midi, position, anyOfChord = false) {
        const g = this.current;
        if (!g)
            return { kind: 'done' };
        if (!g.midis.includes(midi))
            return { kind: 'wrong' };
        if (position < g.beat - this.earlyWindow)
            return { kind: 'early' };
        if (anyOfChord)
            for (const m of g.midis)
                g.pressed.add(m);
        g.pressed.add(midi);
        if (g.midis.every((m) => g.pressed.has(m))) {
            this.index++;
            return { kind: 'complete', group: g };
        }
        return { kind: 'progress', group: g };
    }
}
