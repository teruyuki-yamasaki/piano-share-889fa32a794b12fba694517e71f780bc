import { renderMarkdown } from "./markdown.js";
/** 操作ガイド（app/guide/<言語>.md）を読み込んで HTML にする。右パネルと単独ページで共通 */
export async function loadGuide(lang) {
    const res = await fetch(`./guide/${lang}.md`, { cache: 'no-cache' });
    if (!res.ok)
        throw new Error(`${res.status}`);
    return renderMarkdown(await res.text());
}
/** 見出し（##）の目次 */
export function guideToc(headings) {
    return headings
        .filter((h) => h.level === 2)
        .map((h) => `<a href="#${h.id}">${h.text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)}</a>`)
        .join('');
}
