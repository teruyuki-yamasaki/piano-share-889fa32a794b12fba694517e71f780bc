/**
 * アプリ全体で共有するスコア（楽曲）モデル。
 *
 * 時間の単位はすべて「拍（四分音符 = 1.0）」。秒への変換は TempoMap が担当する。
 * インポーター（MusicXML / MIDI）はすべてこの形に正規化して返すので、
 * エンジンや UI は元のファイル形式を意識しなくてよい。
 */
export const EPS = 1e-6;
/** 強弱記号 → 音の強さ（velocity）。読み込み（音の強さ）と演奏（松葉の行き先）で同じ表を使う */
export const DYNAMICS = { ppp: 30, pp: 42, p: 55, mp: 68, mf: 80, f: 96, ff: 110, fff: 122 };
/**
 * 強弱に関する文字の指示（<words>）として扱う語。大文字・小文字と末尾のピリオドは区別しない。
 * 「poco a poco cresc.」のように、どれかを語として含めば強弱の文字とする（「crescendo poco a poco」なども）
 */
export const WORD_DYNAMICS = ['cresc', 'crescendo', 'decresc', 'decrescendo', 'dim', 'diminuendo', 'morendo', 'calando', 'smorz', 'smorzando', 'perdendosi', 'rinf', 'rinforzando'];
export function wordKind(text) {
    const words = text.toLowerCase().split(/[\s.,;:()]+/).filter(Boolean);
    return words.some((w) => WORD_DYNAMICS.includes(w)) ? 'dynamics' : 'other';
}
