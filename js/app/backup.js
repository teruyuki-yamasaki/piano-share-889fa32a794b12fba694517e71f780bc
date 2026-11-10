/**
 * バックアップ（マイライブラリの楽譜・主旋律の手直し・採点の記録を 1 つの JSON ファイルに）。
 * スマートフォン版は曲を IndexedDB に入れるが、IndexedDB はブラウザに消されることがあり、
 * Safari と MIDIWeb Browser のような別のアプリとは共有されないので、ファイルで出し入れできるようにする。
 * Mac 版（serve.mjs）で書き出したものをスマートフォン版で読み込む（その逆も）こともできる。
 *
 *   { "format": "score-companion-backup", "version": 1, "exportedAt": "<ISO 8601>",
 *     "scores": [{ "entry": { id, title, … }, "data": "<楽譜ファイルの base64>" }],
 *     "melody": { "<曲の id>": { add, remove } }, "history": { "<曲の id>": [ … ] } }
 */
export const BACKUP_FORMAT = 'score-companion-backup';
const isEmpty = (e) => !e || (!e.add?.length && !e.remove?.length);
export async function createBackup(deps, now = new Date()) {
    const entries = await deps.list();
    const scores = [];
    for (const entry of entries)
        scores.push({ entry, data: toBase64(await deps.read(entry)) });
    const melody = {};
    for (const [id, e] of Object.entries(deps.localMelody()))
        if (!isEmpty(e))
            melody[id] = e;
    for (const id of [...deps.bundledIds, ...entries.map((e) => e.id)]) {
        const e = await deps.loadMelody(id);
        if (!isEmpty(e))
            melody[id] = e;
    }
    return { format: BACKUP_FORMAT, version: 1, exportedAt: now.toISOString(), scores, melody, history: deps.history() };
}
/** 読み込んだ JSON がバックアップか確かめる */
export function parseBackup(text) {
    let data;
    try {
        data = JSON.parse(text);
    }
    catch {
        throw new Error('バックアップのファイルとして読めませんでした');
    }
    if (data?.format !== BACKUP_FORMAT)
        throw new Error('Score Companion のバックアップではありません');
    if (data.version !== 1)
        throw new Error(`新しい版のバックアップです（version ${data.version}）。アプリを更新してください`);
    return {
        format: BACKUP_FORMAT,
        version: 1,
        exportedAt: String(data.exportedAt ?? ''),
        scores: Array.isArray(data.scores) ? data.scores.filter((s) => s?.entry?.id && typeof s.data === 'string') : [],
        melody: data.melody && typeof data.melody === 'object' ? data.melody : {},
        history: data.history && typeof data.history === 'object' ? data.history : {},
    };
}
/** 同じ曲かどうか（id はサーバーに登録し直すと変わるので、曲名と大きさで見る） */
const sameKey = (e) => `${e.title}|${e.measures}|${e.notes}`;
/**
 * バックアップを戻す。すでにある曲は足さない。手直しは、いまの手直しがない曲にだけ戻す（上書きしない）。
 */
export async function restoreBackup(backup, deps) {
    const result = { added: 0, skipped: 0, melody: 0, history: 0, errors: [] };
    const existing = await deps.list();
    const byKey = new Map(existing.map((e) => [sameKey(e), e.id]));
    const byId = new Set(existing.map((e) => e.id));
    /** バックアップの id → いまの id */
    const ids = new Map();
    for (const { entry, data } of backup.scores) {
        const have = byId.has(entry.id) ? entry.id : byKey.get(sameKey(entry));
        if (have) {
            ids.set(entry.id, have);
            result.skipped++;
            continue;
        }
        try {
            const name = entry.originalName || entry.file;
            const added = await deps.add(name, fromBase64(data), entry);
            ids.set(entry.id, added.id);
            byKey.set(sameKey(added), added.id);
            result.added++;
        }
        catch (err) {
            result.errors.push(`${entry.title}: ${err.message}`);
        }
    }
    for (const [id, edits] of Object.entries(backup.melody)) {
        if (isEmpty(edits))
            continue;
        const target = ids.get(id) ?? id;
        if (!isEmpty(await deps.loadMelody(target)))
            continue;
        await deps.saveMelody(target, { add: [...(edits.add ?? [])], remove: [...(edits.remove ?? [])] });
        result.melody++;
    }
    const history = {};
    for (const [id, list] of Object.entries(backup.history))
        history[ids.get(id) ?? id] = list;
    result.history = deps.mergeHistory(history);
    return result;
}
export function backupFileName(now = new Date()) {
    const p = (n) => String(n).padStart(2, '0');
    return `score-companion-${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}.json`;
}
export function toBase64(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000)
        s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
}
export function fromBase64(b64) {
    const s = atob(b64);
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++)
        out[i] = s.charCodeAt(i);
    return out;
}
