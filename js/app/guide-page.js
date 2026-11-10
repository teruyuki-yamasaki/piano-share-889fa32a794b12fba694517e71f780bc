/** 操作ガイドを単独のタブで表示するページ（guide.html） */
import { guideToc, loadGuide } from "../ui/guide.js";
import { applyTheme, loadSettings } from "./settings.js";
const param = new URLSearchParams(location.search).get('lang');
const lang = param === 'en' || param === 'ja' ? param : loadSettings().language;
document.documentElement.lang = lang;
applyTheme(loadSettings().theme);
const doc = document.getElementById('guide');
const toc = document.getElementById('toc');
try {
    const g = await loadGuide(lang);
    doc.innerHTML = g.html;
    toc.innerHTML = guideToc(g.headings);
    document.title = g.headings[0]?.text ?? document.title;
    if (location.hash)
        document.getElementById(decodeURIComponent(location.hash.slice(1)))?.scrollIntoView();
}
catch (err) {
    doc.textContent = `${lang === 'en' ? 'Could not load the guide' : 'ガイドを読み込めませんでした'} (${err.message})`;
}
