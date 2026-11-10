const PPQ = 480;
function varLen(v) {
    const out = [v & 0x7f];
    v >>= 7;
    while (v > 0) {
        out.unshift((v & 0x7f) | 0x80);
        v >>= 7;
    }
    return out;
}
function chunk(id, data) {
    const len = data.length;
    return [...[...id].map((c) => c.charCodeAt(0)), (len >>> 24) & 255, (len >>> 16) & 255, (len >>> 8) & 255, len & 255, ...data];
}
function textMeta(type, s) {
    const b = [...new TextEncoder().encode(s)];
    return [0xff, type, ...varLen(b.length), ...b];
}
/** Score を Standard MIDI File (format 1) に書き出す。パートごとに 1 トラック。 */
export function scoreToMidi(score) {
    const tracks = [];
    // 0: 曲情報・テンポ・拍子
    const conductor = [{ tick: 0, data: textMeta(0x03, score.meta.title) }];
    for (const t of score.tempos) {
        const us = Math.round(60000000 / t.bpm);
        conductor.push({ tick: Math.round(t.beat * PPQ), data: [0xff, 0x51, 3, (us >> 16) & 255, (us >> 8) & 255, us & 255] });
    }
    let prevSig = '';
    for (const m of score.measures) {
        const sig = `${m.numerator}/${m.denominator}`;
        if (sig !== prevSig) {
            conductor.push({ tick: Math.round(m.start * PPQ), data: [0xff, 0x58, 4, m.numerator, Math.round(Math.log2(m.denominator)), 24, 8] });
            prevSig = sig;
        }
    }
    tracks.push(encodeEvents(conductor));
    score.parts.forEach((part, i) => {
        const ch = Math.min(i, 8);
        const evs = [{ tick: 0, data: textMeta(0x03, part.player ? `${part.player} ${part.name}` : part.name), order: 0 }];
        evs.push({ tick: 0, data: [0xc0 | ch, 0], order: 0 });
        // ペダルはピアノ全体のものなので、各パートのチャンネルに同じものを書く
        for (const p of score.pedals ?? [])
            evs.push({ tick: Math.round(p.beat * PPQ), data: [0xb0 | ch, 64, p.down ? 127 : 0], order: p.down ? 3 : 0 });
        for (const n of part.notes) {
            evs.push({ tick: Math.round(n.start * PPQ), data: [0x90 | ch, n.midi, Math.max(1, Math.min(127, n.velocity))], order: 2 });
            evs.push({ tick: Math.round((n.start + n.duration) * PPQ), data: [0x80 | ch, n.midi, 0], order: 1 });
        }
        evs.sort((a, b) => a.tick - b.tick || a.order - b.order);
        tracks.push(encodeEvents(evs));
    });
    const header = chunk('MThd', [0, 1, 0, tracks.length, (PPQ >> 8) & 255, PPQ & 255]);
    const body = tracks.flatMap((t) => chunk('MTrk', t));
    return new Uint8Array([...header, ...body]);
}
function encodeEvents(evs) {
    const sorted = [...evs].sort((a, b) => a.tick - b.tick);
    const out = [];
    let last = 0;
    for (const e of sorted) {
        out.push(...varLen(Math.max(0, e.tick - last)), ...e.data);
        last = e.tick;
    }
    out.push(0, 0xff, 0x2f, 0);
    return out;
}
