/** 鍵盤とピアノロールで共有する「MIDI 番号 → 横位置」の対応 */
const BLACK = new Set([1, 3, 6, 8, 10]);
const BLACK_OFFSET = { 1: -0.12, 3: 0.12, 6: -0.15, 8: 0, 10: 0.15 };
export function isBlack(midi) {
    return BLACK.has(((midi % 12) + 12) % 12);
}
export class KeyLayout {
    lo;
    hi;
    width;
    whiteW;
    blackW;
    rects = new Map();
    constructor(lo, hi, width) {
        while (isBlack(lo))
            lo--;
        while (isBlack(hi))
            hi++;
        this.lo = lo;
        this.hi = hi;
        this.width = width;
        let whites = 0;
        for (let m = lo; m <= hi; m++)
            if (!isBlack(m))
                whites++;
        this.whiteW = width / whites;
        this.blackW = this.whiteW * 0.62;
        let wi = 0;
        for (let m = lo; m <= hi; m++) {
            if (isBlack(m)) {
                const off = BLACK_OFFSET[m % 12] * this.blackW;
                this.rects.set(m, { x: wi * this.whiteW - this.blackW / 2 + off, w: this.blackW, black: true });
            }
            else {
                this.rects.set(m, { x: wi * this.whiteW, w: this.whiteW, black: false });
                wi++;
            }
        }
    }
    rect(midi) {
        return this.rects.get(midi);
    }
    /** 曲の音域に合わせて表示範囲を決める（最低 3 オクターブ、オクターブ単位） */
    static rangeFor(midis, full = false) {
        if (full || midis.length === 0)
            return [21, 108];
        let lo = Math.min(...midis);
        let hi = Math.max(...midis);
        lo = Math.floor((lo - 2) / 12) * 12;
        hi = Math.ceil((hi + 2) / 12) * 12 - 1;
        while (hi - lo < 36) {
            if (lo > 36)
                lo -= 12;
            if (hi - lo < 36)
                hi += 12;
        }
        return [Math.max(21, lo), Math.min(108, hi)];
    }
}
const SOLFEGE_JA = ['ド', 'ド♯', 'レ', 'レ♯', 'ミ', 'ファ', 'ファ♯', 'ソ', 'ソ♯', 'ラ', 'ラ♯', 'シ'];
const SOLFEGE_EN = ['Do', 'Do♯', 'Re', 'Re♯', 'Mi', 'Fa', 'Fa♯', 'Sol', 'Sol♯', 'La', 'La♯', 'Ti'];
let SOLFEGE = SOLFEGE_JA;
/** ドレミ表記を表示言語に合わせる（日本語はカタカナ、英語は Do Re Mi） */
export function setSolfegeLanguage(lang) {
    SOLFEGE = lang === 'en' ? SOLFEGE_EN : SOLFEGE_JA;
}
const LETTERS = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
export function noteLabel(midi, style, withOctave = false) {
    if (style === 'none')
        return '';
    const pc = midi % 12;
    const base = style === 'solfege' ? SOLFEGE[pc] : LETTERS[pc];
    return withOctave && style === 'letter' ? `${base}${Math.floor(midi / 12) - 1}` : base;
}
