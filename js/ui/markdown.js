/**
 * 操作ガイド（docs 的な Markdown）を表示するための小さな Markdown → HTML 変換。
 * 対応: 見出し / 段落 / 箇条書き（入れ子 1 段まで）/ 番号つきリスト / 表 / 引用 / コード / 区切り線 /
 *       **太字** / `コード` / [リンク](url) / <kbd>キー</kbd>
 * 中身は同梱のガイドだけなので完全な CommonMark 互換は目指さないが、HTML は必ずエスケープする。
 */
export function renderMarkdown(src) {
    const lines = src.replace(/\r\n?/g, '\n').split('\n');
    const out = [];
    const headings = [];
    const ids = new Set();
    let i = 0;
    const isBlockStart = (l) => /^(#{1,6}\s|>\s?|```|\s*[-*]\s|\s*\d+\.\s|\|)/.test(l) || /^-{3,}\s*$/.test(l);
    while (i < lines.length) {
        const line = lines[i];
        if (!line.trim()) {
            i++;
            continue;
        }
        // 見出し
        const h = /^(#{1,6})\s+(.*)$/.exec(line);
        if (h) {
            const level = h[1].length;
            const text = h[2].trim();
            let id = slug(text);
            for (let n = 2; ids.has(id); n++)
                id = `${slug(text)}-${n}`;
            ids.add(id);
            headings.push({ level, text: stripInline(text), id });
            out.push(`<h${level} id="${id}">${inline(text)}</h${level}>`);
            i++;
            continue;
        }
        // コード
        if (line.startsWith('```')) {
            const body = [];
            i++;
            while (i < lines.length && !lines[i].startsWith('```'))
                body.push(lines[i++]);
            i++;
            out.push(`<pre><code>${escapeHtml(body.join('\n'))}</code></pre>`);
            continue;
        }
        if (/^-{3,}\s*$/.test(line)) {
            out.push('<hr />');
            i++;
            continue;
        }
        // 引用
        if (/^>\s?/.test(line)) {
            const body = [];
            while (i < lines.length && /^>\s?/.test(lines[i]))
                body.push(lines[i++].replace(/^>\s?/, ''));
            out.push(`<blockquote>${renderMarkdown(body.join('\n')).html}</blockquote>`);
            continue;
        }
        // 表
        if (line.startsWith('|') && i + 1 < lines.length && /^\|[\s:|-]+\|?\s*$/.test(lines[i + 1])) {
            const head = cells(line);
            i += 2;
            const rows = [];
            while (i < lines.length && lines[i].startsWith('|'))
                rows.push(cells(lines[i++]));
            out.push(`<table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>` +
                rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('') +
                '</tbody></table>');
            continue;
        }
        // リスト
        if (/^\s*([-*]|\d+\.)\s/.test(line)) {
            const block = [];
            while (i < lines.length && (/^\s*([-*]|\d+\.)\s/.test(lines[i]) || (/^\s{2,}\S/.test(lines[i]) && block.length)))
                block.push(lines[i++]);
            out.push(list(block));
            continue;
        }
        // 段落
        const para = [];
        while (i < lines.length && lines[i].trim() && !isBlockStart(lines[i]))
            para.push(lines[i++].trim());
        if (para.length === 0)
            para.push(lines[i++].trim());
        out.push(`<p>${inline(para.join(' '))}</p>`);
    }
    return { html: out.join('\n'), headings };
}
function list(block) {
    const ordered = /^\s*\d+\./.test(block[0]);
    const items = [];
    const baseIndent = block[0].match(/^\s*/)[0].length;
    for (const l of block) {
        const indent = l.match(/^\s*/)[0].length;
        const m = /^\s*([-*]|\d+\.)\s+(.*)$/.exec(l);
        if (m && indent <= baseIndent)
            items.push({ text: m[2], children: [] });
        else if (items.length) {
            if (m)
                items[items.length - 1].children.push(l);
            else
                items[items.length - 1].text += ' ' + l.trim();
        }
    }
    const tag = ordered ? 'ol' : 'ul';
    return `<${tag}>${items.map((it) => `<li>${inline(it.text)}${it.children.length ? list(it.children) : ''}</li>`).join('')}</${tag}>`;
}
function cells(row) {
    return row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
}
function inline(text) {
    // 先にコードとキー表記を退避してから、残りをエスケープ・装飾する
    const keep = [];
    const stash = (html) => `\u0000${keep.push(html) - 1}\u0000`;
    let s = text
        .replace(/`([^`]+)`/g, (_, c) => stash(`<code>${escapeHtml(c)}</code>`))
        .replace(/<kbd>(.*?)<\/kbd>/g, (_, c) => stash(`<kbd>${escapeHtml(c)}</kbd>`));
    s = escapeHtml(s)
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?![*\w])/g, '$1<em>$2</em>')
        .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, href) => {
        const safe = /^(https?:|#|\.{0,2}\/|[\w-]+\.(md|html))/.test(href) ? href : '#';
        const ext = /^https?:/.test(safe) ? ' target="_blank" rel="noopener"' : '';
        return `<a href="${safe}"${ext}>${label}</a>`;
    });
    return s.replace(/\u0000(\d+)\u0000/g, (_, n) => keep[Number(n)]);
}
function stripInline(text) {
    return text.replace(/[`*]/g, '').replace(/<\/?kbd>/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
}
function slug(text) {
    return (stripInline(text)
        .toLowerCase()
        .replace(/[\s　]+/g, '-')
        .replace(/[^\p{L}\p{N}-]/gu, '')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '') || 'section');
}
export function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
