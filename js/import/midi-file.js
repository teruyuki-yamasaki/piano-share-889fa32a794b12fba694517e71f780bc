import { buildMeasures, finalizeScore, splitSkyline } from "../core/score-utils.js";
/** Standard MIDI File (format 0/1) を読む */
export function parseMidiFile(bytes, fileName = 'MIDI') {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const str4 = (p) => String.fromCharCode(bytes[p], bytes[p + 1], bytes[p + 2], bytes[p + 3]);
    if (str4(0) !== 'MThd')
        throw new Error('MIDI ファイルとして読めませんでした');
    const headerLen = dv.getUint32(4);
    const format = dv.getUint16(8);
    const ntracks = dv.getUint16(10);
    const division = dv.getUint16(12);
    if (division & 0x8000)
        throw new Error('SMPTE タイムベースの MIDI にはまだ対応していません');
    const ppq = division;
    const tempoTicks = [];
    const timeSigTicks = [];
    /** ダンパーペダル（CC64）。ドラム以外の全チャンネルから集め、あとで重複を除く */
    const pedalTicks = [];
    const keySigTicks = [];
    const tracks = [];
    const td = new TextDecoder();
    let p = 8 + headerLen;
    for (let t = 0; t < ntracks && p + 8 <= bytes.length; t++) {
        const id = str4(p);
        const len = dv.getUint32(p + 4);
        const end = p + 8 + len;
        if (id !== 'MTrk') {
            p = end;
            continue;
        }
        let q = p + 8;
        let tick = 0;
        let status = 0;
        const track = { notes: [] };
        const open = new Map();
        const readVar = () => {
            let v = 0;
            for (let k = 0; k < 4; k++) {
                const b = bytes[q++];
                v = (v << 7) | (b & 0x7f);
                if (!(b & 0x80))
                    break;
            }
            return v;
        };
        const noteOff = (ch, midi) => {
            const key = ch * 128 + midi;
            const list = open.get(key);
            const on = list?.shift();
            if (on)
                track.notes.push({ ch, midi, startTick: on.tick, endTick: tick, velocity: on.velocity });
        };
        while (q < end) {
            tick += readVar();
            let b = bytes[q];
            if (b & 0x80) {
                q++;
                if (b < 0xf0)
                    status = b;
            }
            else {
                b = status; // running status
            }
            if (b === 0xff) {
                const type = bytes[q++];
                const l = readVar();
                const d = bytes.subarray(q, q + l);
                if (type === 0x51 && l >= 3)
                    tempoTicks.push({ tick, bpm: 60000000 / ((d[0] << 16) | (d[1] << 8) | d[2]) });
                else if (type === 0x58 && l >= 2)
                    timeSigTicks.push({ tick, numerator: d[0], denominator: 2 ** d[1] });
                else if (type === 0x59 && l >= 1)
                    keySigTicks.push({ tick, fifths: (d[0] << 24) >> 24 });
                else if (type === 0x03 && !track.name)
                    track.name = td.decode(d).trim();
                q += l;
            }
            else if (b === 0xf0 || b === 0xf7) {
                q += readVar();
            }
            else {
                const kind = b & 0xf0;
                const ch = b & 0x0f;
                const d1 = bytes[q++];
                const d2 = kind === 0xc0 || kind === 0xd0 ? 0 : bytes[q++];
                if (kind === 0x90 && d2 > 0) {
                    const key = ch * 128 + d1;
                    if (!open.has(key))
                        open.set(key, []);
                    open.get(key).push({ tick, velocity: d2 });
                }
                else if (kind === 0x80 || (kind === 0x90 && d2 === 0)) {
                    noteOff(ch, d1);
                }
                else if (kind === 0xb0 && d1 === 64 && ch !== 9) {
                    pedalTicks.push({ tick, down: d2 >= 64 });
                }
            }
        }
        // 閉じられていないノートはトラック末尾で閉じる
        for (const [key, list] of open)
            for (const on of list)
                track.notes.push({ ch: key >> 7, midi: key & 127, startTick: on.tick, endTick: tick, velocity: on.velocity });
        tracks.push(track);
        p = end;
    }
    // format 0 はチャンネルごとに分割
    let groups = [];
    if (format === 0) {
        const byCh = new Map();
        for (const tr of tracks)
            for (const n of tr.notes) {
                if (!byCh.has(n.ch))
                    byCh.set(n.ch, []);
                byCh.get(n.ch).push(n);
            }
        for (const [ch, notes] of byCh)
            groups.push({ name: `チャンネル ${ch + 1}`, notes });
    }
    else {
        tracks.forEach((tr, i) => groups.push({ name: tr.name || `トラック ${i + 1}`, notes: tr.notes }));
    }
    // ドラム（チャンネル 10）は除外
    groups = groups.map((g) => ({ ...g, notes: g.notes.filter((n) => n.ch !== 9) })).filter((g) => g.notes.length > 0);
    const toBeats = (tick) => tick / ppq;
    let drafts = groups.map((g, i) => ({
        id: `T${i + 1}`,
        name: g.name,
        notes: g.notes.map((n) => ({
            midi: n.midi,
            start: toBeats(n.startTick),
            duration: Math.max(toBeats(n.endTick - n.startTick), 1 / 32),
            velocity: n.velocity,
        })),
    }));
    // 1 パートだけのピアノ曲は、主旋律と伴奏に自動分割
    if (drafts.length === 1) {
        const { melody, accompaniment } = splitSkyline(drafts[0].notes);
        if (melody.length > 0 && accompaniment.length > 0) {
            drafts = [
                { id: 'melody', name: '主旋律', role: 'melody', hand: 'right', notes: melody },
                { id: 'accomp', name: '伴奏', role: 'accompaniment', hand: 'left', notes: accompaniment },
            ];
        }
    }
    let length = 0;
    for (const d of drafts)
        for (const n of d.notes)
            length = Math.max(length, n.start + n.duration);
    const tempos = tempoTicks.map((t) => ({ beat: toBeats(t.tick), bpm: t.bpm }));
    const ts = timeSigTicks.map((t) => ({ beat: toBeats(t.tick), numerator: t.numerator, denominator: t.denominator }));
    const ks = keySigTicks.map((k) => ({ beat: toBeats(k.tick), fifths: k.fifths }));
    return finalizeScore({
        meta: { title: fileName.replace(/\.(mid|midi)$/i, ''), source: 'midi' },
        parts: drafts,
        measures: buildMeasures(ts, ks, length),
        tempos,
        pedals: pedalTicks.map((p) => ({ beat: toBeats(p.tick), down: p.down })),
    });
}
export const midiFileImporter = {
    id: 'midi',
    label: 'MIDI ファイル',
    extensions: ['mid', 'midi'],
    async import(src) {
        return parseMidiFile(src.bytes, src.name);
    },
};
