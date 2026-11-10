let detected = null;
export function backend() {
    detected ??= probe();
    return detected;
}
async function probe() {
    try {
        const res = await fetch('./api/health', { cache: 'no-store', signal: AbortSignal.timeout(2000) });
        // 静的ホスティングは知らないパスに index.html（200）を返すことがあるので、中身まで確かめる
        if (res.ok && (await res.json()).app === 'score-companion')
            return 'server';
    }
    catch {
        /* サーバーがない・オフライン */
    }
    return 'browser';
}
