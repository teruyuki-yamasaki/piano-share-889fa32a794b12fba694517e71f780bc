/**
 * マイライブラリとのやり取り。
 *  - Mac 版（serve.mjs から開いたとき）: /api/library。楽譜は user-library/ に保存される
 *  - スマートフォン版（静的なホスティングから開いたとき）: このブラウザの IndexedDB（local-library.ts）
 */
import { parseMidiFile } from "../import/midi-file.js";
import { musicXmlText, parseMusicXml } from "../import/musicxml.js";
import { backend } from "./backend.js";
import { localGet, localList, localPut, localRemove, makeEntry, requestPersistence } from "./local-library.js";
async function json(res) {
    const body = await res.json().catch(() => ({}));
    if (!res.ok)
        throw new Error(body.error ?? `HTTP ${res.status}`);
    return body;
}
export async function fetchUserLibrary() {
    if ((await backend()) === 'browser')
        return localList();
    return json(await fetch('./api/library', { cache: 'no-cache' }));
}
/** 登録した楽譜ファイルの中身 */
export async function fetchUserScore(e) {
    if ((await backend()) === 'browser') {
        const bytes = await localGet(e.id);
        if (!bytes)
            throw new Error(`見つかりません: ${e.title}`);
        return bytes;
    }
    const res = await fetch(`./user-library/${e.file}`);
    if (!res.ok)
        throw new Error(`HTTP ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
}
/**
 * MusicXML / MIDI を登録する（PDF は受け付けない）。
 * keep: バックアップから戻すとき、元の id・登録日時を引き継ぐ（ブラウザに保存するときだけ。サーバーは新しい id をつける）
 */
export async function uploadToLibrary(file, keep) {
    if ((await backend()) === 'browser') {
        if (/\.pdf$/i.test(file.name))
            throw new Error('PDF は直接は登録できません。楽譜認識のツール（score-omr など）で MusicXML にしてから登録してください。');
        if (!/\.(musicxml|xml|mxl|midi?)$/i.test(file.name))
            throw new Error(`対応していないファイル形式です: ${file.name}`);
        const bytes = new Uint8Array(await file.arrayBuffer());
        const score = /\.midi?$/i.test(file.name) ? parseMidiFile(bytes, file.name) : parseMusicXml(await musicXmlText(bytes));
        const entry = makeEntry(file.name, score, keep?.id, keep?.addedAt);
        if (keep?.title)
            entry.title = keep.title;
        await localPut(entry, bytes);
        void requestPersistence();
        return { entries: [entry] };
    }
    return json(await fetch(`./api/library?name=${encodeURIComponent(file.name)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: file,
    }));
}
export async function removeFromLibrary(id) {
    if ((await backend()) === 'browser')
        return localRemove(id);
    await json(await fetch(`./api/library/${encodeURIComponent(id)}`, { method: 'DELETE' }));
}
