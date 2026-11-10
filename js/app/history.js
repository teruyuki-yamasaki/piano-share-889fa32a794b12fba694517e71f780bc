/** 採点モードの記録（曲ごと、新しい順に最大 MAX 件）。このブラウザの localStorage に保存する */
const KEY = 'score-companion/history/v1';
const MAX = 20;
function loadAll() {
    try {
        return JSON.parse(localStorage.getItem(KEY) ?? '{}') ?? {};
    }
    catch {
        return {};
    }
}
export function loadHistory(pieceId) {
    const list = loadAll()[pieceId];
    return Array.isArray(list) ? list : [];
}
/** 記録を追加して、追加後の一覧（新しい順）を返す */
export function addHistory(pieceId, entry) {
    const all = loadAll();
    const list = [entry, ...(all[pieceId] ?? [])].slice(0, MAX);
    all[pieceId] = list;
    try {
        localStorage.setItem(KEY, JSON.stringify(all));
    }
    catch {
        /* プライベートモードなど */
    }
    return list;
}
/** 記録すべて（バックアップの書き出し用） */
export function allHistory() {
    return loadAll();
}
/** バックアップの記録を足す（同じ日時の記録は重ねない）。足した件数を返す */
export function mergeHistory(incoming) {
    const all = loadAll();
    let added = 0;
    for (const [key, list] of Object.entries(incoming)) {
        if (!Array.isArray(list))
            continue;
        const mine = all[key] ?? [];
        const seen = new Set(mine.map((e) => e.date));
        const fresh = list.filter((e) => e && typeof e.date === 'number' && !seen.has(e.date));
        if (!fresh.length)
            continue;
        added += fresh.length;
        all[key] = [...mine, ...fresh].sort((a, b) => b.date - a.date).slice(0, MAX);
    }
    try {
        localStorage.setItem(KEY, JSON.stringify(all));
    }
    catch {
        /* プライベートモードなど */
    }
    return added;
}
