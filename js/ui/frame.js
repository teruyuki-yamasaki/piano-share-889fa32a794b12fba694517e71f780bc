/** 自分が弾く音か（「主旋律」モードは音ごと、ほかはパートごと） */
export function isUserNote(f, n) {
    return f.userNotes ? f.userNotes.has(n.id) : f.userParts.has(n.partId);
}
export const COLORS = {
    good: '#36C67E',
    bad: '#EF4E5E',
    neutral: '#9AA6C4',
    felt: '#B3263E',
};
/** '#RRGGBB' に透明度をつける */
export function alpha(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}
export function setupCanvas(canvas) {
    const dpr = window.devicePixelRatio || 1;
    const { width, height } = canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(width * dpr));
    const h = Math.max(1, Math.round(height * dpr));
    if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
    }
    const ctx = canvas.getContext('2d');
    // 描画側の座標は clientWidth/clientHeight（整数）。小数の CSS サイズや
    // ページ拡大率があっても、描画の右下端を実際のバッファの端に一致させる。
    ctx.setTransform(w / Math.max(1, canvas.clientWidth), 0, 0, h / Math.max(1, canvas.clientHeight), 0, 0);
    return ctx;
}
