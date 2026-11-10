import { Emitter } from "../core/emitter.js";
import { measureAt } from "../core/score-utils.js";
import { TempoMap } from "../core/tempo.js";
import { audibleVelocity } from "./dynamics.js";
import { EPS } from "../core/types.js";
import { FollowTracker } from "./follow.js";
import { perform } from "./performance.js";
import { gradeFor, GRADE_WINDOWS_MS } from "./scoring.js";
import { startTicker } from "./ticker.js";
import { Transport } from "./transport.js";
const LOOKAHEAD_MS = 100;
/** 裏のタブの先読み。Worker のタイマーまで間引かれても（1 秒おき）音が途切れない長さ */
const HIDDEN_LOOKAHEAD_MS = 1500;
/** これより遅れて予約しようとした音は鳴らさない（止まっていたタブが戻ったときに、遅れた音をまとめて鳴らさない） */
const LATE_MS = 120;
const TICK_MS = 20;
const TEMPO_WINDOW_SEC = 0.18;
const KARAOKE_WINDOW_SEC = GRADE_WINDOWS_MS.good / 1000;
const ECHO_GUARD_MS = 40;
export class PracticeSession extends Emitter {
    score;
    transport;
    noteStatus = new Map();
    statusVersion = 0;
    userParts = new Set();
    /** 「主旋律」モード: 自分が弾く音（音の id。パートをまたぐ）。null ならパート（userParts）で決める */
    userNoteIds = null;
    style = 'follow';
    loop = null;
    /** 曲の最後まで行ったら最初に戻って続ける（くり返し区間があればそちらが先。採点モードは 1 回で終わる） */
    repeatAll = false;
    metronome = false;
    countIn = true;
    accompVolume = 1;
    /** 楽譜のペダル記号どおりに、伴奏の出口へペダルを送る */
    usePedal = true;
    /** 前打音を鳴らす（自動演奏するパートだけ。主音の発音時刻の変更は transforms に記録する）。false なら従来どおり */
    playGraces = true;
    /** 松葉で、自動演奏するパートの音の強さを変える（終わりに強弱記号があるときだけ） */
    playWedges = true;
    playGlissandos = true;
    playTremolos = true;
    glissMode = 'auto';
    /** 弱音を聴きやすくする補助の強さ（0 = 切。src/engine/dynamics.ts） */
    softBoost = 0;
    /** いまの演奏で、前打音・松葉のために鳴らし方を変えた箇所 */
    transforms = [];
    /** マイク入力で、オクターブ違いの音も正解にする（歌う声の高さは楽譜と 1 オクターブずれやすい） */
    octaveFree = true;
    opts;
    tracker = null;
    playNotes = [];
    userNotes = [];
    nextOn = 0;
    nextUserCheck = 0;
    pendingOffs = [];
    pedals = [];
    nextPedal = 0;
    /** 伴奏の出口に送ったペダルの状態 */
    pedalDown = false;
    nextClick = 0;
    countInEnd = -Infinity;
    sentAt = new Map();
    held = new Map();
    timer = null;
    /** 直近の tick で使った先読みの幅 */
    lookahead = LOOKAHEAD_MS;
    stats = { hits: 0, wrong: 0, missed: 0, total: 0, startedAt: 0, endedAt: 0, judgements: [] };
    judgements = new Map();
    /** 今回の演奏（統計）を始めた位置。途中の小節から始めたときは、そこからを採点する */
    runStart = 0;
    /** 弾けた音のうち、まだ押さえている音（長さの採点用） */
    holds = new Map();
    /** マイク入力でオクターブを読み替えた音（検出した音 → 読み替え後） */
    remapped = new Map();
    constructor(score, opts) {
        super();
        this.score = score;
        this.opts = opts;
        this.transport = new Transport(new TempoMap(score.tempos));
        const melody = score.parts.filter((p) => p.role === 'melody').map((p) => p.id);
        this.userParts = new Set(melody.length ? melody : score.parts.slice(0, 1).map((p) => p.id));
        this.rebuild(0);
    }
    now() {
        return this.opts.now ? this.opts.now() : performance.now();
    }
    isHidden() {
        if (this.opts.hidden)
            return this.opts.hidden();
        return typeof document !== 'undefined' && document.hidden;
    }
    get playing() {
        return this.transport.running;
    }
    get rangeStart() {
        return this.loop ? this.loop.start : 0;
    }
    get rangeEnd() {
        return this.loop ? this.loop.end : this.score.length;
    }
    /** 曲が止まらずに進み、タイミングで判定するモードか */
    get timed() {
        return this.style === 'tempo' || this.style === 'karaoke';
    }
    /** 採点の対象になる自分の音（くり返し区間内で、今回の演奏を始めた位置から） */
    scoredNotes() {
        const from = Math.max(this.rangeStart, this.runStart);
        return this.userNotes.filter((n) => n.start >= from - EPS && n.start < this.rangeEnd - EPS);
    }
    // ---- 設定 -------------------------------------------------------------
    setUserParts(ids) {
        this.userParts = new Set(ids);
        this.userNoteIds = null;
        this.rebuild(this.position());
    }
    /** 「主旋律」モード: パートではなく、音ごとに自分が弾く音を決める（src/core/melody.ts の推定など） */
    setUserNotes(ids) {
        this.userNoteIds = new Set(ids);
        this.rebuild(this.position());
    }
    setStyle(style) {
        this.style = style;
        this.rebuild(this.position());
    }
    setUsePedal(on) {
        this.usePedal = on;
        this.rebuild(this.position());
    }
    setPlayWedges(on) {
        this.playWedges = on;
        this.rebuild(this.position());
    }
    setPlayGlissandos(on, mode = this.glissMode) {
        this.playGlissandos = on;
        this.glissMode = mode;
        this.rebuild(this.position());
    }
    setPlayTremolos(on) {
        this.playTremolos = on;
        this.rebuild(this.position());
    }
    setSoftBoost(strength) {
        this.softBoost = strength;
    }
    setPlayGraces(on) {
        this.playGraces = on;
        this.rebuild(this.position());
    }
    setRate(rate) {
        this.transport.setRate(rate, this.now());
    }
    setLoop(loop) {
        this.loop = loop;
        const pos = this.position();
        this.rebuild(loop && (pos < loop.start || pos >= loop.end) ? loop.start : pos);
    }
    position() {
        return this.transport.position(this.now());
    }
    /** 演奏しているパート・モードなどが変わったとき、現在位置から内部状態を作り直す */
    rebuild(from) {
        const users = this.style === 'listen' ? new Set() : this.userParts;
        // 自動演奏するパートは演奏のための並び（前打音を含む）、自分が弾くパートは楽譜どおりの音（判定はこちら）
        const perf = perform(this.score, { graces: this.playGraces, wedges: this.playWedges, glissandos: this.playGlissandos, glissMode: this.glissMode, tremolos: this.playTremolos });
        const mine = this.style === 'listen' ? null : this.userNoteIds;
        if (mine) {
            this.userNotes = this.score.parts.flatMap((p) => p.notes).filter((n) => mine.has(n.id)).sort((a, b) => a.start - b.start);
            // トレモロのように元の音を置き換えて足した音も、自分の音と同じ高さで重なれば鳴らさない
            const own = new Set(this.score.parts.flatMap((p) => p.notes.map((n) => n.id)));
            const covers = (n) => this.userNotes.some((u) => u.partId === n.partId && u.midi === n.midi && n.start >= u.start - EPS && n.start < u.start + u.duration - EPS);
            this.transforms = perf.transforms.filter((t) => !t.changed.some((c) => mine.has(c.noteId)));
            this.playNotes = this.score.parts.flatMap((p) => perf.notes.get(p.id) ?? p.notes)
                .filter((n) => !mine.has(n.id) && (own.has(n.id) || !covers(n)))
                .sort((a, b) => a.start - b.start);
        }
        else {
            this.transforms = perf.transforms.filter((t) => !users.has(t.partId));
            this.playNotes = this.score.parts.filter((p) => !users.has(p.id)).flatMap((p) => perf.notes.get(p.id) ?? p.notes)
                .sort((a, b) => a.start - b.start);
            this.userNotes = this.score.parts.filter((p) => users.has(p.id)).flatMap((p) => p.notes).sort((a, b) => a.start - b.start);
        }
        // 自動演奏するパートがなければ（両方弾く）、ペダルは自分の足に任せる
        this.pedals = this.usePedal && this.playNotes.length > 0 ? (this.score.pedals ?? []) : [];
        this.tracker =
            this.style === 'follow' && this.userNotes.length > 0
                ? new FollowTracker(this.userNotes, this.rangeStart, this.rangeEnd)
                : null;
        this.resetFrom(from, true);
    }
    resetFrom(beat, clearStats, now = this.now()) {
        this.transport.seek(beat, now);
        this.silence();
        this.pendingOffs = [];
        this.nextOn = lowerBound(this.playNotes, beat);
        this.nextPedal = pedalIndexAt(this.pedals, beat);
        this.nextUserCheck = lowerBound(this.userNotes, beat);
        this.nextClick = this.firstClickAtOrAfter(beat);
        this.tracker?.reset(beat);
        for (const n of this.userNotes) {
            if (n.start >= beat - EPS) {
                this.noteStatus.delete(n.id);
                this.judgements.delete(n.id);
            }
        }
        this.holds.clear();
        this.statusVersion++;
        if (clearStats) {
            this.runStart = beat;
            this.judgements.clear();
            this.stats = { hits: 0, wrong: 0, missed: 0, total: this.scoredNotes().length, startedAt: now, endedAt: 0, judgements: [] };
        }
        this.transport.setGate(this.tracker ? (this.tracker.current?.beat ?? null) : null, now);
        // くり返しで先頭に戻ったときなど、再生中ならその位置のペダルを踏み直す
        if (this.playing)
            this.syncPedal(beat, now);
        this.emit('seek', { beat });
    }
    // ---- 再生操作 ---------------------------------------------------------
    play(opts = {}) {
        if (this.playing)
            return;
        let pos = this.position();
        if (pos >= this.rangeEnd - EPS || pos < this.rangeStart - EPS) {
            pos = this.rangeStart;
            this.resetFrom(pos, true);
        }
        // 採点モードはテンポをつかむために必ずカウントを入れる
        const useCountIn = opts.countIn ?? (this.countIn || this.style === 'karaoke');
        if (useCountIn && this.style !== 'listen') {
            const m = measureAt(this.score, pos);
            const len = m ? m.length : 4;
            this.countInEnd = pos;
            const pre = pos - len;
            this.transport.seek(pre, this.now());
            this.nextClick = pre;
        }
        else {
            this.countInEnd = -Infinity;
        }
        if (this.stats.startedAt === 0 || this.stats.hits + this.stats.wrong === 0)
            this.stats.startedAt = this.now();
        this.transport.start(this.now());
        this.syncPedal(pos, this.now());
        if (!this.opts.manualClock && !this.timer)
            this.timer = startTicker(() => this.tick(), TICK_MS);
        this.emit('state', { playing: true });
        this.tick();
    }
    pause() {
        if (!this.playing)
            return;
        const now = this.now();
        let pos = this.transport.position(now);
        if (pos < this.countInEnd)
            pos = this.countInEnd;
        this.transport.pause(now);
        this.transport.seek(pos, now);
        this.countInEnd = -Infinity;
        this.stopTimer();
        this.silence();
        this.pendingOffs = [];
        this.nextOn = lowerBound(this.playNotes, pos);
        this.nextPedal = pedalIndexAt(this.pedals, pos);
        this.nextClick = this.firstClickAtOrAfter(pos);
        this.emit('state', { playing: false });
    }
    toggle() {
        if (this.playing)
            this.pause();
        else
            this.play();
    }
    /** 位置を移動（再生中ならそのまま続ける） */
    seek(beat) {
        const wasPlaying = this.playing;
        if (wasPlaying)
            this.pause();
        this.resetFrom(beat, true);
        if (wasPlaying)
            this.play({ countIn: false });
    }
    rewind() {
        this.seek(this.rangeStart);
    }
    dispose() {
        this.stopTimer();
        this.silence();
    }
    stopTimer() {
        this.timer?.stop();
        this.timer = null;
    }
    silence() {
        this.opts.output.allNotesOff();
        this.pedalDown = false;
        // 先読みで予約済みの MIDI メッセージも確実に止める
        if (!this.opts.manualClock)
            setTimeout(() => !this.playing && this.opts.output.allNotesOff(), this.lookahead + 20);
    }
    // ---- スケジューラ -----------------------------------------------------
    tick(now = this.now()) {
        if (!this.playing)
            return;
        const t = this.transport;
        const pos = t.position(now);
        const end = this.rangeEnd;
        if (pos >= end - EPS && !t.isWaiting(now)) {
            if ((this.loop || this.repeatAll) && this.style !== 'karaoke') {
                // 区間の終わりに着いた時刻から先頭を始める（tick の遅れの分だけ間が空かないように）
                const at = t.timeAt(end);
                this.resetFrom(this.rangeStart, false, now - at < 1000 ? Math.min(now, at) : now);
                this.tick(now);
                return;
            }
            this.finish(now);
            return;
        }
        // 音の出口の遅れ（スマートフォンのスピーカーなど）の分だけ先まで予約し、出口がその分早めに鳴らす
        const latency = Math.max(this.opts.output.latencyMs ?? 0, this.opts.click?.latencyMs ?? 0);
        this.lookahead = (this.isHidden() ? HIDDEN_LOOKAHEAD_MS : LOOKAHEAD_MS) + latency;
        const horizon = t.rawBeatAt(now + this.lookahead);
        const gate = t.gate;
        const out = this.opts.output;
        const late = now - LATE_MS;
        // 伴奏（自分が弾かないパート）のノートオン
        while (this.nextOn < this.playNotes.length) {
            const n = this.playNotes[this.nextOn];
            if (n.start >= horizon)
                break;
            if (gate !== null && n.start >= gate - EPS)
                break;
            if (n.start >= end - EPS)
                break;
            const at = t.timeAt(n.start);
            if (at < late) {
                this.nextOn++;
                continue;
            }
            const dup = this.pendingOffs.findIndex((o) => o.midi === n.midi);
            if (dup >= 0) {
                out.noteOff(n.midi, at - 1);
                this.pendingOffs.splice(dup, 1);
            }
            const vel = Math.max(1, Math.min(127, Math.round(audibleVelocity(n.velocity, this.softBoost) * this.accompVolume)));
            out.noteOn(n.midi, vel, at);
            this.sentAt.set(n.midi, at);
            this.pendingOffs.push({ midi: n.midi, beat: Math.min(n.start + n.duration, end) });
            this.nextOn++;
        }
        // ノートオフ
        for (let i = this.pendingOffs.length - 1; i >= 0; i--) {
            const o = this.pendingOffs[i];
            if (o.beat < horizon && (gate === null || o.beat <= gate + EPS)) {
                out.noteOff(o.midi, t.timeAt(o.beat));
                this.pendingOffs.splice(i, 1);
            }
        }
        // ペダル（踏み替えは同じ拍の up → down）。待ち位置の拍のペダルは、弾くまで踏んだままにする
        while (this.nextPedal < this.pedals.length) {
            const p = this.pedals[this.nextPedal];
            if (p.beat >= horizon)
                break;
            if (gate !== null && p.beat >= gate - EPS)
                break;
            if (p.beat >= end - EPS)
                break;
            out.pedal?.(p.down, Math.max(t.timeAt(p.beat), now));
            this.pedalDown = p.down;
            this.nextPedal++;
        }
        // メトロノーム / カウントイン
        if (this.opts.click) {
            while (this.nextClick < horizon && (gate === null || this.nextClick < gate - EPS) && this.nextClick < end - EPS) {
                const b = this.nextClick;
                if (this.metronome || b < this.countInEnd - EPS) {
                    const m = measureAt(this.score, Math.max(b, 0));
                    const inCountIn = b < this.countInEnd - EPS;
                    const len = measureAt(this.score, Math.max(this.countInEnd, 0))?.length ?? 4;
                    const accent = inCountIn
                        ? Math.abs((b - this.countInEnd) % len) < EPS
                        : !!m && Math.abs(b - m.start) < EPS;
                    const at = t.timeAt(b);
                    if (at >= late)
                        this.opts.click.click(accent, at);
                }
                this.nextClick = b + this.clickUnit(b);
            }
        }
        // テンポ・採点モード: 判定時間を過ぎた音は「見逃し」
        if (this.timed) {
            const win = this.windowBeats(pos);
            while (this.nextUserCheck < this.userNotes.length && this.userNotes[this.nextUserCheck].start < pos - win) {
                const n = this.userNotes[this.nextUserCheck++];
                if (n.start < this.rangeStart - EPS)
                    continue;
                if (!this.noteStatus.has(n.id)) {
                    this.noteStatus.set(n.id, 'missed');
                    this.stats.missed++;
                    this.statusVersion++;
                    const j = { noteId: n.id, grade: 'miss', offsetMs: 0 };
                    this.judgements.set(n.id, j);
                    this.emit('judge', j);
                }
            }
        }
    }
    finish(now) {
        // 最後まで押さえていた音の長さを確定させる
        for (const midi of [...this.holds.keys()])
            this.releaseHold(midi, this.rangeEnd);
        this.pause();
        this.transport.seek(this.rangeEnd, now);
        this.stats.endedAt = now;
        this.emit('finished', { ...this.stats, judgements: [...this.judgements.values()] });
    }
    clickUnit(beat) {
        const m = measureAt(this.score, Math.max(beat, 0));
        if (!m)
            return 1;
        if (m.denominator === 8 && m.numerator % 3 === 0 && m.numerator > 3)
            return 1.5;
        return 4 / m.denominator;
    }
    firstClickAtOrAfter(beat) {
        const m = measureAt(this.score, Math.max(beat, 0));
        if (!m)
            return Math.ceil(beat - EPS);
        const unit = this.clickUnit(beat);
        return m.start + Math.ceil((beat - m.start - EPS) / unit) * unit;
    }
    windowBeats(pos) {
        const sec = this.style === 'karaoke' ? KARAOKE_WINDOW_SEC : TEMPO_WINDOW_SEC;
        return ((sec * this.transport.tempo.bpmAt(pos)) / 60) * this.transport.rate;
    }
    /** 拍の差を、実際に聞こえる時間の差（ミリ秒）に直す */
    beatsToMs(from, to) {
        const tm = this.transport.tempo;
        return ((tm.beatToSec(to) - tm.beatToSec(from)) / this.transport.rate) * 1000;
    }
    /**
     * マイク入力の音を、いま期待している音に合わせて読み替える。
     * オクターブ違い（octaveFree のとき）は期待している音として扱う。
     */
    resolveAcoustic(midi, candidates) {
        if (candidates.includes(midi) || !this.octaveFree)
            return midi;
        const same = candidates.filter((m) => (m - midi) % 12 === 0);
        if (same.length === 0)
            return midi;
        return same.reduce((a, b) => (Math.abs(b - midi) < Math.abs(a - midi) ? b : a));
    }
    /** 伴奏として鳴っている音か（スピーカーからの回り込みをマイクが拾った可能性） */
    isSoundingAccompaniment(midi) {
        return this.pendingOffs.some((o) => o.midi === midi || (this.octaveFree && (o.midi - midi) % 12 === 0));
    }
    releaseHold(midi, pos) {
        const h = this.holds.get(midi);
        if (!h)
            return;
        this.holds.delete(midi);
        h.judgement.hold = Math.max(0, Math.min(1, (pos - h.note.start) / h.note.duration));
    }
    // ---- 入力 -------------------------------------------------------------
    noteOn(midi, velocity, now = this.now(), info = {}) {
        // 電子ピアノが MIDI THRU で伴奏を送り返してくる場合に自分の演奏と誤認しないためのガード
        const sent = this.sentAt.get(midi);
        if (sent !== undefined && now >= sent - 5 && now - sent < ECHO_GUARD_MS)
            return;
        this.opts.monitor?.noteOn(midi, velocity, now);
        const raw = midi;
        if (info.acoustic && this.tracker?.current)
            midi = this.resolveAcoustic(midi, this.tracker.current.midis);
        // ウェイトモードでは、止まっている状態でも最初の音を弾けば演奏が始まる
        if (!this.playing && this.tracker?.current?.midis.includes(midi)) {
            const target = this.tracker.current.beat;
            if (Math.abs(this.position() - target) > EPS && this.position() < target)
                this.transport.seek(target, now);
            this.play({ countIn: false });
        }
        let result = 'neutral';
        if (this.playing && this.style !== 'listen') {
            const pos = this.transport.position(now);
            if (this.tracker) {
                // マイクは単音しか拾えないので、和音はどれか 1 音が合えばよい
                const r = this.tracker.press(midi, pos, !!info.acoustic);
                if (r.kind === 'wrong' && info.acoustic && this.isSoundingAccompaniment(midi)) {
                    this.held.set(midi, 'neutral');
                    return;
                }
                if (r.kind === 'complete') {
                    result = 'good';
                    for (const id of r.group.noteIds)
                        this.noteStatus.set(id, 'hit');
                    this.stats.hits += r.group.noteIds.length;
                    this.statusVersion++;
                    if (pos < r.group.beat - EPS)
                        this.jumpTo(r.group.beat, now);
                    this.transport.setGate(this.tracker.current?.beat ?? null, now);
                    if (pos < this.countInEnd)
                        this.countInEnd = -Infinity;
                    // 待っていた伴奏をすぐ予約する（次の tick を待つと、裏のタブでは遅れて鳴らないことがある）
                    this.tick(now);
                }
                else if (r.kind === 'progress') {
                    result = 'good';
                }
                else if (r.kind === 'wrong') {
                    result = 'bad';
                    this.stats.wrong++;
                }
            }
            else if (this.timed) {
                const win = this.windowBeats(pos);
                const open = [];
                for (let i = lowerBound(this.userNotes, pos - win); i < this.userNotes.length; i++) {
                    const n = this.userNotes[i];
                    if (n.start > pos + win)
                        break;
                    if (!this.noteStatus.has(n.id) && n.start >= this.rangeStart - EPS)
                        open.push(n);
                }
                if (info.acoustic)
                    midi = this.resolveAcoustic(midi, open.map((n) => n.midi));
                let best;
                for (const n of open) {
                    if (n.midi === midi && (!best || Math.abs(n.start - pos) < Math.abs(best.start - pos)))
                        best = n;
                }
                if (best) {
                    this.noteStatus.set(best.id, 'hit');
                    this.stats.hits++;
                    this.statusVersion++;
                    result = 'good';
                    const offsetMs = Math.round(this.beatsToMs(best.start, pos));
                    const grade = gradeFor(offsetMs);
                    const j = { noteId: best.id, grade: grade === 'miss' ? 'good' : grade, offsetMs };
                    if (info.cents !== undefined)
                        j.cents = Math.round(info.cents);
                    this.judgements.set(best.id, j);
                    this.holds.set(midi, { note: best, judgement: j });
                    this.emit('judge', j);
                }
                else if (info.acoustic && this.isSoundingAccompaniment(midi)) {
                    this.held.set(midi, 'neutral');
                    return;
                }
                else {
                    this.stats.wrong++;
                    result = 'bad';
                }
            }
        }
        if (raw !== midi)
            this.remapped.set(raw, midi);
        this.held.set(midi, result);
        this.emit('input', { midi, result });
    }
    noteOff(midi, now = this.now()) {
        this.opts.monitor?.noteOff(midi, now);
        const mapped = this.remapped.get(midi);
        if (mapped !== undefined) {
            this.remapped.delete(midi);
            midi = mapped;
        }
        this.held.delete(midi);
        if (this.playing)
            this.releaseHold(midi, this.transport.position(now));
        else
            this.holds.delete(midi);
    }
    /** 先取りして弾いたとき、その位置まで飛ぶ（途中の伴奏は鳴らさない） */
    jumpTo(beat, now) {
        this.transport.seek(beat, now);
        for (const o of this.pendingOffs)
            if (o.beat <= beat + EPS)
                this.opts.output.noteOff(o.midi, now);
        this.pendingOffs = this.pendingOffs.filter((o) => o.beat > beat + EPS);
        this.nextOn = lowerBound(this.playNotes, beat);
        this.nextPedal = pedalIndexAt(this.pedals, beat);
        this.syncPedal(beat, now);
        this.nextClick = this.firstClickAtOrAfter(beat);
    }
    /** 位置 beat で踏まれているべきペダルの状態に合わせる（途中から再生・先取りで飛んだとき） */
    syncPedal(beat, now) {
        const i = pedalIndexAt(this.pedals, beat);
        const want = i > 0 && this.pedals[i - 1].down;
        if (want === this.pedalDown)
            return;
        this.opts.output.pedal?.(want, now);
        this.pedalDown = want;
    }
    // ---- UI 向け ----------------------------------------------------------
    snapshot(now = this.now()) {
        const cur = this.tracker?.current;
        return {
            position: this.transport.position(now),
            playing: this.playing,
            waiting: this.transport.isWaiting(now),
            countingIn: this.playing && this.transport.position(now) < this.countInEnd - EPS,
            expected: cur ? { beat: cur.beat, midis: cur.midis, noteIds: cur.noteIds, pressed: cur.pressed } : null,
            held: this.held,
            statusVersion: this.statusVersion,
            stats: this.stats,
        };
    }
}
/** beat >= 指定拍 となる最初のペダルの位置（それより前は、すでに反映済み） */
function pedalIndexAt(pedals, beat) {
    let i = 0;
    while (i < pedals.length && pedals[i].beat < beat - EPS)
        i++;
    return i;
}
/** start >= beat となる最初のノートの位置 */
function lowerBound(notes, beat) {
    let lo = 0;
    let hi = notes.length;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (notes[mid].start < beat - EPS)
            lo = mid + 1;
        else
            hi = mid;
    }
    return lo;
}
