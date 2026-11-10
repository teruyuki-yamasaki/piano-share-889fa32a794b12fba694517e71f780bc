/**
 * 依存ライブラリなしの小さな XML パーサー。
 * ブラウザでも Node（テスト・CLI）でも同じコードで MusicXML を読めるようにするためのもの。
 */
const ENTITIES = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
function decode(s) {
    if (s.indexOf('&') < 0)
        return s;
    return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (m, e) => {
        if (e[0] === '#') {
            const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
            return Number.isFinite(code) ? String.fromCodePoint(code) : m;
        }
        return ENTITIES[e] ?? m;
    });
}
export function parseXml(src) {
    const root = { name: '#document', attrs: {}, children: [], text: '' };
    const stack = [root];
    let i = 0;
    const n = src.length;
    while (i < n) {
        const lt = src.indexOf('<', i);
        if (lt < 0)
            break;
        if (lt > i)
            stack[stack.length - 1].text += decode(src.slice(i, lt));
        if (src.startsWith('<!--', lt)) {
            const end = src.indexOf('-->', lt + 4);
            i = end < 0 ? n : end + 3;
        }
        else if (src.startsWith('<![CDATA[', lt)) {
            const end = src.indexOf(']]>', lt + 9);
            stack[stack.length - 1].text += src.slice(lt + 9, end < 0 ? n : end);
            i = end < 0 ? n : end + 3;
        }
        else if (src.startsWith('<?', lt)) {
            const end = src.indexOf('?>', lt + 2);
            i = end < 0 ? n : end + 2;
        }
        else if (src.startsWith('<!', lt)) {
            // DOCTYPE（内部サブセット [...] を含む場合あり）
            let j = lt + 2;
            let depth = 0;
            while (j < n) {
                const c = src[j];
                if (c === '[')
                    depth++;
                else if (c === ']')
                    depth--;
                else if (c === '>' && depth <= 0)
                    break;
                j++;
            }
            i = j + 1;
        }
        else if (src[lt + 1] === '/') {
            const end = src.indexOf('>', lt);
            const name = src.slice(lt + 2, end).trim();
            // 対応する開始タグまで戻る（壊れた入力にもある程度耐える）
            for (let k = stack.length - 1; k > 0; k--) {
                if (stack[k].name === name) {
                    stack.length = k;
                    break;
                }
            }
            i = end + 1;
        }
        else {
            let j = lt + 1;
            while (j < n && !/[\s/>]/.test(src[j]))
                j++;
            const el = { name: src.slice(lt + 1, j), attrs: {}, children: [], text: '' };
            // 属性
            for (;;) {
                while (j < n && /\s/.test(src[j]))
                    j++;
                if (src[j] === '>' || src[j] === '/' || j >= n)
                    break;
                let k = j;
                while (k < n && !/[\s=/>]/.test(src[k]))
                    k++;
                const an = src.slice(j, k);
                while (k < n && /\s/.test(src[k]))
                    k++;
                if (src[k] === '=') {
                    k++;
                    while (k < n && /\s/.test(src[k]))
                        k++;
                    const q = src[k];
                    if (q === '"' || q === "'") {
                        const e = src.indexOf(q, k + 1);
                        el.attrs[an] = decode(src.slice(k + 1, e));
                        k = e + 1;
                    }
                    else {
                        let e = k;
                        while (e < n && !/[\s>]/.test(src[e]))
                            e++;
                        el.attrs[an] = decode(src.slice(k, e));
                        k = e;
                    }
                }
                else {
                    el.attrs[an] = '';
                }
                j = k;
            }
            stack[stack.length - 1].children.push(el);
            if (src[j] === '/') {
                i = src.indexOf('>', j) + 1;
            }
            else {
                stack.push(el);
                i = j + 1;
            }
        }
    }
    return root;
}
export function child(el, name) {
    return el?.children.find((c) => c.name === name);
}
export function children(el, name) {
    return el ? el.children.filter((c) => c.name === name) : [];
}
export function textOf(el, name) {
    const c = child(el, name);
    return c ? c.text.trim() : undefined;
}
export function numOf(el, name) {
    const t = textOf(el, name);
    if (t === undefined || t === '')
        return undefined;
    const v = Number(t);
    return Number.isFinite(v) ? v : undefined;
}
