import { backend } from "./backend.js";
import { t } from "./i18n.js";
/**
 * スマートフォン・タブレットで使うための準備。
 *  - 「タップして開始」: iOS はユーザーが画面に触れるまで音を出せないので、最初の画面で一度タップしてもらう
 *  - 消音スイッチの案内: iPhone がマナーモードだと Web Audio の音が出ないことがある
 *  - Service Worker: 静的なホスティングから開いたとき、一度開いたファイルを端末に残してオフラインでも開けるように
 *    （Android の Chrome・iPhone の Safari では動く。MIDIWeb Browser などアプリ内のブラウザでは動かないことがあり、そのときは毎回ネットから読む）
 */
export function isIos() {
    if (typeof navigator === 'undefined')
        return false;
    return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}
export function isTouchDevice() {
    return typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
}
export function setupMobile(hooks) {
    // iOS 17 以降の Safari / WKWebView: 「再生」の扱いにすると、消音スイッチがオンでも音が出る
    const session = navigator.audioSession;
    if (session) {
        try {
            session.type = 'playback';
        }
        catch {
            /* 未対応 */
        }
    }
    if (isTouchDevice() || isIos())
        showStartOverlay(hooks);
    void registerServiceWorker();
}
function showStartOverlay(hooks) {
    const overlay = document.createElement('div');
    overlay.className = 'start-overlay';
    overlay.id = 'startOverlay';
    const box = document.createElement('div');
    box.className = 'start-box';
    const button = document.createElement('button');
    button.className = 'btn start-btn';
    button.textContent = t('tapToStart');
    const note = document.createElement('p');
    note.className = 'start-note';
    note.textContent = isIos() ? t('muteSwitchHint') : t('tapToStartNote');
    box.append(button, note);
    overlay.append(box);
    document.body.append(overlay);
    button.focus();
    const start = () => {
        hooks.resume();
        overlay.remove();
    };
    // touchend / click のどちらでも（iOS は touchend の中で音声を再開できる）
    button.addEventListener('click', start, { once: true });
    overlay.addEventListener('touchend', start, { once: true });
}
async function registerServiceWorker() {
    if (!('serviceWorker' in navigator))
        return;
    // Mac 版（serve.mjs）では使わない（開発中に古いファイルが残らないように）
    if ((await backend()) !== 'browser')
        return;
    try {
        await navigator.serviceWorker.register('./sw.js', { scope: './' });
    }
    catch {
        /* アプリ内のブラウザなどで使えない。毎回ネットから読む */
    }
}
