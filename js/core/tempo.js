/** 拍 ⇔ 秒 の変換。テンポ変化に対応し、負の拍（カウントイン）も最初のテンポで外挿する。 */
export class TempoMap {
    segs;
    constructor(tempos) {
        const sorted = [...tempos].filter((t) => t.bpm > 0).sort((a, b) => a.beat - b.beat);
        if (sorted.length === 0 || sorted[0].beat > 0)
            sorted.unshift({ beat: 0, bpm: sorted[0]?.bpm ?? 100 });
        const segs = [];
        let sec = 0;
        for (let i = 0; i < sorted.length; i++) {
            const t = sorted[i];
            if (i > 0) {
                const prev = segs[segs.length - 1];
                sec = prev.sec + ((t.beat - prev.beat) * 60) / prev.bpm;
                if (Math.abs(t.beat - prev.beat) < 1e-9)
                    segs.pop();
            }
            segs.push({ beat: t.beat, sec, bpm: t.bpm });
        }
        this.segs = segs;
    }
    bpmAt(beat) {
        return this.segAtBeat(beat).bpm;
    }
    beatToSec(beat) {
        const s = this.segAtBeat(beat);
        return s.sec + ((beat - s.beat) * 60) / s.bpm;
    }
    secToBeat(sec) {
        let s = this.segs[0];
        for (const seg of this.segs) {
            if (seg.sec <= sec)
                s = seg;
            else
                break;
        }
        return s.beat + ((sec - s.sec) * s.bpm) / 60;
    }
    segAtBeat(beat) {
        let s = this.segs[0];
        for (const seg of this.segs) {
            if (seg.beat <= beat)
                s = seg;
            else
                break;
        }
        return s;
    }
}
