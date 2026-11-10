import { backend } from "./backend.js";
const KEY = 'score-companion/melody-edits/v1';
const EMPTY = { add: [], remove: [] };
/** このブラウザに残している手直しすべて（バックアップの書き出し用） */
export function localMelodyEdits() {
    return loadAll();
}
function loadAll() {
    try {
        return JSON.parse(localStorage.getItem(KEY) ?? '{}') ?? {};
    }
    catch {
        return {};
    }
}
function normalize(e) {
    return { add: Array.isArray(e?.add) ? e.add : [], remove: Array.isArray(e?.remove) ? e.remove : [] };
}
const isEmpty = (e) => !e.add.length && !e.remove.length;
function loadLocal(pieceId) {
    return normalize(loadAll()[pieceId]);
}
/** 手直しがなくなったら、その曲の記録を消す */
function saveLocal(pieceId, edits) {
    const all = loadAll();
    if (isEmpty(edits))
        delete all[pieceId];
    else
        all[pieceId] = edits;
    try {
        localStorage.setItem(KEY, JSON.stringify(all));
    }
    catch {
        /* プライベートモードなど */
    }
}
async function putFile(pieceId, edits) {
    try {
        const res = await fetch(`./api/melody/${encodeURIComponent(pieceId)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(edits),
        });
        return res.ok;
    }
    catch {
        return false;
    }
}
/** inFile: 楽譜ファイルのある曲（同梱曲・マイライブラリ）なら true */
export async function loadMelodyEdits(pieceId, inFile) {
    const local = loadLocal(pieceId);
    // スマートフォン版（サーバーなし）はブラウザにだけ保存する
    if (inFile && (await backend()) === 'server') {
        try {
            const res = await fetch(`./api/melody/${encodeURIComponent(pieceId)}`, { cache: 'no-cache' });
            if (res.ok) {
                const edits = normalize(await res.json());
                if (!isEmpty(edits) || isEmpty(local))
                    return { edits, storage: 'file' };
                // ブラウザにだけ残っていた手直しを、楽譜の隣へ移す
                if (await putFile(pieceId, local)) {
                    saveLocal(pieceId, EMPTY);
                    return { edits: local, storage: 'file' };
                }
            }
        }
        catch {
            /* サーバーがない・古い */
        }
    }
    return { edits: local, storage: 'browser' };
}
/** 保存して、実際に保存した場所を返す（楽譜の隣に書けなければブラウザに） */
export async function saveMelodyEdits(pieceId, edits, storage) {
    if (storage === 'file' && (await backend()) === 'server' && (await putFile(pieceId, edits)))
        return 'file';
    saveLocal(pieceId, edits);
    return 'browser';
}
