const WORKER_SRC = `let id = null;
onmessage = (e) => {
  if (id !== null) clearInterval(id);
  id = e.data > 0 ? setInterval(() => postMessage(0), e.data) : null;
};`;
let workerUrl = null;
export function startTicker(fn, ms) {
    if (typeof Worker !== 'undefined' && typeof Blob !== 'undefined' && typeof URL !== 'undefined') {
        try {
            workerUrl ??= URL.createObjectURL(new Blob([WORKER_SRC], { type: 'text/javascript' }));
            const w = new Worker(workerUrl);
            let stopped = false;
            let lastWorkerTick = performance.now();
            w.onmessage = () => {
                if (stopped)
                    return;
                lastWorkerTick = performance.now();
                fn();
            };
            // WKWebView のオフラインコピーなどでは new Worker() が成功しても、
            // 後から Blob の読み込みが失敗することがある。音だけ止まって表示が
            // 進み続けないよう、メッセージが届かない場合も通常のタイマーで予約する。
            const backup = setInterval(() => {
                if (!stopped && performance.now() - lastWorkerTick >= ms * 2)
                    fn();
            }, ms);
            w.onerror = () => {
                w.terminate();
                lastWorkerTick = -Infinity;
            };
            try {
                w.postMessage(ms);
            }
            catch (err) {
                stopped = true;
                clearInterval(backup);
                w.terminate();
                throw err;
            }
            return { stop: () => {
                    stopped = true;
                    clearInterval(backup);
                    w.onmessage = null;
                    w.onerror = null;
                    w.terminate();
                } };
        }
        catch {
            // Worker を作れなければ、ふつうのタイマーで回す
        }
    }
    const id = setInterval(fn, ms);
    return { stop: () => clearInterval(id) };
}
