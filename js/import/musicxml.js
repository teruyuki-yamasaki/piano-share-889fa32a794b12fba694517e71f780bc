import { buildMeasures, finalizeScore, spellingToMidi } from "../core/score-utils.js";
import { DYNAMICS, wordKind } from "../core/types.js";
import { child, children, numOf, parseXml, textOf } from "../io/xml.js";
import { isZip, readZip } from "../io/zip.js";
/** .mxl（圧縮）または .musicxml/.xml のバイト列から XML 文字列を取り出す */
export async function musicXmlText(bytes) {
    if (!isZip(bytes))
        return new TextDecoder().decode(bytes);
    const entries = readZip(bytes);
    let path;
    const container = entries.find((e) => e.name === 'META-INF/container.xml');
    if (container) {
        const doc = parseXml(new TextDecoder().decode(await container.read()));
        const find = (el) => {
            if (el.name === 'rootfile' && el.attrs['full-path'])
                return el.attrs['full-path'];
            for (const c of el.children) {
                const r = find(c);
                if (r)
                    return r;
            }
            return undefined;
        };
        path = find(doc);
    }
    const entry = entries.find((e) => e.name === path) ??
        entries.find((e) => !e.name.startsWith('META-INF') && /\.(musicxml|xml)$/i.test(e.name));
    if (!entry)
        throw new Error('.mxl 内に MusicXML が見つかりませんでした');
    return new TextDecoder().decode(await entry.read());
}
/** <note> の書き方（音符の種類・付点・声部・符幹・連桁・連符・トレモロ） */
/** <clef> → 音部記号（ト音・ヘ音・ハ音（第 3・4 線）と、オクターブ付き）。打楽器記号などは null */
function clefOf(c) {
    const sign = textOf(c, 'sign');
    const line = numOf(c, 'line');
    const oct = numOf(c, 'clef-octave-change') ?? 0;
    const base = sign === 'G' ? 'treble' : sign === 'F' ? 'bass' : sign === 'C' ? (line === 4 ? 'tenor' : 'alto') : null;
    if (!base)
        return null;
    if (oct && (base === 'treble' || base === 'bass'))
        return `${base}${oct < 0 ? '8vb' : '8va'}`;
    return base;
}
const ARTICULATIONS = new Set(['staccato', 'staccatissimo', 'accent', 'strong-accent', 'tenuto']);
function readNotation(el) {
    const n = {};
    const type = textOf(el, 'type');
    if (type)
        n.type = type;
    const dots = children(el, 'dot').length;
    if (dots)
        n.dots = dots;
    const voice = textOf(el, 'voice');
    if (voice)
        n.voice = voice;
    const stem = textOf(el, 'stem');
    if (stem === 'up' || stem === 'down')
        n.stem = stem;
    const acc = textOf(el, 'accidental');
    if (acc)
        n.accidental = acc;
    const beams = [];
    for (const b of children(el, 'beam')) {
        const level = Number(b.attrs.number ?? 1);
        if (level >= 1 && level <= 6)
            beams[level - 1] = b.text.trim();
    }
    if (beams.length)
        n.beams = Array.from(beams, (b) => b ?? '');
    const tm = child(el, 'time-modification');
    const notations = child(el, 'notations');
    const orn = notations ? child(notations, 'ornaments') : undefined;
    const trem = orn ? child(orn, 'tremolo') : undefined;
    // 二音間トレモロの 2:1 は、記譜音価の半分を占めるための指定。
    // 連符の数字「2」としては表示しない。
    const tremoloRatio = trem && (trem.attrs.type === 'start' || trem.attrs.type === 'stop')
        && numOf(tm, 'actual-notes') === 2 && numOf(tm, 'normal-notes') === 1;
    if (tm && !tremoloRatio) {
        n.tuplet = { actual: numOf(tm, 'actual-notes') ?? 3, normal: numOf(tm, 'normal-notes') ?? 2 };
        for (const t of notations ? children(notations, 'tuplet') : []) {
            if (t.attrs.type === 'start') {
                n.tuplet.start = true;
                if (t.attrs.bracket !== undefined)
                    n.tuplet.bracket = t.attrs.bracket === 'yes';
                if (t.attrs.placement === 'above' || t.attrs.placement === 'below')
                    n.tuplet.placement = t.attrs.placement;
                n.tuplet.showNumber = t.attrs['show-number'] !== 'none';
            }
            if (t.attrs.type === 'stop')
                n.tuplet.stop = true;
        }
    }
    if (trem) {
        const t = trem.attrs.type;
        n.tremolo = { type: t === 'start' || t === 'stop' ? t : 'single', marks: Number(trem.text.trim()) || 3 };
    }
    if (notations) {
        const arts = child(notations, 'articulations');
        const names = arts ? arts.children.map((a) => a.name).filter((a) => ARTICULATIONS.has(a)) : [];
        if (names.length)
            n.articulations = names;
        const ferm = child(notations, 'fermata');
        if (ferm) {
            n.fermata = true;
            // type がなければ upright（MusicXML の既定）
            n.fermataPlacement = ferm.attrs.type === 'inverted' ? 'below' : 'above';
        }
        if (child(notations, 'arpeggiate'))
            n.arpeggiate = true;
        const gl = [...children(notations, 'glissando'), ...children(notations, 'slide')]
            .filter((g) => g.attrs.type === 'start' || g.attrs.type === 'stop')
            .map((g) => ({
            type: g.attrs.type,
            number: Number(g.attrs.number ?? 1),
            line: (g.attrs['line-type'] ?? (g.name === 'glissando' ? 'wavy' : 'solid')) === 'wavy' ? 'wavy' : 'solid',
        }));
        if (gl.length)
            n.glissando = gl;
        const slurs = children(notations, 'slur')
            .filter((sl) => sl.attrs.type === 'start' || sl.attrs.type === 'stop' || sl.attrs.type === 'continue')
            .map((sl) => ({
            type: sl.attrs.type,
            number: Number(sl.attrs.number ?? 1),
            ...(sl.attrs.placement === 'above' || sl.attrs.placement === 'below' ? { placement: sl.attrs.placement } : {}),
        }));
        if (slurs.length)
            n.slurs = slurs;
    }
    return n;
}
export function parseMusicXml(xml, sourceLabel = 'musicxml') {
    const doc = parseXml(xml);
    const root = doc.children.find((c) => c.name === 'score-partwise');
    if (!root) {
        if (doc.children.some((c) => c.name === 'score-timewise')) {
            throw new Error('score-timewise 形式の MusicXML にはまだ対応していません');
        }
        throw new Error('MusicXML（score-partwise）として読めませんでした');
    }
    const title = textOf(child(root, 'work'), 'work-title') || textOf(root, 'movement-title') || '無題';
    const ident = child(root, 'identification');
    const composer = children(ident, 'creator').find((c) => c.attrs.type === 'composer')?.text.trim();
    const rights = textOf(ident, 'rights');
    const partNames = new Map();
    for (const sp of children(child(root, 'part-list'), 'score-part')) {
        partNames.set(sp.attrs.id, textOf(sp, 'part-name') || sp.attrs.id);
    }
    const tempos = [];
    // テンポの候補（どのパートの、どの要素か）。最後に、同じ拍のものを 1 つにまとめる（mergeTempos）
    const tempoCands = [];
    const pedals = [];
    let measures = [];
    const draftParts = [];
    const xmlParts = children(root, 'part');
    // 演奏の順番の指示（小節の番号順 → 印）。最後に resolveRepeats で小節に付ける
    const marks = new Map();
    const markAt = (i) => marks.get(i) ?? (marks.set(i, {}), marks.get(i));
    // 連桁のまとまりの番号は曲全体で通し番号にする（パートごとに 1 から数えると、連弾のプリモとセコンドの同じ番号を
    // 「譜表をまたぐ連桁」と取り違える）
    let beamSeq = 0;
    // 2 つ以上の譜表を持つパートが複数ある（連弾・2 台ピアノ）。譜表ごとのパートに、どの奏者のものかを付ける
    const multiStaffParts = xmlParts.filter((p) => children(p, 'measure').some((m) => children(m, 'attributes').some((a) => (numOf(a, 'staves') ?? 1) >= 2)));
    const ensemble = xmlParts.length >= 2 && multiStaffParts.length === xmlParts.length;
    const ensembleDrafts = [];
    xmlParts.forEach((part, partIndex) => {
        let divisions = 1;
        let staves = 1;
        let numerator = 4;
        let denominator = 4;
        let fifths = 0;
        let velocity = 72;
        let measureStart = 0;
        const clefs = new Map();
        const raw = [];
        const tieFlags = new Map();
        // <octave-shift>（8va など）。MusicXML の音の高さは鳴る高さなので、音には触れず「どの音が記号の下か」だけを記録する
        const shifts = [];
        const rests = [];
        const clefChanges = new Map();
        const graces = [];
        const dynamics = [];
        const words = [];
        // 松葉: 譜表と number で始まりと終わりを対応づける（閉じない松葉は捨てる）
        const wedges = [];
        const openWedges = new Map();
        let graceGroup = 0;
        // 連桁のまとまり: 声部ごとに begin で新しい番号、continue / end は同じ番号（音が別の譜表に移っても続く）
        const openBeam = new Map();
        let lastBeamGroup;
        const beamGroupOf = (el) => {
            // 和音の 2 つ目以降の音は、和音の最初の音のまとまりに入る（<beam> を和音の音ごとに書く楽譜もあるので、その印は使わない）
            if (child(el, 'chord'))
                return lastBeamGroup;
            const v = textOf(el, 'voice') ?? '1';
            const b1 = children(el, 'beam').find((b) => (b.attrs.number ?? '1') === '1')?.text.trim();
            if (b1 === 'begin')
                openBeam.set(v, ++beamSeq);
            const id = b1 ? openBeam.get(v) : undefined;
            if (b1 === 'end')
                openBeam.delete(v);
            lastBeamGroup = id;
            return id;
        };
        let measureIndex = -1;
        for (const m of children(part, 'measure')) {
            measureIndex++;
            let pos = 0;
            let maxPos = 0;
            let lastStart = 0;
            for (const el of m.children) {
                switch (el.name) {
                    case 'attributes': {
                        divisions = numOf(el, 'divisions') ?? divisions;
                        staves = numOf(el, 'staves') ?? staves;
                        for (const c of children(el, 'clef')) {
                            const num = Number(c.attrs.number ?? 1);
                            const clef = clefOf(c);
                            if (!clef)
                                continue;
                            if (!clefs.has(num))
                                clefs.set(num, clef);
                            // 途中の音部記号の変更も残す（同じ音部記号が続くものはまとめる）
                            const list = clefChanges.get(num) ?? [];
                            if (!list.length || list[list.length - 1].clef !== clef)
                                list.push({ beat: measureStart + pos, clef });
                            clefChanges.set(num, list);
                        }
                        const key = child(el, 'key');
                        if (key)
                            fifths = numOf(key, 'fifths') ?? fifths;
                        const time = child(el, 'time');
                        if (time) {
                            numerator = Number(textOf(time, 'beats')?.split('+').reduce((a, b) => a + Number(b), 0)) || numerator;
                            denominator = numOf(time, 'beat-type') ?? denominator;
                        }
                        break;
                    }
                    case 'direction': {
                        const snd = child(el, 'sound');
                        // ペダル: <pedal type="start|stop|change"> と <sound damper-pedal="yes|no|0..100">
                        const at = measureStart + pos + (numOf(el, 'offset') ?? 0) / divisions;
                        for (const dt of children(el, 'direction-type')) {
                            const type = child(dt, 'pedal')?.attrs.type;
                            if (type === 'start' || type === 'resume')
                                pedals.push({ beat: at, down: true });
                            else if (type === 'stop' || type === 'discontinue')
                                pedals.push({ beat: at, down: false });
                            else if (type === 'change')
                                pedals.push({ beat: at, down: false }, { beat: at, down: true });
                        }
                        const damper = snd?.attrs['damper-pedal'];
                        if (damper !== undefined)
                            pedals.push({ beat: at, down: damper === 'yes' || Number(damper) >= 50 });
                        for (const dt of children(el, 'direction-type')) {
                            const os = child(dt, 'octave-shift');
                            if (!os)
                                continue;
                            const octaves = Number(os.attrs.size ?? 8) >= 15 ? 2 : 1;
                            // type="down" = 書かれた音が鳴る音より下（8va）、"up" = 8vb
                            const shift = os.attrs.type === 'down' ? octaves : os.attrs.type === 'up' ? -octaves : 0;
                            shifts.push({ staff: numOf(el, 'staff') ?? 1, beat: at, shift });
                        }
                        // テンポ: <sound tempo>（演奏の指定。4 分音符/分）。なければ <metronome> の表示を 4 分音符/分に直す（数字だけのとき）
                        const st = Number(snd?.attrs.tempo);
                        if (snd?.attrs.tempo !== undefined && st > 0) {
                            tempoCands.push({ beat: at, bpm: st, source: 'sound', part: partIndex });
                        }
                        else {
                            for (const dt of children(el, 'direction-type')) {
                                const mt = child(dt, 'metronome');
                                const bpm = mt ? metronomeBpm(mt) : null;
                                if (bpm)
                                    tempoCands.push({ beat: at, bpm, source: 'metronome', part: partIndex });
                            }
                        }
                        for (const dt of children(el, 'direction-type')) {
                            const dyn = child(dt, 'dynamics');
                            const mark = dyn?.children[0]?.name;
                            if (mark && DYNAMICS[mark])
                                velocity = DYNAMICS[mark];
                            // 描画用にも残す（other-dynamics は書かれた文字のまま）
                            const text = mark === 'other-dynamics' ? dyn.children[0].text.trim() : mark;
                            if (text) {
                                const pl = el.attrs.placement;
                                dynamics.push({ beat: at, mark: text, staff: numOf(el, 'staff') ?? 1, ...(pl === 'above' || pl === 'below' ? { placement: pl } : {}) });
                            }
                        }
                        // 文字の指示: 同じ direction-type の中の <words> は 1 つの文字列につなぐ（書体の違う語に分けて書くソフトがある）
                        for (const dt of children(el, 'direction-type')) {
                            const ws = children(dt, 'words');
                            const text = ws.map((w) => w.text).join('').replace(/\s+/g, ' ').trim();
                            if (!text)
                                continue;
                            const pl = el.attrs.placement;
                            const sd = snd?.attrs.dynamics !== undefined && isFinite(Number(snd.attrs.dynamics)) ? Number(snd.attrs.dynamics) : undefined;
                            words.push({
                                beat: at, text, kind: wordKind(text), staff: numOf(el, 'staff') ?? 1,
                                ...(pl === 'above' || pl === 'below' ? { placement: pl } : {}),
                                ...(ws[0].attrs['font-style'] === 'italic' ? { italic: true } : {}),
                                ...(ws[0].attrs['font-weight'] === 'bold' ? { bold: true } : {}),
                                ...(sd !== undefined ? { soundDynamics: sd } : {}),
                            });
                        }
                        for (const dt of children(el, 'direction-type')) {
                            const w = child(dt, 'wedge');
                            if (!w)
                                continue;
                            const staff = numOf(el, 'staff') ?? 1;
                            const number = Number(w.attrs.number ?? 1);
                            const key = `${staff}:${number}`;
                            const niente = w.attrs.niente === 'yes';
                            const pl = el.attrs.placement;
                            if (w.attrs.type === 'crescendo' || w.attrs.type === 'diminuendo') {
                                openWedges.set(key, {
                                    start: at, type: w.attrs.type, number, staff,
                                    ...(pl === 'above' || pl === 'below' ? { placement: pl } : {}),
                                    ...(niente && w.attrs.type === 'crescendo' ? { niente } : {}),
                                    // spread はその端での開き。ディミヌエンドは始まりが開いた側
                                    ...(w.attrs.type === 'diminuendo' && Number(w.attrs.spread) > 0 ? { spread: Number(w.attrs.spread) } : {}),
                                });
                            }
                            else if (w.attrs.type === 'stop') {
                                const open = openWedges.get(key);
                                if (!open)
                                    continue;
                                openWedges.delete(key);
                                wedges.push({
                                    ...open, end: Math.max(at, open.start), ...(niente && open.type === 'diminuendo' ? { niente } : {}),
                                    // クレッシェンドは終わりが開いた側
                                    ...(open.type === 'crescendo' && Number(w.attrs.spread) > 0 ? { spread: Number(w.attrs.spread) } : {}),
                                });
                            }
                        }
                        // 一部の書き出しには未設定値として負の dynamics が入る。強弱記号の値を保つ。
                        const soundDynamics = Number(snd?.attrs.dynamics);
                        if (Number.isFinite(soundDynamics) && soundDynamics > 0) {
                            velocity = Math.max(1, Math.min(127, Math.round((soundDynamics / 100) * 90)));
                        }
                        // D.C.・D.S.・Fine・コーダ: <sound> の指定、なければ文字と記号（𝄋・𝄌）から
                        for (const dt of children(el, 'direction-type')) {
                            if (child(dt, 'segno'))
                                markAt(measureIndex).segnoSign = true;
                            if (child(dt, 'coda'))
                                markAt(measureIndex).codaSign = true;
                            const kind = jumpWord(children(dt, 'words').map((w) => w.text).join(' '));
                            if (kind)
                                markAt(measureIndex)[kind] = true;
                        }
                        if (snd)
                            readSoundJumps(snd, markAt(measureIndex));
                        break;
                    }
                    case 'sound':
                        readSoundJumps(el, markAt(measureIndex));
                        if (Number(el.attrs.tempo) > 0)
                            tempoCands.push({ beat: measureStart + pos, bpm: Number(el.attrs.tempo), source: 'sound', part: partIndex });
                        if (el.attrs['damper-pedal'] !== undefined) {
                            const d = el.attrs['damper-pedal'];
                            pedals.push({ beat: measureStart + pos, down: d === 'yes' || Number(d) >= 50 });
                        }
                        break;
                    case 'backup':
                        pos -= (numOf(el, 'duration') ?? 0) / divisions;
                        break;
                    case 'forward':
                        pos += (numOf(el, 'duration') ?? 0) / divisions;
                        maxPos = Math.max(maxPos, pos);
                        break;
                    case 'note': {
                        if (child(el, 'cue'))
                            break;
                        const grace = child(el, 'grace');
                        if (grace) {
                            // 前打音: 拍・長さを持たない（位置も進めない）。続く音の拍に、記譜だけの要素として残す
                            const gp = child(el, 'pitch');
                            if (gp) {
                                const inChord = !!child(el, 'chord') && graces.length > 0;
                                if (!inChord)
                                    graceGroup++;
                                const acc = textOf(el, 'accidental');
                                const pct = (k) => (grace.attrs[k] !== undefined && isFinite(Number(grace.attrs[k])) ? Number(grace.attrs[k]) : undefined);
                                const sp = pct('steal-time-previous');
                                const sf = pct('steal-time-following');
                                const mt = pct('make-time');
                                graces.push({
                                    start: measureStart + pos,
                                    group: graceGroup,
                                    spelling: { step: (textOf(gp, 'step') ?? 'C'), alter: numOf(gp, 'alter') ?? 0, octave: numOf(gp, 'octave') ?? 4 },
                                    voice: textOf(el, 'voice') ?? '1',
                                    notation: readNotation(el),
                                    slash: grace.attrs.slash === 'yes',
                                    ...(acc ? { accidental: acc } : {}),
                                    ...(sp !== undefined ? { stealPrevious: sp } : {}),
                                    ...(sf !== undefined ? { stealFollowing: sf } : {}),
                                    ...(mt !== undefined ? { makeTime: mt / divisions } : {}),
                                    staff: numOf(el, 'staff') ?? 1,
                                });
                            }
                            break;
                        }
                        const isChord = !!child(el, 'chord');
                        const dur = (numOf(el, 'duration') ?? 0) / divisions;
                        const start = isChord ? lastStart : pos;
                        if (!isChord) {
                            lastStart = pos;
                            pos += dur;
                            maxPos = Math.max(maxPos, pos);
                        }
                        const pitch = child(el, 'pitch');
                        if (child(el, 'rest')) {
                            const r = child(el, 'rest');
                            rests.push({ start: measureStart + start, duration: dur, notation: readNotation(el), staff: numOf(el, 'staff') ?? 1,
                                ...(r.attrs.measure === 'yes' ? { measure: true } : {}) });
                            break;
                        }
                        if (!pitch)
                            break;
                        const spelling = {
                            step: (textOf(pitch, 'step') ?? 'C'),
                            alter: numOf(pitch, 'alter') ?? 0,
                            octave: numOf(pitch, 'octave') ?? 4,
                        };
                        const midi = spellingToMidi(spelling);
                        const staff = numOf(el, 'staff') ?? 1;
                        const notation = readNotation(el);
                        const bg = beamGroupOf(el);
                        if (bg !== undefined)
                            notation.beamGroup = bg;
                        const ties = children(el, 'tie').map((t) => t.attrs.type);
                        const absStart = measureStart + start;
                        // 音符ごとの dynamics 属性（f の 90 に対する百分率）はその音だけに使う。録音から付けた音量など
                        const noteDynamics = Number(el.attrs.dynamics);
                        const noteVelocity = Number.isFinite(noteDynamics) && noteDynamics > 0
                            ? Math.max(1, Math.min(127, Math.round((noteDynamics / 100) * 90))) : velocity;
                        const note = { midi, start: absStart, duration: dur, velocity: noteVelocity, spelling, staff, notation };
                        raw.push(note);
                        if (ties.length)
                            tieFlags.set(note, ties);
                        break;
                    }
                }
            }
            const nominal = (numerator * 4) / denominator;
            const length = maxPos > 1e-6 ? maxPos : nominal;
            if (partIndex === 0) {
                // 反復記号と n 番かっこ
                for (const b of children(m, 'barline')) {
                    const rep = child(b, 'repeat');
                    if (rep?.attrs.direction === 'forward')
                        markAt(measureIndex).forward = true;
                    if (rep?.attrs.direction === 'backward')
                        markAt(measureIndex).backward = Math.max(2, Number(rep.attrs.times) || 2);
                    const end = child(b, 'ending');
                    if (end?.attrs.type === 'start')
                        markAt(measureIndex).endingStart = (end.attrs.number ?? '1').split(/[^0-9]+/).filter(Boolean).map(Number);
                    else if (end)
                        markAt(measureIndex).endingStop = true;
                }
                // 小節の終わりの小節線（複縦線・終止線など）。ふつうの線（regular）は書かない
                const bar = children(m, 'barline').find((b) => (b.attrs.location ?? 'right') === 'right');
                const style = bar ? textOf(bar, 'bar-style') : undefined;
                const pr = child(m, 'print');
                const newSystem = measures.length > 0 && (pr?.attrs['new-system'] === 'yes' || pr?.attrs['new-page'] === 'yes');
                measures.push({
                    index: measures.length,
                    number: m.attrs.number ?? String(measures.length + 1),
                    start: measureStart,
                    length,
                    numerator,
                    denominator,
                    fifths,
                    ...(style && BAR_STYLES.has(style) ? { barEnd: style } : {}),
                    ...(newSystem ? { newSystem: true } : {}),
                });
            }
            measureStart += length;
        }
        // 声部ごとの書き出しでは、後の時刻の音が先に現れる。
        // 実際の拍順で接続し、同音の別声部のタイも上書きしない。
        const openTies = new Map();
        const joined = new Set();
        for (const note of [...raw].sort((a, b) => a.start - b.start)) {
            const ties = tieFlags.get(note) ?? [];
            if (!ties.length)
                continue;
            const key = `${note.staff}:${note.midi}`;
            const candidates = openTies.get(key) ?? [];
            const matches = candidates.filter((n) => Math.abs(n.start + n.duration - note.start) < 1e-3);
            const open = matches.find((n) => n.notation.voice === note.notation.voice) ?? matches[0];
            let start = note;
            if (ties.includes('stop') && open) {
                const pieces = open.notation.pieces ?? [{ start: open.start, duration: open.duration, notation: { ...open.notation } }];
                pieces.push({ start: note.start, duration: note.duration, notation: note.notation });
                open.notation.pieces = pieces;
                open.duration = note.start + note.duration - open.start;
                joined.add(note);
                candidates.splice(candidates.indexOf(open), 1);
                start = open;
            }
            if (ties.includes('start'))
                candidates.push(start);
            openTies.set(key, candidates);
        }
        for (let i = raw.length - 1; i >= 0; i--)
            if (joined.has(raw[i]))
                raw.splice(i, 1);
        // 各音に、その時点で効いているオッターヴァを付ける（始まりの位置以降の音に効き、stop の位置からは効かない）
        if (shifts.length) {
            const ordered = shifts.map((s, i) => ({ ...s, i })).sort((a, b) => a.beat - b.beat || a.i - b.i);
            for (const n of raw) {
                let shift = 0;
                for (const s of ordered) {
                    if (s.staff === n.staff && s.beat <= n.start + 1e-6)
                        shift = s.shift;
                }
                if (shift)
                    n.ottava = shift;
            }
            for (const g of graces) {
                let shift = 0;
                for (const s of ordered) {
                    if (s.staff === g.staff && s.beat <= g.start + 1e-6)
                        shift = s.shift;
                }
                if (shift)
                    g.ottava = shift;
            }
        }
        const id = part.attrs.id ?? `P${partIndex + 1}`;
        const name = partNames.get(id) ?? id;
        const toDraft = (n) => ({
            midi: n.midi,
            start: n.start,
            duration: n.duration,
            velocity: n.velocity,
            spelling: n.spelling,
            ...(n.ottava ? { ottava: n.ottava } : {}),
            ...(Object.keys(n.notation).length ? { notation: n.notation } : {}),
        });
        const staffExtras = (s) => {
            const changes = (clefChanges.get(s) ?? []).filter((c, i, a) => i === 0 || a[i - 1].clef !== c.clef);
            const rs = rests.filter((r) => r.staff === s).map(({ staff: _s, ...r }) => r);
            const gs = graces.filter((g) => g.staff === s).map(({ staff: _s, ...g }) => g);
            const ds = dynamics.filter((d) => d.staff === s).map(({ staff: _s, ...d }) => d);
            const wd = words.filter((d) => d.staff === s).map(({ staff: _s, ...d }) => d);
            const ws = wedges.filter((w) => w.staff === s).map(({ staff: _s, ...w }) => w);
            return {
                ...(changes.length > 1 ? { clefChanges: changes } : {}), ...(rs.length ? { rests: rs } : {}), ...(gs.length ? { graces: gs } : {}),
                ...(ds.length ? { dynamics: ds } : {}), ...(ws.length ? { wedges: ws } : {}), ...(wd.length ? { words: wd } : {}),
            };
        };
        if (staves >= 2) {
            const mine = [];
            for (let s = 1; s <= staves; s++) {
                const isPianoPair = staves === 2 && xmlParts.length === 1;
                mine.push({
                    id: `${id}-s${s}`,
                    name: staves === 2 ? (s === 1 ? '右手' : '左手') : `${name} ${s}`,
                    ...(ensemble ? { player: name } : {}),
                    hand: staves === 2 ? (s === 1 ? 'right' : 'left') : undefined,
                    role: isPianoPair ? (s === 1 ? 'melody' : 'accompaniment') : undefined,
                    clef: clefs.get(s),
                    ...staffExtras(s),
                    notes: raw.filter((n) => n.staff === s).map(toDraft),
                });
            }
            draftParts.push(...mine);
            if (ensemble)
                ensembleDrafts.push(mine);
        }
        else {
            draftParts.push({ id, name, clef: clefs.get(1), ...staffExtras(1), notes: raw.map(toDraft) });
        }
    });
    // 連弾（2 台ピアノも）: 音の高い奏者（プリモ）の両手を主旋律、ほかの奏者（セコンド）の両手を伴奏に。
    // 譜表ごとの推定（一番高い譜表だけが主旋律）にすると、「主旋律を弾く」がプリモの右手だけになってしまう
    if (ensembleDrafts.length >= 2) {
        const avg = (ds) => {
            const ns = ds.flatMap((d) => d.notes);
            return ns.reduce((a, n) => a + n.midi, 0) / Math.max(1, ns.length);
        };
        const primo = ensembleDrafts.reduce((a, b) => (avg(b) > avg(a) ? b : a));
        for (const ds of ensembleDrafts)
            for (const d of ds)
                d.role = ds === primo ? 'melody' : 'accompaniment';
    }
    if (measures.length === 0)
        measures = buildMeasures([], [], 4);
    const diagnostics = [];
    resolveRepeats(measures, marks, diagnostics);
    tempos.push(...mergeTempos(tempoCands, diagnostics));
    const score = finalizeScore({
        meta: { title, composer, rights, source: sourceLabel },
        parts: draftParts,
        measures,
        tempos,
        pedals,
    });
    return diagnostics.length ? { ...score, diagnostics } : score;
}
/** <sound dacapo / dalsegno / segno / coda / tocoda / fine>（演奏の指定） */
function readSoundJumps(snd, mk) {
    const a = snd.attrs;
    const s = {
        ...(a.dacapo === 'yes' ? { daCapo: true } : {}),
        ...(a.dalsegno ? { dalSegno: true } : {}),
        ...(a.segno ? { segno: true } : {}),
        ...(a.coda ? { coda: true } : {}),
        ...(a.tocoda ? { toCoda: true } : {}),
        ...(a.fine !== undefined ? { fine: true } : {}),
    };
    if (Object.keys(s).length)
        mk.sound = { ...mk.sound, ...s };
}
/** 文字の指示が D.C.・D.S.・Fine・To Coda・Coda のどれか */
export function jumpWord(text) {
    const t = text.trim().toLowerCase().replace(/\s+/g, ' ');
    if (!t)
        return null;
    if (/^(d\.? ?c\.?|da capo)( |$)/.test(t))
        return 'dcWord';
    if (/^(d\.? ?s\.?|dal segno)( |$)/.test(t))
        return 'dsWord';
    if (/^fine\.?$/.test(t))
        return 'fineWord';
    if (/^(to|al) coda\.?$/.test(t))
        return 'toCodaWord';
    if (/^coda\.?$/.test(t))
        return 'codaWord';
    return null;
}
/**
 * 集めた印を小節に付ける。D.C. などは <sound> の指定を使い、楽譜のどこにも指定がなければ文字と記号から読む
 * （𝄌 が 2 つあって To Coda の文字がなければ、最初の 𝄌 を飛ぶ位置、最後の 𝄌 をコーダの始まりとする）
 */
function resolveRepeats(measures, marks, diagnostics) {
    const all = [...marks.entries()].filter(([i]) => i < measures.length).sort((a, b) => a[0] - b[0]);
    const explicit = all.some(([, m]) => m.sound);
    const reps = new Map();
    const rep = (i) => reps.get(i) ?? (reps.set(i, {}), reps.get(i));
    if (explicit) {
        for (const [i, m] of all)
            if (m.sound)
                Object.assign(rep(i), m.sound);
    }
    else {
        const hasToCoda = all.some(([, m]) => m.toCodaWord);
        const codaSigns = all.filter(([, m]) => m.codaSign).map(([i]) => i);
        for (const [i, m] of all) {
            if (m.dcWord)
                rep(i).daCapo = true;
            if (m.dsWord)
                rep(i).dalSegno = true;
            if (m.fineWord)
                rep(i).fine = true;
            if (m.segnoSign)
                rep(i).segno = true;
            if (m.toCodaWord)
                rep(i).toCoda = true;
            if (m.codaWord || (m.codaSign && hasToCoda && !m.toCodaWord))
                rep(i).coda = true;
        }
        if (!hasToCoda && codaSigns.length >= 2) {
            rep(codaSigns[0]).toCoda = true;
            rep(codaSigns[codaSigns.length - 1]).coda = true;
        }
    }
    // n 番かっこ: start から stop / discontinue までの小節
    let open = null;
    for (let i = 0; i < measures.length; i++) {
        const m = marks.get(i);
        if (m?.forward)
            rep(i).forward = true;
        if (m?.backward)
            rep(i).backward = m.backward;
        if (m?.endingStart?.length)
            open = m.endingStart;
        if (open)
            rep(i).ending = open;
        if (m?.endingStop) {
            if (!open)
                diagnostics.push(`小節 ${measures[i].number}: 始まりのない n 番かっこの終わりは使わない`);
            open = null;
        }
    }
    for (const [i, r] of reps)
        if (Object.keys(r).length)
            measures[i].repeat = r;
}
const BAR_STYLES = new Set(['light-light', 'light-heavy', 'heavy-light', 'heavy-heavy', 'dashed', 'dotted']);
/** <metronome> の拍の単位 → 4 分音符いくつぶんか */
const BEAT_UNIT = { whole: 4, half: 2, quarter: 1, eighth: 0.5, '16th': 0.25, '32nd': 0.125 };
/**
 * <metronome> の表示から、4 分音符/分。安全に読めるものだけ（読めなければ null）:
 * 拍の単位が 1 つ（付点を含む）で、per-minute が数字だけ（「ca. 80」「80-90」や、♩ = ♪ のような拍の置き換えは読まない）
 */
export function metronomeBpm(mt) {
    const units = children(mt, 'beat-unit');
    const pm = textOf(mt, 'per-minute')?.trim() ?? '';
    if (units.length !== 1 || !/^\d+(\.\d+)?$/.test(pm))
        return null;
    const base = BEAT_UNIT[units[0].text.trim()];
    if (!base)
        return null;
    const dots = children(mt, 'beat-unit-dot').length;
    const len = base * (2 - 0.5 ** dots);
    const bpm = Number(pm) * len;
    return bpm > 0 ? bpm : null;
}
/**
 * テンポの候補を、拍ごとに 1 つにまとめる。同じ拍（同じ変化をピアノの上下の譜表・別のパートに重ねて書いたもの）は 1 回だけ。
 * 選び方: <sound tempo>（演奏の指定）を <metronome>（表示）より先に、同じ種類なら先のパート。
 * 選ばなかった候補の値が違えば、diagnostics に残す
 */
export function mergeTempos(cands, diagnostics) {
    const sorted = [...cands].sort((a, b) => a.beat - b.beat || (a.source === b.source ? a.part - b.part : a.source === 'sound' ? -1 : 1));
    const out = [];
    let i = 0;
    while (i < sorted.length) {
        const group = [sorted[i]];
        while (i + group.length < sorted.length && Math.abs(sorted[i + group.length].beat - sorted[i].beat) < 1e-6)
            group.push(sorted[i + group.length]);
        const pick = group[0];
        const other = group.filter((c) => Math.abs(c.bpm - pick.bpm) > 1e-6);
        if (other.length) {
            diagnostics.push(`拍 ${+pick.beat.toFixed(3)}: テンポの指定が食い違う（${group.map((c) => `パート ${c.part + 1} の ${c.source} ${+c.bpm.toFixed(2)}`).join('・')}）。` +
                `パート ${pick.part + 1} の ${pick.source} ${+pick.bpm.toFixed(2)} を使う`);
        }
        // 同じテンポが続けて書かれていれば（段の頭の再掲など）、変化ではないので 1 つ目だけ
        if (!out.length || Math.abs(out[out.length - 1].bpm - pick.bpm) > 1e-6)
            out.push({ beat: pick.beat, bpm: pick.bpm, source: pick.source });
        i += group.length;
    }
    return out;
}
export const musicXmlImporter = {
    id: 'musicxml',
    label: 'MusicXML',
    extensions: ['musicxml', 'xml', 'mxl'],
    async import(src) {
        return parseMusicXml(await musicXmlText(src.bytes), 'musicxml');
    },
};
