/**
 * 曲を続けて再生する順番（曲の選択欄に並んでいる順の曲 ID）と、リピートボタンの状態。DOM には触れない。
 */
/**
 * いまの曲の次（dir = -1 なら前）に再生する曲。リストにない曲・開けない曲は飛ばす。
 * 端まで行ったら wrap のときだけ反対の端へ回る
 */
export function nextInPlaylist(list, currentId, canOpen, wrap, dir = 1) {
    const i = currentId === null ? -1 : list.indexOf(currentId);
    if (i < 0)
        return null;
    for (let k = 1; k <= list.length; k++) {
        const j = i + k * dir;
        if ((j < 0 || j >= list.length) && !wrap)
            return null;
        const id = list[(j + list.length) % list.length];
        if (canOpen(id))
            return id;
    }
    return null;
}
/** リピートボタンを押したときの次の状態（音楽プレイヤーと同じく off → all → one → off） */
export function nextRepeatMode(m) {
    return m === 'off' ? 'all' : m === 'all' ? 'one' : 'off';
}
