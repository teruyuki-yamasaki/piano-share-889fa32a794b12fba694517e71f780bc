/**
 * サーバーのないとき（スマートフォン・タブレットで静的なホスティングから開いたとき）のマイライブラリ。
 * 楽譜ファイルはこのブラウザの IndexedDB に入れる。
 * IndexedDB はブラウザに消されることがあり、Safari と MIDIWeb Browser のような別のアプリとは共有されないので、
 * 「バックアップを書き出す / 読み込む」（backup.ts）でファイルに出し入れできるようにしている。
 */
const DB = 'score-companion';
const STORE = 'user-library';
/** 登録する曲の一覧の項目を作る（server/library.mjs の add と同じ形） */
export function makeEntry(name, score, id = newId(), now = Date.now()) {
    const notes = score.parts.reduce((a, p) => a + p.notes.length, 0);
    if (notes === 0)
        throw new Error(`${name}: 音符が見つかりませんでした`);
    const ext = (/\.[^.]+$/.exec(name)?.[0] ?? '.mxl').toLowerCase();
    const untitled = !score.meta.title || score.meta.title === '無題';
    return {
        id,
        title: untitled ? name.replace(/\.[^.]+$/, '') : score.meta.title,
        composer: score.meta.composer ?? '',
        file: `${id}${ext}`,
        source: ext.slice(1),
        originalName: name,
        addedAt: now,
        measures: score.measures.length,
        notes,
    };
}
export function newId() {
    const rand = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID().slice(0, 6) : Math.random().toString(36).slice(2, 8);
    return `u-${Date.now().toString(36)}-${rand}`;
}
let opened = null;
function db() {
    opened ??= new Promise((ok, fail) => {
        if (typeof indexedDB === 'undefined')
            return fail(new Error('IndexedDB が使えません'));
        const req = indexedDB.open(DB, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'entry.id' });
        req.onsuccess = () => ok(req.result);
        req.onerror = () => fail(req.error ?? new Error('IndexedDB を開けませんでした'));
        req.onblocked = () => fail(new Error('IndexedDB が別のタブで使われています'));
    });
    opened.catch(() => (opened = null));
    return opened;
}
async function run(mode, body) {
    const tx = (await db()).transaction(STORE, mode);
    const req = body(tx.objectStore(STORE));
    return new Promise((ok, fail) => {
        tx.oncomplete = () => ok(req.result);
        tx.onerror = tx.onabort = () => fail(tx.error ?? req.error ?? new Error('IndexedDB の操作に失敗しました'));
    });
}
/** 追加した順 */
export async function localList() {
    const all = (await run('readonly', (s) => s.getAll()));
    return all.map((r) => r.entry).sort((a, b) => a.addedAt - b.addedAt);
}
export async function localGet(id) {
    const r = (await run('readonly', (s) => s.get(id)));
    return r ? new Uint8Array(r.bytes) : null;
}
export async function localPut(entry, bytes) {
    await run('readwrite', (s) => s.put({ entry, bytes }));
}
export async function localRemove(id) {
    await run('readwrite', (s) => s.delete(id));
}
/** 端末の空きが少ないときに IndexedDB が消されにくくなるよう頼む（できなくても動く） */
export async function requestPersistence() {
    try {
        if (navigator.storage?.persisted && !(await navigator.storage.persisted()))
            await navigator.storage.persist?.();
    }
    catch {
        /* 未対応 */
    }
}
