/**
 * 弱音を聴きやすくする補助（再生だけ。楽譜・MusicXML の強弱記号は変えない）。
 *
 *   v' = 127 · (v / 127) ^ (1 − 0.35 · strength)      strength: 0（切）〜 1（強）
 *
 * - 127 は 127 のまま（強い音は今より大きくならないので、クリッピングは増えない）
 * - 小さい v ほど持ち上がる（指数が 1 より小さい）。順番は変わらない（単調）ので、pp < p < mf < f の関係は残る
 * - 内蔵音源は (v/127)^1.6 で音量にするので、中（0.65）では ppp（30）が −20.1 → −15.5 dB、pp（42）が −15.4 → −11.9 dB、
 *   mf（80）が −6.4 → −5.0 dB、ff（110）が −2.0 → −1.5 dB（ピークの目安。ppp と ff の差は 18.1 → 14.0 dB）
 * 自動で弾く音（伴奏・お手本・前打音）にだけ掛ける。ユーザーが弾く音は変えない
 */
export const SOFT_BOOST = { off: 0, light: 0.35, medium: 0.65, strong: 1 };
export function audibleVelocity(v, strength) {
    if (strength <= 0 || v <= 0)
        return v;
    const x = Math.min(1, v / 127);
    return 127 * x ** (1 - 0.35 * Math.min(1, strength));
}
