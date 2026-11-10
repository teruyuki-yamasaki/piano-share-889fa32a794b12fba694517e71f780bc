/**
 * アプリの組み立て（コンポジションルート）。
 * 各モジュール（読み込み・MIDI 入出力・音源・練習エンジン・表示）をここでつなぐだけにし、
 * ロジックそのものは各モジュール側に置く。
 */
import { SOFT_BOOST } from "../engine/dynamics.js";
import { MicInput } from "../audio/mic-input.js";
import { Synth, voiceForProgram } from "../audio/synth.js";
import { applyMelodyEdits, extractMelody, toggleMelodyEdit } from "../core/melody.js";
import { PlayMap } from "../core/repeats.js";
import { measureAt } from "../core/score-utils.js";
import { MultiOutput } from "../engine/output.js";
import { rangeLabel, summarize } from "../engine/scoring.js";
import { PracticeSession } from "../engine/session.js";
import { ImporterRegistry } from "../import/importer.js";
import { midiFileImporter } from "../import/midi-file.js";
import { musicXmlImporter } from "../import/musicxml.js";
import { isVirtualPort, MidiHub } from "../midi/devices.js";
import { QwertyInput } from "../midi/qwerty.js";
import { guideToc, loadGuide } from "../ui/guide.js";
import { KeyboardView } from "../ui/keyboard-view.js";
import { noteLabel, setSolfegeLanguage } from "../ui/keylayout.js";
import { RollView } from "../ui/roll-view.js";
import { Marquee } from "../ui/marquee.js";
import { MicWave } from "../ui/mic-wave.js";
import { ScoreView } from "../ui/score-view.js";
import { addHistory, loadHistory } from "./history.js";
import { loadMelodyEdits, localMelodyEdits, saveMelodyEdits } from "./melody-edits.js";
import { fetchUserLibrary, fetchUserScore, removeFromLibrary, uploadToLibrary } from "./library-api.js";
import { backend } from "./backend.js";
import { backupFileName, createBackup, parseBackup, restoreBackup } from "./backup.js";
import { allHistory, mergeHistory } from "./history.js";
import { isIos, setupMobile } from "./mobile.js";
import { nextInPlaylist, nextRepeatMode } from "./playlist.js";
import { applyLanguage, getLanguage, localized, partLabel, playerLabel, setLanguage, t } from "./i18n.js";
import { defaultPlayParts, partChipGroups, toggleParts } from "./part-select.js";
import { applyTheme, loadSettings, TEMPO_STEPS, saveSettings } from "./settings.js";
import { soundTargets } from "./sound-routing.js";
// ---- モジュール ---------------------------------------------------------
const registry = new ImporterRegistry().register(musicXmlImporter).register(midiFileImporter);
const synth = new Synth();
const midi = new MidiHub();
const qwerty = new QwertyInput();
const mic = new MicInput();
const accompOut = new MultiOutput([synth]);
const settings = loadSettings();
// 最初の描画を待たずに配色を当てる（明るい画面が一瞬出ないように）
applyTheme(settings.theme);
const library = [];
let score = null;
/** 反復記号どおりの演奏の順番。session は playMap.played（展開した楽曲）を鳴らし、楽譜の表示は written に読み替える */
let playMap = null;
let session = null;
let currentEntry = null;
// ---- DOM ----------------------------------------------------------------
const $ = (id) => document.getElementById(id);
const app = $('app');
const pieceSelect = $('pieceSelect');
const pieceMeta = $('pieceMeta');
const pieceTitle = new Marquee($('pieceTitle'), $('pieceTitleText'));
const roleSeg = $('roleSeg');
const styleSeg = $('styleSeg');
const playBtn = $('playBtn');
const tempoSelect = $('tempoSelect');
// 速さの選択肢: 0.5× 〜 2.0×（0.75× のような 2 桁のものは 2 桁で）
tempoSelect.replaceChildren(...TEMPO_STEPS.map((v) => new Option(`${(v / 100).toFixed(v % 10 ? 2 : 1)}×`, String(v))));
const metroChk = $('metroChk');
const countInChk = $('countInChk');
const loopChk = $('loopChk');
const loopFrom = $('loopFrom');
const loopTo = $('loopTo');
const partChips = $('partChips');
const banner = $('banner');
const statusPos = $('statusPos');
const statusScore = $('statusScore');
const deviceDot = $('deviceDot');
const deviceLabel = $('deviceLabel');
const settingsDlg = $('settingsDlg');
const inputSelect = $('inputSelect');
const outputSelect = $('outputSelect');
const soundSelect = $('soundSelect');
const monitorChk = $('monitorChk');
const accompVol = $('accompVol');
const voiceSelect = $('voiceSelect');
const channelSelect = $('channelSelect');
const pedalChk = $('pedalChk');
const graceChk = $('graceChk');
const softBoostSelect = $('softBoostSelect');
const glissChk = $('glissChk');
const tremoloChk = $('tremoloChk');
const sourceBreaksChk = $('sourceBreaksChk');
const glissModeSelect = $('glissModeSelect');
const wedgeChk = $('wedgeChk');
const namesSelect = $('namesSelect');
const rollZoom = $('rollZoom');
const audioOffset = $('audioOffset');
const fullKeysChk = $('fullKeysChk');
const namesSeg = $('namesSeg');
const keysSeg = $('keysSeg');
const midiNote = $('midiNote');
const resultDlg = $('resultDlg');
const toastEl = $('toast');
const languageBtn = $('languageBtn');
const themeBtn = $('themeBtn');
const micBtn = $('micBtn');
/**
 * スマートフォンでは、マイクのボタンを練習バー（横にスワイプしないと見えない）から、再生ボタン・速さと同じ行の空きへ移す。
 * 幅が戻ったら元の場所（練習バーのパートのボタンの右）に戻す
 */
const PHONE_LAYOUT = matchMedia('(max-width: 720px), (max-height: 520px)');
const micHome = { parent: micBtn.parentElement, next: micBtn.nextElementSibling };
function placeMicButton() {
    if (PHONE_LAYOUT.matches)
        document.querySelector('.topbar .tempo').after(micBtn);
    else
        micHome.parent.insertBefore(micBtn, micHome.next);
}
PHONE_LAYOUT.addEventListener('change', placeMicButton);
placeMicButton();
const micNoteLabel = $('micNoteLabel');
const micWave = new MicWave($('micWave'));
const micChk = $('micChk');
const micSelect = $('micSelect');
const micSens = $('micSens');
const micMeter = $('micMeter');
const micMeterNote = $('micMeterNote');
const octaveFreeChk = $('octaveFreeChk');
const helpBtn = $('helpBtn');
const helpPanel = $('helpPanel');
const helpBody = $('helpBody');
const helpToc = $('helpToc');
const helpTabLink = $('helpTabLink');
const judgeFx = $('judgeFx');
const resultExtra = $('resultExtra');
const libFileInput = $('libFileInput');
const backupFileInput = $('backupFileInput');
const repeatBtn = $('repeatBtn');
const nextPieceBtn = $('nextPieceBtn');
const scoreView = new ScoreView($('scoreView'));
// 楽譜の欄に使える高さ: 画面の高さから、上のバー・練習バー・下のバーと、ピアノロールと鍵盤の最低限の高さを引いたもの
/** 楽譜の欄にできるいちばん大きな高さ: 画面の高さから、上のバー・練習バー・区切り・下のバーと、ピアノロールと鍵盤の最低限の高さを引いたもの */
function maxScoreHeight() {
    const stageMin = parseFloat(getComputedStyle(app).getPropertyValue('--stage-min')) || 200;
    const bars = ['.topbar', '.toolbar', '.splitter', '.statusbar'].reduce((h, sel) => h + (app.querySelector(sel)?.offsetHeight ?? 0), 0);
    return app.clientHeight - bars - stageMin;
}
/** 楽譜の欄の高さを自分で決めたときの、いちばん小さな高さ */
const MIN_SCORE_HEIGHT = 120;
// 楽譜の欄に使える高さ（区切りで高さを決めていれば、その高さまで）
scoreView.availableHeight = () => Math.min(settings.scoreHeight ?? Infinity, maxScoreHeight());
// ---- 楽譜とピアノロールの区切り（ドラッグで楽譜の欄の高さを変える） ----
const splitter = $('scoreSplitter');
const scoreViewEl = $('scoreView');
let splitDrag = null;
function setScoreHeight(h) {
    settings.scoreHeight = h === null ? null : Math.round(Math.max(MIN_SCORE_HEIGHT, Math.min(maxScoreHeight(), h)));
    saveSettings(settings);
    scoreView.setHeight(settings.scoreHeight);
}
splitter.addEventListener('pointerdown', (e) => {
    splitDrag = { y: e.clientY, h: scoreViewEl.getBoundingClientRect().height };
    splitter.setPointerCapture(e.pointerId);
    splitter.classList.add('dragging');
    e.preventDefault();
});
splitter.addEventListener('pointermove', (e) => {
    if (!splitDrag)
        return;
    // ドラッグ中は高さだけ変える（楽譜の並べ直しは離したときに 1 回）
    const h = Math.max(MIN_SCORE_HEIGHT, Math.min(maxScoreHeight(), splitDrag.h + e.clientY - splitDrag.y));
    scoreViewEl.style.height = `${Math.round(h)}px`;
});
const endSplitDrag = () => {
    if (!splitDrag)
        return;
    splitDrag = null;
    splitter.classList.remove('dragging');
    setScoreHeight(scoreViewEl.getBoundingClientRect().height);
};
splitter.addEventListener('pointerup', endSplitDrag);
splitter.addEventListener('pointercancel', endSplitDrag);
// ダブルクリック（または Home キー）で、いちばん高い段に合わせる高さに戻す
splitter.addEventListener('dblclick', () => setScoreHeight(null));
splitter.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 60 : 20;
    const now = scoreViewEl.getBoundingClientRect().height;
    if (e.key === 'ArrowUp')
        setScoreHeight(now - step);
    else if (e.key === 'ArrowDown')
        setScoreHeight(now + step);
    else if (e.key === 'Home')
        setScoreHeight(null);
    else
        return;
    e.preventDefault();
});
if (settings.scoreHeight !== null)
    scoreViewEl.style.height = `${settings.scoreHeight}px`;
const rollView = new RollView($('roll'));
const keyboardView = new KeyboardView($('keys'));
// ---- 表示ヘルパー -------------------------------------------------------
let toastTimer = 0;
function toast(msg, kind = 'info', ms = 3200) {
    toastEl.textContent = msg;
    toastEl.classList.toggle('error', kind === 'error');
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    if (ms > 0)
        toastTimer = window.setTimeout(() => toastEl.classList.remove('show'), ms);
}
let bannerState = null;
function showBanner(key, vars = {}) {
    bannerState = key ? { key, vars } : null;
    renderBanner();
}
function renderBanner() {
    banner.hidden = !bannerState;
    if (bannerState)
        banner.innerHTML = t(bannerState.key, bannerState.vars);
}
function setChecked(seg, attr, value) {
    for (const b of seg.querySelectorAll('button'))
        b.setAttribute('aria-checked', String(b.dataset[attr] === value));
}
// ---- 曲の読み込み -------------------------------------------------------
async function loadLibrary() {
    try {
        const embedded = document.getElementById('bundled-library');
        const res = embedded ? null : await fetch('./library/index.json');
        const items = (embedded
            ? JSON.parse(embedded.textContent ?? '[]')
            : res.status === 404 ? [] : await res.json());
        library.push(...items.map((e) => ({ ...e, url: `./library/${e.file}` })));
    }
    catch {
        toast(t('noLibrary'), 'error');
    }
    await reloadUserLibrary();
}
// ---- マイライブラリ -----------------------------------------------------
let libraryAvailable = true;
/** サーバーからマイライブラリの一覧を読み直す（読み込み済みの楽譜は使い回す） */
async function reloadUserLibrary() {
    try {
        const list = await fetchUserLibrary();
        libraryAvailable = true;
        const ids = new Set(list.map((e) => e.id));
        for (let i = library.length - 1; i >= 0; i--)
            if (library[i].user && !ids.has(library[i].id))
                library.splice(i, 1);
        for (const e of list) {
            const existing = library.find((x) => x.id === e.id);
            const entry = { ...e, url: `./user-library/${e.file}`, user: true, score: existing?.score };
            if (existing)
                Object.assign(existing, entry);
            else
                library.push(entry);
        }
    }
    catch {
        libraryAvailable = false;
    }
    renderPieceSelect();
    syncRepeat();
}
async function addToLibrary(files) {
    if (!libraryAvailable) {
        toast(t((await backend()) === 'server' ? 'libUnavailable' : 'libStorageUnavailable'), 'error', 8000);
        return;
    }
    let openId = null;
    for (const file of files) {
        try {
            if (isPdf(file)) {
                toast(t('pdfNotSupported'), 'error', 10000);
                continue;
            }
            const r = await uploadToLibrary(file);
            if (r.entries?.[0]) {
                toast(t('libAdded', { title: r.entries[0].title }));
                openId = r.entries[0].id;
            }
        }
        catch (err) {
            toast(err.message, 'error', 10000);
        }
    }
    await reloadUserLibrary();
    if (openId && files.length === 1)
        await openEntry(openId);
}
// ---- バックアップ（曲データの書き出し・読み込み） ---------------------------
function backupDeps() {
    return {
        list: fetchUserLibrary,
        read: fetchUserScore,
        add: async (name, bytes, original) => {
            const r = await uploadToLibrary(new File([bytes], name), original);
            if (!r.entries?.[0])
                throw new Error(t('backupAddFailed'));
            return r.entries[0];
        },
        loadMelody: async (id) => (await loadMelodyEdits(id, true)).edits,
        saveMelody: async (id, edits) => void (await saveMelodyEdits(id, edits, 'file')),
        localMelody: localMelodyEdits,
        history: allHistory,
        mergeHistory,
        bundledIds: library.filter((e) => e.file && !e.user).map((e) => e.id),
    };
}
async function exportBackup() {
    try {
        const data = await createBackup(backupDeps());
        const name = backupFileName();
        const file = new File([JSON.stringify(data)], name, { type: 'application/json' });
        // iPhone・iPad は共有シート（「ファイルに保存」・AirDrop など）から。ほかはダウンロード
        if (isIos() && navigator.canShare?.({ files: [file] })) {
            try {
                await navigator.share({ files: [file], title: name });
                return;
            }
            catch (err) {
                if (err.name === 'AbortError')
                    return;
            }
        }
        const a = document.createElement('a');
        a.href = URL.createObjectURL(file);
        a.download = name;
        document.body.append(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
        toast(t('backupExported', { n: data.scores.length }));
    }
    catch (err) {
        toast(t('backupFailed', { message: err.message }), 'error', 8000);
    }
}
async function importBackup(file) {
    try {
        const result = await restoreBackup(parseBackup(await file.text()), backupDeps());
        await reloadUserLibrary();
        toast(t('backupImported', { added: result.added, skipped: result.skipped, melody: result.melody, history: result.history }), result.errors.length ? 'error' : 'info', 8000);
        if (result.errors.length)
            console.warn('backup import errors', result.errors);
        // 手直しが戻ったかもしれないので、開いている曲を読み直す
        if (currentEntry)
            await openEntry(currentEntry.id);
    }
    catch (err) {
        toast(t('backupFailed', { message: err.message }), 'error', 8000);
    }
}
/** PDF は読み込まない（PDF → MusicXML は別のプロジェクト score-omr で行い、できた MusicXML を読み込む） */
function isPdf(file) {
    return /\.pdf$/i.test(file.name);
}
function pieceGroups() {
    return [
        [t('bundled'), library.filter((e) => e.file && !e.user)],
        [t('libGroup'), library.filter((e) => e.user)],
        [t('opened'), library.filter((e) => !e.file)],
    ];
}
function fillPieceOptions(sel, groups) {
    for (const [label, items] of groups) {
        if (items.length === 0)
            continue;
        const og = document.createElement('optgroup');
        og.label = label;
        for (const e of items) {
            const o = document.createElement('option');
            o.value = e.id;
            o.textContent = localized(e, 'title');
            og.appendChild(o);
        }
        sel.appendChild(og);
    }
}
/** 曲の選択欄の、曲ではない項目（マイライブラリへの追加・削除） */
const ADD_OPTION = '__add';
const REMOVE_OPTION = '__remove';
const EXPORT_OPTION = '__export';
const IMPORT_OPTION = '__import';
const PIECE_ACTIONS = [ADD_OPTION, REMOVE_OPTION, EXPORT_OPTION, IMPORT_OPTION];
function renderPieceSelect() {
    pieceSelect.replaceChildren();
    fillPieceOptions(pieceSelect, pieceGroups());
    // マイライブラリの操作は選択欄の最後に（以前のマイライブラリのパネルの代わり）
    const og = document.createElement('optgroup');
    og.label = t('libGroupActions');
    og.append(new Option(t('libAddScore'), ADD_OPTION));
    if (currentEntry?.user)
        og.append(new Option(t('libRemoveThis', { title: localized(currentEntry, 'title') }), REMOVE_OPTION));
    // 曲データの書き出し・読み込み（スマートフォン版は端末のブラウザの中にしか保存しないので、ファイルで残せるように）
    og.append(new Option(t('backupExport'), EXPORT_OPTION), new Option(t('backupImport'), IMPORT_OPTION));
    pieceSelect.appendChild(og);
    pieceSelect.value = currentEntry?.id ?? settings.pieceId;
    renderPieceMeta();
}
/** 曲の選択欄で「楽譜を追加…」「この曲を削除」を選んだとき。選択欄はいまの曲に戻す */
function showFileImport(backup) {
    // iOS の選択欄の change から隠れた input を click() しても、
    // ファイル選択が開かない場合がある。見える input を直接タップしてもらう。
    const dialog = $('fileImportDialog');
    $('fileImportTitle').textContent = t(backup ? 'backupImport' : 'libAddScore');
    libFileInput.hidden = backup;
    backupFileInput.hidden = !backup;
    dialog.showModal();
}
async function pieceAction(value) {
    pieceSelect.value = currentEntry?.id ?? settings.pieceId;
    if (value === ADD_OPTION) {
        showFileImport(false);
        return;
    }
    if (value === EXPORT_OPTION)
        return exportBackup();
    if (value === IMPORT_OPTION) {
        showFileImport(true);
        return;
    }
    const e = currentEntry;
    if (value !== REMOVE_OPTION || !e?.user)
        return;
    if (!confirm(t('confirmRemove', { title: e.title })))
        return;
    try {
        await removeFromLibrary(e.id);
    }
    catch (err) {
        toast(err.message, 'error');
        return;
    }
    // 消した曲の代わりに、一覧でその次（なければ前）の曲を開く
    const next = neighborPiece(1) ?? neighborPiece(-1);
    await reloadUserLibrary();
    await openEntry(next ?? library[0]?.id ?? '');
}
// ---- 続けて再生（曲の選択欄の順）とリピート ------------------------------
/** 曲が終わってから次の曲を始めるまでの間 */
const PLAYLIST_GAP_MS = 1500;
let playlistTimer = 0;
/** 続けて再生できる曲（その場で開いたファイルも、開いているあいだは一覧にある） */
function pieceEntry(id) {
    return library.find((e) => e.id === id && (e.file || e.score));
}
/** 曲の選択欄に並んでいる順（同梱の曲 → マイライブラリ → 開いたファイル） */
function pieceOrder() {
    return pieceGroups().flatMap(([, list]) => list.map((e) => e.id));
}
const REPEAT_TITLE = { off: 'repeatOffTitle', all: 'repeatAllModeTitle', one: 'repeatOneTitle' };
/** リピートボタン: off = 灰色（くり返さない）、all = 曲の一覧を続けて再生し最後から最初へ、one = 1 曲をくり返す */
function syncRepeat() {
    const mode = settings.repeat;
    repeatBtn.dataset.mode = mode;
    repeatBtn.setAttribute('aria-pressed', String(mode !== 'off'));
    repeatBtn.title = t(REPEAT_TITLE[mode]);
    repeatBtn.setAttribute('aria-label', t(REPEAT_TITLE[mode]));
    if (session)
        session.repeatAll = mode === 'one';
    nextPieceBtn.disabled = !neighborPiece(1);
}
/** 曲の一覧でいまの曲の前後の曲（全曲のくり返しのときだけ、端から反対の端へ回る） */
function neighborPiece(dir) {
    return nextInPlaylist(pieceOrder(), currentEntry?.id ?? null, (id) => !!pieceEntry(id), settings.repeat === 'all', dir);
}
/** 曲の頭から何ミリ秒以内なら、⏮ で前の曲へ移るか（音楽プレイヤーと同じく、それより先なら曲の頭へ戻る） */
const PREV_PIECE_WITHIN_MS = 3000;
/** 前後の曲へ移る。再生中（または曲の終わりで次へ進む途中）なら、移った先も再生する */
async function skipPiece(dir) {
    if (!session)
        return;
    if (dir === -1) {
        const t = session.transport;
        const into = t.timeAt(session.position()) - t.timeAt(session.rangeStart);
        const prev = neighborPiece(-1);
        if (!prev || into > PREV_PIECE_WITHIN_MS) {
            session.rewind();
            return;
        }
        return go(prev);
    }
    const next = neighborPiece(1);
    if (next)
        return go(next);
    async function go(id) {
        const play = session.playing || playlistTimer !== 0;
        if (play)
            await openAndPlay(id);
        else
            await openEntry(id);
    }
}
async function openAndPlay(id) {
    await openEntry(id);
    if (currentEntry?.id !== id || !session)
        return false;
    await synth.resume();
    session.play();
    return true;
}
/** 曲が終わったら、次の曲を少し間をおいて始める */
function advancePlaylist(delay = PLAYLIST_GAP_MS) {
    if (settings.repeat !== 'all')
        return;
    const next = neighborPiece(1);
    if (!next)
        return;
    toast(t('playlistNext', { title: localized(pieceEntry(next), 'title') }), 'info', delay + 1500);
    clearTimeout(playlistTimer);
    const from = session;
    playlistTimer = window.setTimeout(() => {
        playlistTimer = 0;
        // 待っている間にほかの曲を開いたり、もう一度再生したりしたら進まない
        if (session !== from || session?.playing)
            return;
        void openAndPlay(next);
    }, delay);
}
function onFinished(st) {
    showResult(st);
    // 結果を出したときは、閉じてから次へ
    if (!resultDlg.open)
        advancePlaylist();
}
function metaFor(e) {
    const composer = localized(e, 'composer');
    const level = localized(e, 'level');
    return level ? `${composer}　${level}` : composer;
}
function renderPieceMeta() {
    if (!currentEntry)
        return;
    const title = localized(currentEntry, 'title');
    pieceTitle.setText(title);
    $('pieceTitle').parentElement.title = title;
    const meta = metaFor(currentEntry);
    pieceMeta.textContent = meta;
    // 省略されても全部読めるように
    pieceMeta.title = [meta, localized(currentEntry, 'description')].filter(Boolean).join('\n');
}
/** 採点の記録を残すときの曲の識別子（開いたファイルは毎回 ID が変わるので曲名で） */
function historyKey() {
    if (!currentEntry || !score)
        return 'unknown';
    return currentEntry.file ? currentEntry.id : `file:${score.meta.title}`;
}
/** 楽譜ファイルの中身（マイライブラリの曲は、スマートフォン版では IndexedDB から） */
async function scoreBytes(entry) {
    if (entry.user)
        return fetchUserScore(entry);
    if (entry.sourceXml !== undefined)
        return new TextEncoder().encode(entry.sourceXml);
    const res = await fetch(entry.url ?? `./library/${entry.file}`);
    if (!res.ok)
        throw new Error(`HTTP ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
}
async function openEntry(id) {
    const entry = library.find((e) => e.id === id) ?? library[0];
    if (!entry)
        return;
    try {
        if (!entry.score && entry.file) {
            entry.score = await registry.import({ name: entry.file, bytes: await scoreBytes(entry) });
        }
        settings.pieceId = entry.id;
        pieceSelect.value = entry.id;
        saveSettings(settings);
        setScore(entry.score, entry);
        // 「この曲を削除」はマイライブラリの曲のときだけ
        renderPieceSelect();
        syncRepeat();
    }
    catch (err) {
        toast(t('openFailed', { message: err.message }), 'error', 6000);
    }
}
async function openFile(file) {
    if (isPdf(file)) {
        toast(t('pdfNotSupported'), 'error', 10000);
        return;
    }
    toast(t('loading', { file: file.name }), 'info', 0);
    try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const s = await registry.import({ name: file.name, bytes }, (msg) => toast(msg, 'info', 0));
        if (s.parts.length === 0)
            throw new Error(t('noNotes'));
        const id = `file:${file.name}:${Date.now()}`;
        const entry = { id, title: s.meta.title || file.name, composer: s.meta.composer ?? '', score: s };
        library.push(entry);
        setScore(s, entry);
        renderPieceSelect();
        toast(t('openedFile', { file: file.name }));
    }
    catch (err) {
        toast(err.message, 'error', 9000);
    }
}
function setScore(s, entry) {
    session?.dispose();
    // 曲が変わったら、前の曲の終わりで待っていた「次の曲へ」は取りやめる
    clearTimeout(playlistTimer);
    playlistTimer = 0;
    score = s;
    playMap = new PlayMap(s);
    currentEntry = entry;
    renderPieceMeta();
    session = new PracticeSession(playMap.played, { output: accompOut, click: synth });
    playParts = null;
    melody = buildMelody(extractMelody(s), { add: [], remove: [] });
    melodyStorage = 'browser';
    if (melody.line.tracked)
        void loadPieceMelodyEdits(s);
    session.on('state', ({ playing }) => app.classList.toggle('playing', playing));
    session.on('finished', onFinished);
    session.on('input', () => showBanner(null));
    session.on('judge', showJudgement);
    session.on('seek', () => resetLiveGrades());
    applyPracticeSettings();
    scoreView.setScore(s);
    rollView.setScore(playMap.played);
    keyboardView.setScore(playMap.played);
    // くり返し区間の選択肢
    for (const sel of [loopFrom, loopTo]) {
        sel.replaceChildren(...s.measures.map((m) => new Option(m.number, String(m.index))));
    }
    loopFrom.value = '0';
    loopTo.value = String(Math.min(3, s.measures.length - 1));
    loopChk.checked = false;
    app.classList.remove('playing');
}
// ---- 練習設定 -----------------------------------------------------------
/** 「弾く」で自分が弾くパート（この曲で選んだもの）。null なら主旋律から（曲を開くたびに戻す） */
let playParts = null;
/** この曲の主旋律の推定（written = 楽譜の音の id、played = 反復を展開した音の id、parts = 主旋律の音があるパート） */
let melody = null;
/** 推定（line）に手直し（edits）を当てた主旋律。ids = 楽譜の音の id、played = 反復を展開した音の id */
function buildMelody(line, edits) {
    const map = playMap;
    const ids = line.tracked ? applyMelodyEdits(map.written, line.ids, edits) : line.ids;
    const played = map.played.parts.flatMap((p) => p.notes).filter((n) => ids.has(map.writtenId(n.id) ?? -1));
    return { line, edits, ids, played: new Set(played.map((n) => n.id)), parts: new Set(played.map((n) => n.partId)) };
}
/** 手直しの保存先（この曲。楽譜の隣か、このブラウザか） */
let melodyStorage = 'browser';
/** 曲の手直しを読み込む（楽譜の隣の .melody.json。読み終わる前に曲が変わったら捨てる） */
async function loadPieceMelodyEdits(s) {
    const { edits, storage } = await loadMelodyEdits(historyKey(), !!currentEntry?.file);
    if (score !== s || !melody)
        return;
    melodyStorage = storage;
    if (!edits.add.length && !edits.remove.length) {
        renderPartChips();
        return;
    }
    melody = buildMelody(melody.line, edits);
    applyPracticeSettings();
}
/** 楽譜の音符をクリック: その音を主旋律に足す / 外す（曲ごとに保存） */
function toggleMelodyNote(id) {
    if (!melody || !score)
        return;
    const note = score.parts.flatMap((p) => p.notes).find((n) => n.id === id);
    if (!note)
        return;
    setMelodyEdits(toggleMelodyEdit(melody.edits, note, melody.line.ids.has(id)));
}
function setMelodyEdits(edits) {
    if (!melody)
        return;
    const key = historyKey();
    void saveMelodyEdits(key, edits, melodyStorage).then((where) => {
        if (historyKey() === key)
            melodyStorage = where;
    });
    melody = buildMelody(melody.line, edits);
    lastStatus = '';
    applyPracticeSettings();
}
/** 「主旋律」モードで弾いているか（両手から推定できる曲だけ。旋律の楽器のパートがある曲はパートのボタンで足りる） */
function melodyOn() {
    return settings.role !== 'listen' && settings.melodyLine && !!melody?.line.tracked;
}
function applyPracticeSettings() {
    if (!session || !score)
        return;
    const listen = settings.role === 'listen';
    const style = listen ? 'listen' : settings.style;
    session.setStyle(style);
    // お手本を聴くときは全部のパートが自動演奏（session は style = 'listen' で弾くパートを使わない）。選んだパートは残しておく
    scoreView.setNoteClick(melodyOn() ? toggleMelodyNote : null);
    if (melodyOn())
        session.setUserNotes(melody.played);
    else if (!listen)
        session.setUserParts(playParts ?? defaultPlayParts(score));
    session.setRate(settings.tempo / 100);
    session.metronome = settings.metronome;
    session.countIn = settings.countIn;
    syncRepeat();
    session.accompVolume = settings.accompVol / 100;
    if (session.usePedal !== settings.scorePedal)
        session.setUsePedal(settings.scorePedal);
    if (session.playGraces !== settings.playGraces)
        session.setPlayGraces(settings.playGraces);
    if (session.playWedges !== settings.playWedges)
        session.setPlayWedges(settings.playWedges);
    session.setSoftBoost(SOFT_BOOST[settings.softBoost] ?? SOFT_BOOST.medium);
    if (session.playTremolos !== settings.playTremolos)
        session.setPlayTremolos(settings.playTremolos);
    if (session.playGlissandos !== settings.playGlissandos || session.glissMode !== settings.glissMode)
        session.setPlayGlissandos(settings.playGlissandos, settings.glissMode);
    session.octaveFree = settings.octaveFree;
    setChecked(roleSeg, 'role', settings.role);
    setChecked(styleSeg, 'style', settings.style);
    styleSeg.setAttribute('aria-disabled', String(listen));
    renderPartChips();
    updateTempoLabel();
}
/** パートのボタンに出す短い名前（両手のある曲は「左手 / 右手」「LH / RH」。それ以外は元の名前） */
function shortHand(p) {
    if (p.hand === 'left')
        return t('leftHandShort');
    if (p.hand === 'right')
        return t('rightHandShort');
    return partLabel(p.name);
}
function renderPartChips() {
    if (!score || !session)
        return;
    const listen = settings.role === 'listen';
    const onMelody = melodyOn();
    const mineNow = (id) => !listen && !onMelody && session.userParts.has(id);
    /**
     * 押したパート（奏者のボタンなら両手）の「自分 / 自動」を入れ替える。「聴く」のときは、そのパートだけを弾く「弾く」に。
     * 「主旋律」モードのときは、押したパートだけを弾く
     */
    const toggle = (ids) => {
        const set = listen || onMelody ? new Set(ids) : toggleParts(session.userParts, ids);
        settings.melodyLine = false;
        lastStatus = '';
        if (set.size === 0) {
            // 全部を自動にしたら「聴く」。次に「弾く」を押したら主旋律から
            settings.role = 'listen';
            playParts = null;
        }
        else {
            settings.role = 'play';
            playParts = set;
        }
        saveSettings(settings);
        applyPracticeSettings();
    };
    /**
     * 短く見せるため「あなた / 自動」の文字は出さず、塗った丸と色の枠（あなた）・白抜きの丸と薄い文字（自動）で示す。
     * 文字はマウスを重ねたときの説明と読み上げに入れる
     */
    const describe = (label, state, hint) => getLanguage() === 'en' ? `${label} — ${state} (${hint})` : `${label}：${state}（${hint}）`;
    const chip = (p, label, full) => {
        const b = document.createElement('button');
        const mine = mineNow(p.id);
        b.className = 'chip';
        b.style.setProperty('--c', p.color);
        b.setAttribute('aria-pressed', String(mine));
        b.title = describe(full, mine ? t('you') : t('auto'), listen ? t('chipListenTitle') : mine ? t('roleAutoTitle') : t('roleUserTitle'));
        b.setAttribute('aria-label', b.title);
        b.innerHTML = `<span class="sw"></span><span>${escapeHtml(label)}</span>`;
        b.onclick = () => toggle([p.id]);
        return b;
    };
    /** 「主旋律」: 両手から推定した旋律の音だけを弾く。もう一度押すと、ふだんの選び方（右手など）に戻る */
    const melodyChip = () => {
        const b = document.createElement('button');
        b.className = 'chip chip-melody';
        b.style.setProperty('--c', 'var(--felt)');
        b.setAttribute('aria-pressed', String(onMelody));
        const saved = melodyStorage === 'file' && currentEntry?.file
            ? t('melodySavedFile', { file: currentEntry.file.replace(/\.[^.]+$/, '') + '.melody.json' })
            : t('melodySavedBrowser');
        b.title = `${describe(t('melodyLineTitle'), onMelody ? t('you') : t('auto'), listen ? t('chipListenTitle') : onMelody ? t('roleAutoTitle') : t('roleUserTitle'))}\n${saved}`;
        b.setAttribute('aria-label', b.title);
        b.innerHTML = `<span class="sw"></span><span>♪ ${escapeHtml(t('melodyLineChip'))}</span>`;
        b.onclick = () => {
            lastStatus = '';
            settings.melodyLine = listen || !onMelody;
            settings.role = 'play';
            playParts = null;
            saveSettings(settings);
            applyPracticeSettings();
        };
        return b;
    };
    /** 手直しを消して、推定どおりの主旋律に戻す（手直しがあるときだけ出す） */
    const melodyReset = () => {
        const b = document.createElement('button');
        b.className = 'chip chip-reset';
        b.title = t('melodyResetTitle');
        b.setAttribute('aria-label', b.title);
        b.textContent = '↺';
        b.onclick = () => setMelodyEdits({ add: [], remove: [] });
        return b;
    };
    const edited = !!melody && melody.edits.add.length + melody.edits.remove.length > 0;
    // ピアノの両手は鍵盤の並びに合わせて左手を先に。連弾は奏者ごと（セコンド → プリモ）にまとめ、奏者のボタンで両手をまとめて切り替える
    partChips.classList.toggle('is-listen', listen);
    partChips.replaceChildren(...(melody?.line.tracked ? [melodyChip(), ...(onMelody && edited ? [melodyReset()] : [])] : []), ...partChipGroups(score.parts).map((g) => {
        if (!g.player)
            return g.parts.map((p) => chip(p, shortHand(p), partLabel(p.name)));
        const box = document.createElement('div');
        box.className = 'chip-group';
        const ids = g.parts.map((p) => p.id);
        const mine = ids.filter(mineNow).length;
        const head = document.createElement('button');
        head.className = 'chip chip-player';
        head.style.setProperty('--c', g.parts[0].color);
        head.setAttribute('aria-pressed', mine === ids.length ? 'true' : mine ? 'mixed' : 'false');
        head.title = describe(playerLabel(g.player), mine === ids.length ? t('you') : mine ? t('partly') : t('auto'), listen ? t('chipListenTitle') : mine === ids.length ? t('roleAutoTitle') : t('roleUserTitle'));
        head.setAttribute('aria-label', head.title);
        head.textContent = playerLabel(g.player);
        head.onclick = () => toggle(ids);
        box.append(head, ...g.parts.map((p) => chip(p, shortHand(p), partLabel(p.name, p.player))));
        return [box];
    }).flat());
}
function updateTempoLabel() {
    tempoSelect.value = String(settings.tempo);
    const bpms = score ? score.tempos.map((t) => Math.round(t.bpm * (settings.tempo / 100))) : [0];
    // 曲の途中でテンポが変わる曲は、変わり方も示す（倍率は曲のテンポの変化を消さずに掛ける）
    tempoSelect.title = bpms.length > 1 ? `♩ = ${bpms.slice(0, 6).join(' → ')}${bpms.length > 6 ? ' …' : ''}` : `♩ = ${bpms[0]}`;
}
function updateLoop() {
    if (!session || !score)
        return;
    if (!loopChk.checked) {
        session.setLoop(null);
        return;
    }
    let a = Number(loopFrom.value);
    let b = Number(loopTo.value);
    if (b < a)
        [a, b] = [b, a];
    session.setLoop(playMap.playedRange(a, b));
}
// ---- MIDI 機器 ----------------------------------------------------------
/** MIDI の状態。言語を切り替えたときに表示を作り直すために覚えておく */
let midiState = 'checking';
function renderDeviceLabel() {
    if (midiState === 'ready')
        return refreshDevices();
    deviceDot.className = midiState === 'checking' ? 'dot' : 'dot warn';
    deviceLabel.textContent = t(midiState === 'checking' ? 'midiChecking' : midiState === 'unsupported' ? 'browserNoMidi' : 'permissionDenied');
}
function applySound() {
    const target = soundTargets(settings.sound, midi.outputs.find((p) => p.id === midi.outputId));
    accompOut.outputs = [...(target.midi ? [midi.output] : []), ...(target.synth ? [synth] : [])];
}
/** 最後に弾かれた MIDI 機器の名前。出力を自動で選ぶとき、この機器（電子ピアノ本体）に伴奏を送る */
let lastSource = '';
// ---- 伴奏の音色 ---------------------------------------------------------
/** 固定の音色を選んだときに送る General MIDI のプログラム番号 */
const GM_PROGRAM = { piano: 0, epiano: 4, harpsichord: 6, organ: 19, strings: 48, choir: 52 };
/** 電子ピアノ本体で最後に選ばれた音色 */
let pianoProgram = null;
/** 音色を送った MIDI 出力（出力が変わったら送り直す） */
let voiceSentTo;
function applyVoice() {
    const v = settings.accompVoice;
    const program = v === 'mirror' ? pianoProgram : { program: GM_PROGRAM[v], bankMsb: 0, bankLsb: 0 };
    synth.setVoice(v === 'mirror' ? (pianoProgram ? voiceForProgram(pianoProgram.program) : 'piano') : v);
    // 「自分の演奏と同じ」で、まだ本体の音色がわからないときは何も送らない（本体の既定の音色のまま）
    if (program && midi.outputId)
        midi.sendProgram(program);
    voiceSentTo = midi.outputId;
}
function onPianoProgram(p) {
    if (isVirtualPort(p.source))
        return;
    // 本体に送った音色が送り返されてきた場合は無視（送り合いが続かないように）
    if (pianoProgram && pianoProgram.program === p.program && pianoProgram.bankMsb === p.bankMsb && pianoProgram.bankLsb === p.bankLsb)
        return;
    pianoProgram = { program: p.program, bankMsb: p.bankMsb, bankLsb: p.bankLsb };
    if (settings.accompVoice === 'mirror') {
        applyVoice();
        toast(t('voiceFollowed'));
    }
}
function refreshDevices() {
    const inputs = midi.inputs;
    const outputs = midi.outputs;
    inputSelect.replaceChildren(new Option(t('allMidi'), 'all'), ...inputs.map((p) => new Option(p.name, p.id)), new Option(t('pcOnly'), 'none'));
    const inputOk = settings.inputId === 'all' || settings.inputId === 'none' || inputs.some((p) => p.id === settings.inputId);
    inputSelect.value = inputOk ? settings.inputId : 'all';
    midi.selectInput(inputSelect.value);
    outputSelect.replaceChildren(new Option(t('none'), ''), ...outputs.map((p) => new Option(p.name, p.id)));
    let out = settings.outputId && outputs.some((o) => o.id === settings.outputId) ? settings.outputId : null;
    if (!out)
        out = midi.autoOutput(lastSource);
    outputSelect.value = out ?? '';
    midi.selectOutput(out);
    applySound();
    if (midi.outputId !== voiceSentTo)
        applyVoice();
    const active = inputs.filter((p) => midi.inputId === 'all' || p.id === midi.inputId);
    if (midi.inputId !== 'none' && active.length > 0) {
        deviceDot.className = 'dot on';
        // 電子ピアノなどの実機を先に、IAC Driver などの仮想ポートは後ろに
        const sorted = [...active].sort((a, b) => Number(isVirtualPort(a.name)) - Number(isVirtualPort(b.name)));
        deviceLabel.textContent = sorted.map((p) => p.name).join('、');
        showBanner(null);
    }
    else {
        deviceDot.className = 'dot';
        deviceLabel.textContent = t('noMidi');
    }
    midiNote.textContent = soundTargets(settings.sound, outputs.find((o) => o.id === out)).midi
        ? t('midiOutput', { name: outputs.find((o) => o.id === out)?.name ?? '' })
        : t('synthOutput');
}
async function initMidi() {
    if (!midi.supported) {
        midiState = 'unsupported';
        renderDeviceLabel();
        if (!settings.mic)
            showBanner(isIos() ? 'iosMidiBanner' : 'chromeBanner');
        return;
    }
    try {
        await midi.init();
        midiState = 'ready';
        midi.on('devices', refreshDevices);
        midi.on('program', onPianoProgram);
        midi.on('note', (e) => {
            if (e.source !== lastSource && !isVirtualPort(e.source)) {
                lastSource = e.source;
                if (!settings.outputId)
                    refreshDevices();
            }
            handleNote(e, false);
        });
        refreshDevices();
        if (midi.inputs.length === 0 && !settings.mic) {
            showBanner('noInputBanner');
        }
    }
    catch (err) {
        midiState = 'denied';
        renderDeviceLabel();
        showBanner('midiError', { message: escapeHtml(err.message) });
    }
}
function handleNote(e, fromPc) {
    void synth.resume();
    const now = performance.now();
    const time = Math.min(e.time, now);
    if (e.type === 'on') {
        if (fromPc || settings.monitor)
            synth.noteOn(e.midi, e.velocity, now);
        session?.noteOn(e.midi, e.velocity, time);
    }
    else {
        if (fromPc || settings.monitor)
            synth.noteOff(e.midi, now);
        session?.noteOff(e.midi, time);
    }
}
// ---- マイク入力 ---------------------------------------------------------
function handleMicNote(e) {
    const time = Math.min(e.time, performance.now());
    // マイクの音はスピーカーに戻すとハウリングするので、モニターには鳴らさない
    if (e.type === 'on')
        session?.noteOn(e.midi, e.velocity, time, { acoustic: true, cents: e.cents });
    else
        session?.noteOff(e.midi, time);
}
async function setMic(on, announce = true) {
    if (on) {
        try {
            await mic.start(settings.micDeviceId || undefined);
            mic.setSensitivity(settings.micSens);
            showBanner(null);
        }
        catch (err) {
            const msg = err.message;
            toast(mic.supported ? t('micDenied', { message: msg }) : t('micUnsupported'), 'error', 8000);
        }
    }
    else {
        mic.stop();
    }
    settings.mic = mic.active;
    saveSettings(settings);
    micBtn.setAttribute('aria-pressed', String(mic.active));
    micChk.checked = mic.active;
    micNoteLabel.textContent = '';
    micWave.setActive(mic.active);
    micMeter.style.width = '0';
    micMeterNote.textContent = '';
    if (mic.active)
        void refreshMicDevices();
    if (announce)
        toast(t(mic.active ? 'micOn' : 'micOff'));
}
/** マイクの一覧（名前はマイクを一度許可したあとでないと取れない） */
async function refreshMicDevices() {
    const list = await MicInput.devices().catch(() => []);
    micSelect.replaceChildren(new Option(t('micDefault'), ''), ...list.map((d, i) => new Option(d.name || `${t('mic')} ${i + 1}`, d.id)));
    micSelect.value = list.some((d) => d.id === settings.micDeviceId) ? settings.micDeviceId : '';
}
mic.on('note', handleMicNote);
mic.on('level', ({ rms, midi: m }) => {
    const level = Math.max(0, Math.min(1, (20 * Math.log10(Math.max(rms, 1e-6)) + 60) / 50));
    micWave.push(level);
    const name = m === null ? '' : noteLabel(m, settings.names === 'none' ? 'letter' : settings.names, true);
    micNoteLabel.textContent = name;
    if (settingsDlg.open) {
        micMeter.style.width = `${Math.round(level * 100)}%`;
        micMeterNote.textContent = name;
    }
});
// ---- 使い方ガイド（右パネル） ---------------------------------------------
let helpLang = null;
async function setHelp(open) {
    helpPanel.hidden = !open;
    helpBtn.setAttribute('aria-pressed', String(open));
    settings.helpOpen = open;
    saveSettings(settings);
    if (!open || helpLang === getLanguage())
        return;
    helpLang = getLanguage();
    try {
        const g = await loadGuide(helpLang);
        helpBody.innerHTML = g.html;
        helpToc.innerHTML = guideToc(g.headings);
        helpBody.scrollTop = 0;
    }
    catch {
        helpLang = null;
        helpBody.textContent = t('helpLoadFailed');
    }
}
// 目次・ページ内リンクはパネルの中だけでスクロールする（アプリの URL は変えない）
helpPanel.addEventListener('click', (e) => {
    const a = e.target.closest('a');
    const href = a?.getAttribute('href');
    if (!href?.startsWith('#'))
        return;
    e.preventDefault();
    helpBody.querySelector(`[id="${CSS.escape(decodeURIComponent(href.slice(1)))}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
});
// ---- 採点モードの表示 ---------------------------------------------------
const GRADE_LABEL = { perfect: 'Perfect', great: 'Great', good: 'Good', miss: 'Miss' };
const liveGrades = { perfect: 0, great: 0, good: 0, miss: 0 };
function resetLiveGrades() {
    for (const g of Object.keys(liveGrades))
        liveGrades[g] = 0;
    lastStatus = '';
}
function showJudgement(j) {
    liveGrades[j.grade]++;
    lastStatus = '';
    if (settings.style !== 'karaoke')
        return;
    judgeFx.textContent = GRADE_LABEL[j.grade];
    judgeFx.className = `judge-fx ${j.grade}`;
    void judgeFx.offsetWidth; // アニメーションをやり直す
    judgeFx.classList.add('show');
}
function showKaraokeResult(st) {
    if (!session || !score)
        return;
    const r = summarize(session.score, session.scoredNotes(), st.judgements, st.wrong);
    const key = historyKey();
    const before = loadHistory(key);
    const best = before.length ? Math.max(...before.map((h) => h.score)) : null;
    const entry = {
        date: Date.now(),
        score: r.score,
        counts: r.counts,
        wrong: r.wrong,
        meanOffsetMs: r.meanOffsetMs,
        tempo: settings.tempo,
        input: mic.active ? 'mic' : 'midi',
        range: rangeLabel(session.score, Math.max(session.rangeStart, session.runStart), session.rangeEnd),
    };
    const history = addHistory(key, entry);
    $('resultTitle').textContent = t('karaokeResult');
    const bestNote = best === null ? t('firstTry') : r.score > best ? t('newBest') : t('best', { n: best });
    $('resultGrid').innerHTML = `
    <div class="big"><strong>${t('points', { n: r.score })}</strong><em>${escapeHtml(bestNote)}</em></div>`;
    const timing = r.counts.perfect + r.counts.great + r.counts.good === 0
        ? '—'
        : Math.abs(r.meanOffsetMs) <= 20
            ? t('timingSteady', { ms: r.meanAbsOffsetMs })
            : r.meanOffsetMs < 0
                ? t('timingEarly', { ms: -r.meanOffsetMs })
                : t('timingLate', { ms: r.meanOffsetMs });
    const bars = r.measures
        .map((m) => `<i class="${m.ratio >= 0.8 ? '' : m.ratio >= 0.5 ? 'mid' : 'low'}" style="height:${Math.max(6, Math.round(m.ratio * 100))}%" title="${escapeHtml(m.number)}: ${Math.round(m.ratio * 100)}%"></i>`)
        .join('');
    const fmt = new Intl.DateTimeFormat(getLanguage() === 'en' ? 'en-US' : 'ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    const rows = history
        .slice(0, 5)
        .map((h, i) => `<li class="${i === 0 ? 'now' : ''}"><b>${h.score}</b><span>${fmt.format(h.date)}</span><span>${h.tempo}%</span><span>${t(h.input === 'mic' ? 'inputMic' : 'inputMidi')}</span>${h.range ? `<span>${t('rangeMeasures', { r: h.range })}</span>` : ''}</li>`)
        .join('');
    resultExtra.innerHTML = `
    <div class="grades">
      ${['perfect', 'great', 'good', 'miss'].map((g) => `<div class="${g}"><b>${r.counts[g]}</b><span>${GRADE_LABEL[g]}</span></div>`).join('')}
      <div class="wrong"><b>${r.wrong}</b><span>${t('mistakes')}</span></div>
    </div>
    <dl>
      <dt>${t('timing')}</dt><dd>${timing}</dd>
      ${r.meanHold !== null ? `<dt>${t('holdLabel')}</dt><dd>${t('holdValue', { n: Math.round(r.meanHold * 100) })}</dd>` : ''}
      ${r.meanAbsCents !== null ? `<dt>${t('pitchLabel')}</dt><dd>${t('pitchValue', { n: Math.round(r.meanAbsCents) })}</dd>` : ''}
    </dl>
    ${r.measures.length > 1 ? `<div><h4>${t('byMeasure')}</h4><div class="measure-bars">${bars}</div></div>` : ''}
    <div><h4>${t('history')}</h4><ul class="history">${rows}</ul></div>`;
    resultDlg.showModal();
}
// ---- 結果 ---------------------------------------------------------------
function showResult(st) {
    if (settings.role === 'listen' || st.total === 0)
        return;
    if (settings.style === 'karaoke')
        return showKaraokeResult(st);
    resultExtra.replaceChildren();
    const attempts = st.hits + st.wrong + st.missed;
    const acc = attempts ? Math.round((st.hits / attempts) * 100) : 0;
    const sec = Math.max(0, Math.round((st.endedAt - st.startedAt) / 1000));
    $('resultTitle').textContent = acc >= 90 ? t('resultGreat') : acc >= 70 ? t('resultGood') : t('resultFinished');
    $('resultGrid').innerHTML = `
    <div><strong>${acc}%</strong><span>${t('accuracy')}</span></div>
    <div><strong>${st.hits}/${st.total}</strong><span>${t('hitNotes')}</span></div>
    <div><strong>${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}</strong><span>${t('duration')}</span></div>
    <div><strong>${st.wrong}</strong><span>${t('mistakes')}</span></div>
    ${settings.style === 'tempo' ? `<div><strong>${st.missed}</strong><span>${t('missed')}</span></div>` : ''}`;
    resultDlg.showModal();
}
resultDlg.addEventListener('close', () => {
    if (resultDlg.returnValue === 'again') {
        session?.rewind();
        void synth.resume();
        session?.play();
    }
    else {
        advancePlaylist(400);
    }
});
// ---- 操作 ---------------------------------------------------------------
/** 表示言語を反映する（静的な文言 + 動的に組み立てた表示をすべて作り直す） */
function applyLanguageEverywhere() {
    applyLanguage();
    const lang = getLanguage();
    setSolfegeLanguage(lang);
    rollView.countInLabel = t('countingIn');
    helpTabLink.href = `./guide.html?lang=${lang}`;
    renderPieceSelect();
    renderPieceMeta();
    renderDeviceLabel();
    renderBanner();
    renderPartChips();
    syncRepeat();
    applyAudioOffset();
    renderThemeLabel();
    if (micSelect.options[0])
        micSelect.options[0].text = t('micDefault');
    lastStatus = '';
    if (!helpPanel.hidden)
        void setHelp(true);
}
const THEME_ORDER = ['auto', 'light', 'dark'];
const THEME_KEYS = { auto: 'themeAuto', light: 'themeLight', dark: 'themeDark' };
function renderThemeLabel() {
    const name = t(THEME_KEYS[settings.theme]);
    // マークだけのボタンなので、今の配色の名前は title と読み上げ用のラベルに入れる
    themeBtn.dataset.theme = settings.theme;
    themeBtn.title = t('themeTitle', { theme: name });
    themeBtn.setAttribute('aria-label', t('themeLabel', { theme: name }));
}
themeBtn.addEventListener('click', () => {
    settings.theme = THEME_ORDER[(THEME_ORDER.indexOf(settings.theme) + 1) % THEME_ORDER.length];
    saveSettings(settings);
    applyTheme(settings.theme);
    renderThemeLabel();
});
languageBtn.addEventListener('click', () => {
    const language = getLanguage() === 'ja' ? 'en' : 'ja';
    setLanguage(language);
    settings.language = language;
    saveSettings(settings);
    applyLanguageEverywhere();
});
micBtn.addEventListener('click', () => void setMic(!mic.active));
helpBtn.addEventListener('click', () => void setHelp(helpPanel.hidden));
$('helpClose').addEventListener('click', () => void setHelp(false));
libFileInput.addEventListener('change', () => {
    const files = [...(libFileInput.files ?? [])];
    libFileInput.value = '';
    if (files.length) {
        $('fileImportDialog').close();
        void addToLibrary(files);
    }
});
backupFileInput.addEventListener('change', () => {
    const file = backupFileInput.files?.[0];
    backupFileInput.value = '';
    if (file) {
        $('fileImportDialog').close();
        void importBackup(file);
    }
});
// ほかのウィンドウ（ターミナルの npm run add など）から戻ったら一覧を更新
window.addEventListener('focus', () => {
    void reloadUserLibrary();
});
roleSeg.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b?.dataset.role)
        return;
    settings.role = b.dataset.role;
    lastStatus = '';
    saveSettings(settings);
    applyPracticeSettings();
});
styleSeg.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b?.dataset.style)
        return;
    settings.style = b.dataset.style;
    lastStatus = '';
    saveSettings(settings);
    applyPracticeSettings();
});
playBtn.addEventListener('click', async () => {
    await synth.resume();
    session?.toggle();
});
$('rewindBtn').addEventListener('click', () => void skipPiece(-1));
nextPieceBtn.addEventListener('click', () => void skipPiece(1));
repeatBtn.addEventListener('click', () => {
    settings.repeat = nextRepeatMode(settings.repeat);
    syncRepeat();
    saveSettings(settings);
});
tempoSelect.addEventListener('change', () => {
    settings.tempo = Number(tempoSelect.value);
    session?.setRate(settings.tempo / 100);
    updateTempoLabel();
    saveSettings(settings);
});
metroChk.addEventListener('change', () => {
    settings.metronome = metroChk.checked;
    if (session)
        session.metronome = settings.metronome;
    saveSettings(settings);
});
countInChk.addEventListener('change', () => {
    settings.countIn = countInChk.checked;
    if (session)
        session.countIn = settings.countIn;
    saveSettings(settings);
});
loopChk.addEventListener('change', updateLoop);
loopFrom.addEventListener('change', () => {
    loopChk.checked = true;
    updateLoop();
});
loopTo.addEventListener('change', () => {
    loopChk.checked = true;
    updateLoop();
});
pieceSelect.addEventListener('change', () => {
    const v = pieceSelect.value;
    if (PIECE_ACTIONS.includes(v))
        void pieceAction(v);
    else
        void openEntry(v);
});
scoreView.onMeasureClick = (idx) => {
    if (!session || !score)
        return;
    session.seek(playMap.measureStart(idx, session.position()));
    if (!loopChk.checked) {
        loopFrom.value = String(idx);
        loopTo.value = String(Math.min(idx + 3, score.measures.length - 1));
    }
};
// 設定ダイアログ
$('devicePill').addEventListener('click', () => {
    applyAudioOffset(); // 自動の補正の値は、音を出し始めてからわかる
    settingsDlg.showModal();
});
inputSelect.addEventListener('change', () => {
    settings.inputId = inputSelect.value;
    settings.outputId = null;
    saveSettings(settings);
    refreshDevices();
});
outputSelect.addEventListener('change', () => {
    settings.outputId = outputSelect.value || null;
    midi.selectOutput(settings.outputId);
    saveSettings(settings);
    refreshDevices();
});
soundSelect.addEventListener('change', () => {
    settings.sound = soundSelect.value;
    accompOut.allNotesOff();
    applySound();
    saveSettings(settings);
});
monitorChk.addEventListener('change', () => {
    settings.monitor = monitorChk.checked;
    saveSettings(settings);
});
accompVol.addEventListener('input', () => {
    settings.accompVol = Number(accompVol.value);
    if (session)
        session.accompVolume = settings.accompVol / 100;
    saveSettings(settings);
});
// 音名と鍵盤の表示は、練習バーの切り替えと設定ダイアログのどちらからでも変えられる
function setNames(names) {
    settings.names = names;
    namesSelect.value = names;
    namesSeg.value = names;
    saveSettings(settings);
}
function setFullKeys(full) {
    settings.fullKeys = full;
    fullKeysChk.checked = full;
    keysSeg.value = full ? 'full' : 'fit';
    keyboardView.full = full;
    keyboardView.updateRange();
    saveSettings(settings);
}
voiceSelect.addEventListener('change', () => {
    settings.accompVoice = voiceSelect.value;
    saveSettings(settings);
    applyVoice();
});
channelSelect.addEventListener('change', () => {
    midi.allNotesOff();
    settings.accompChannel = Number(channelSelect.value);
    midi.channel = settings.accompChannel - 1;
    saveSettings(settings);
    applyVoice();
});
pedalChk.addEventListener('change', () => {
    settings.scorePedal = pedalChk.checked;
    session?.setUsePedal(settings.scorePedal);
    saveSettings(settings);
});
graceChk.addEventListener('change', () => {
    settings.playGraces = graceChk.checked;
    session?.setPlayGraces(settings.playGraces);
    saveSettings(settings);
});
const onGliss = () => {
    settings.playGlissandos = glissChk.checked;
    settings.glissMode = glissModeSelect.value;
    session?.setPlayGlissandos(settings.playGlissandos, settings.glissMode);
    saveSettings(settings);
};
glissChk.addEventListener('change', onGliss);
sourceBreaksChk.addEventListener('change', () => {
    settings.sourceBreaks = sourceBreaksChk.checked;
    scoreView.setBreaks(settings.sourceBreaks ? 'source' : 'fit');
    saveSettings(settings);
});
tremoloChk.addEventListener('change', () => {
    settings.playTremolos = tremoloChk.checked;
    session?.setPlayTremolos(settings.playTremolos);
    saveSettings(settings);
});
glissModeSelect.addEventListener('change', onGliss);
softBoostSelect.addEventListener('change', () => {
    settings.softBoost = softBoostSelect.value;
    session?.setSoftBoost(SOFT_BOOST[settings.softBoost]);
    saveSettings(settings);
});
wedgeChk.addEventListener('change', () => {
    settings.playWedges = wedgeChk.checked;
    session?.setPlayWedges(settings.playWedges);
    saveSettings(settings);
});
namesSelect.addEventListener('change', () => setNames(namesSelect.value));
namesSeg.addEventListener('change', () => setNames(namesSeg.value));
keysSeg.addEventListener('change', () => setFullKeys(keysSeg.value === 'full'));
/** 音と画面のずれの補正（手で足す分と、端末が知らせる遅れ） */
function applyAudioOffset() {
    synth.extraLatencyMs = settings.audioOffset;
    audioOffset.value = String(settings.audioOffset);
    $('audioOffsetValue').textContent = t('audioOffsetValue', { ms: settings.audioOffset });
    const auto = Math.max(0, Math.round(synth.latencyMs - settings.audioOffset));
    document.querySelector('[data-i18n="audioOffsetNote"]').textContent = t('audioOffsetNote', { auto });
}
audioOffset.addEventListener('input', () => {
    settings.audioOffset = Number(audioOffset.value);
    saveSettings(settings);
    applyAudioOffset();
});
rollZoom.addEventListener('input', () => {
    settings.rollZoom = Number(rollZoom.value);
    rollView.visibleBeats = settings.rollZoom;
    saveSettings(settings);
});
micChk.addEventListener('change', () => void setMic(micChk.checked));
micSelect.addEventListener('change', () => {
    settings.micDeviceId = micSelect.value;
    saveSettings(settings);
    if (mic.active)
        void setMic(true, false);
});
micSens.addEventListener('input', () => {
    settings.micSens = Number(micSens.value);
    mic.setSensitivity(settings.micSens);
    saveSettings(settings);
});
octaveFreeChk.addEventListener('change', () => {
    settings.octaveFree = octaveFreeChk.checked;
    if (session)
        session.octaveFree = settings.octaveFree;
    saveSettings(settings);
});
fullKeysChk.addEventListener('change', () => setFullKeys(fullKeysChk.checked));
// 選択やスライダー操作の後はフォーカスを外し、PC キーボードでの演奏やスペースキーと衝突しないようにする
document.addEventListener('change', (e) => {
    const t = e.target;
    if (t.closest('dialog'))
        return;
    if (t.tagName === 'SELECT' || (t.tagName === 'INPUT' && t.type !== 'text'))
        t.blur();
});
for (const el of document.querySelectorAll('.toolbar button, .chip, .top-actions button')) {
    el.addEventListener('mouseup', () => el.blur());
}
// キーボードショートカット
window.addEventListener('keydown', (e) => {
    const t = e.target;
    if (t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')
        return;
    if (t.tagName === 'INPUT' && !['range', 'checkbox'].includes(t.type))
        return;
    if (document.querySelector('dialog[open]'))
        return;
    if (e.key === '?' || (e.code === 'Slash' && e.shiftKey)) {
        e.preventDefault();
        void setHelp(helpPanel.hidden);
    }
    else if (e.code === 'Escape' && !helpPanel.hidden) {
        void setHelp(false);
    }
    else if (e.code === 'Space') {
        e.preventDefault();
        void synth.resume();
        session?.toggle();
    }
    else if (e.code === 'Home') {
        e.preventDefault();
        session?.rewind();
    }
    else if ((e.code === 'ArrowLeft' || e.code === 'ArrowRight') && e.shiftKey) {
        e.preventDefault();
        void skipPiece(e.code === 'ArrowLeft' ? -1 : 1);
    }
    else if ((e.code === 'ArrowLeft' || e.code === 'ArrowRight') && session && score) {
        e.preventDefault();
        // 反復のある曲は、演奏の順番で前後の小節へ
        const played = session.score;
        const m = measureAt(played, session.position());
        if (!m)
            return;
        const idx = Math.max(0, Math.min(played.measures.length - 1, m.index + (e.code === 'ArrowLeft' ? -1 : 1)));
        session.seek(played.measures[idx].start);
    }
}, true);
// ドラッグ & ドロップ
const dropHint = $('dropHint');
window.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropHint.classList.add('show');
});
window.addEventListener('dragleave', (e) => {
    if (e.relatedTarget === null)
        dropHint.classList.remove('show');
});
window.addEventListener('drop', (e) => {
    e.preventDefault();
    dropHint.classList.remove('show');
    const f = e.dataTransfer?.files[0];
    if (f)
        void openFile(f);
});
// ---- 描画ループ ---------------------------------------------------------
let lastStatus = '';
function frame(time) {
    if (session && score) {
        const snap = session.snapshot();
        const exp = snap.expected;
        const f = {
            time,
            position: snap.position,
            playing: snap.playing,
            waiting: snap.waiting,
            countingIn: snap.countingIn,
            expectedMidis: new Set(exp?.midis ?? []),
            expectedNoteIds: new Set(exp?.noteIds ?? []),
            expectedPressed: exp?.pressed ?? new Set(),
            held: snap.held,
            userParts: settings.role === 'listen' ? new Set() : melodyOn() ? melody.parts : session.userParts,
            userNotes: melodyOn() ? melody.played : null,
            noteStatus: session.noteStatus,
            statusVersion: snap.statusVersion,
            names: settings.names,
        };
        keyboardView.draw(f);
        rollView.draw(f, keyboardView.layout);
        // 楽譜には、反復を展開した位置・音を楽譜の位置・音に読み替えて描く
        const map = playMap;
        scoreView.update(map.unfolded
            ? {
                ...f,
                position: map.toWritten(snap.position),
                userNotes: f.userNotes && melody.ids,
                expectedNoteIds: new Set([...f.expectedNoteIds].map((id) => map.writtenId(id) ?? -1)),
                noteStatus: map.writtenStatus(session.noteStatus, snap.statusVersion, snap.position),
                statusVersion: snap.statusVersion * 100_000 + map.segmentIndexAt(snap.position),
            }
            : f);
        const m = measureAt(session.score, Math.max(0, snap.position));
        const st = snap.stats;
        const status = `${m?.number}|${st.hits}|${st.wrong}|${st.missed}|${snap.waiting}`;
        if (status !== lastStatus) {
            lastStatus = status;
            statusPos.innerHTML = t('measure', { n: m?.number ?? 1, total: score.measures.length }).replace(String(m?.number ?? 1), `<b>${m?.number ?? 1}</b>`);
            const g = liveGrades;
            statusScore.innerHTML =
                settings.role === 'listen'
                    ? t('playingExample')
                    : settings.style === 'karaoke'
                        ? `${t('liveGrades', { p: g.perfect, g: g.great, o: g.good, m: g.miss })}　<span class="bad">${t('mistakes')} ${st.wrong}</span>`
                        : `<span class="good">${t('played', { n: st.hits })}</span>　<span class="bad">${t('errors', { n: st.wrong + st.missed })}</span>${snap.waiting && snap.playing ? `　${t('waiting')}` : ''}`;
        }
    }
    requestAnimationFrame(frame);
}
function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
// ---- 起動 ---------------------------------------------------------------
async function boot() {
    setLanguage(settings.language);
    applyLanguageEverywhere();
    // 保存された設定を UI に反映
    metroChk.checked = settings.metronome;
    countInChk.checked = settings.countIn;
    syncRepeat();
    soundSelect.value = settings.sound;
    monitorChk.checked = settings.monitor;
    accompVol.value = String(settings.accompVol);
    voiceSelect.value = settings.accompVoice;
    channelSelect.replaceChildren(...Array.from({ length: 16 }, (_, i) => new Option(String(i + 1), String(i + 1))));
    channelSelect.value = String(settings.accompChannel);
    midi.channel = Math.max(0, Math.min(15, settings.accompChannel - 1));
    pedalChk.checked = settings.scorePedal;
    graceChk.checked = settings.playGraces;
    wedgeChk.checked = settings.playWedges;
    softBoostSelect.value = settings.softBoost;
    glissChk.checked = settings.playGlissandos;
    tremoloChk.checked = settings.playTremolos;
    sourceBreaksChk.checked = settings.sourceBreaks;
    scoreView.setBreaks(settings.sourceBreaks ? 'source' : 'fit');
    glissModeSelect.value = settings.glissMode;
    applyVoice();
    namesSelect.value = settings.names;
    namesSeg.value = settings.names;
    keysSeg.value = settings.fullKeys ? 'full' : 'fit';
    rollZoom.value = String(settings.rollZoom);
    rollView.visibleBeats = settings.rollZoom;
    applyAudioOffset();
    fullKeysChk.checked = settings.fullKeys;
    keyboardView.full = settings.fullKeys;
    micSens.value = String(settings.micSens);
    mic.setSensitivity(settings.micSens);
    octaveFreeChk.checked = settings.octaveFree;
    if (!mic.supported)
        micBtn.hidden = true;
    if (settings.helpOpen)
        void setHelp(true);
    // ブラウザは操作があるまで音声を止めているので、最初の操作で再開する
    const wake = () => {
        void synth.resume().catch(() => { });
        mic.resume();
    };
    window.addEventListener('pointerdown', wake, true);
    window.addEventListener('keydown', wake, true);
    qwerty.attach();
    qwerty.on('note', (e) => handleNote(e, true));
    qwerty.on('octave', ({ base }) => toast(t('pcOctave', { octave: base / 12 - 1 })));
    setupMobile({ resume: wake });
    requestAnimationFrame(frame);
    await loadLibrary();
    await openEntry(settings.pieceId);
    // 前回マイクを使っていたら続けて使う（許可済みならダイアログは出ない）
    if (settings.mic)
        void setMic(true, false);
    void refreshMicDevices();
    await initMidi();
}
void boot();
// デバッグ・自動テスト用（コンソールから操作できるように）
Object.assign(window, { scoreCompanion: { get session() { return session; }, get score() { return score; }, midi, mic, synth, registry } });
