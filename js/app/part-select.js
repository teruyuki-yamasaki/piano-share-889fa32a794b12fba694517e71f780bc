import { partChipOrder } from "../core/score-utils.js";
/**
 * 「弾く」モードで自分が弾くパートの選び方（画面に触れない部分。テストできるよう main.ts から分けている）
 */
/** 「弾く」に切り替えたときの最初の選び方: 主旋律のパート（ピアノ曲は右手、連弾はプリモの両手）。なければ最初のパート */
export function defaultPlayParts(s) {
    const melody = s.parts.filter((p) => p.role === 'melody').map((p) => p.id);
    return melody.length ? melody : s.parts.slice(0, 1).map((p) => p.id);
}
/**
 * パートのボタンのまとまり。連弾は奏者ごと（セコンド → プリモ）に、奏者のボタンの下に左手・右手を並べる。
 * ふつうの曲は奏者なしのまとまりが 1 つ
 */
export function partChipGroups(parts) {
    const groups = [];
    for (const p of partChipOrder(parts)) {
        const last = groups[groups.length - 1];
        if (last && last.player === p.player)
            last.parts.push(p);
        else
            groups.push({ ...(p.player ? { player: p.player } : {}), parts: [p] });
    }
    return groups;
}
/** ボタンを押したときの選び方: 押したパートが全部自分のものなら全部自動に、そうでなければ全部自分に（奏者のボタンは両手まとめて） */
export function toggleParts(current, ids) {
    const set = new Set(current);
    if (ids.every((id) => set.has(id)))
        for (const id of ids)
            set.delete(id);
    else
        for (const id of ids)
            set.add(id);
    return set;
}
