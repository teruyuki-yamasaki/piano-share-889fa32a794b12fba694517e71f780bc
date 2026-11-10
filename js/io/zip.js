/**
 * 圧縮 MusicXML (.mxl) を開くための最小 ZIP リーダー。
 * 展開には標準の DecompressionStream('deflate-raw') を使う（Chrome / Node 18+ で利用可）。
 */
export function isZip(bytes) {
    return bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}
export function readZip(bytes) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    // End of central directory を後ろから探す
    let eocd = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
        if (dv.getUint32(i, true) === 0x06054b50) {
            eocd = i;
            break;
        }
    }
    if (eocd < 0)
        throw new Error('ZIP ファイルとして読めませんでした');
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const entries = [];
    const td = new TextDecoder();
    for (let k = 0; k < count; k++) {
        if (dv.getUint32(p, true) !== 0x02014b50)
            break;
        const method = dv.getUint16(p + 10, true);
        const compSize = dv.getUint32(p + 20, true);
        const nameLen = dv.getUint16(p + 28, true);
        const extraLen = dv.getUint16(p + 30, true);
        const commentLen = dv.getUint16(p + 32, true);
        const localOffset = dv.getUint32(p + 42, true);
        const name = td.decode(bytes.subarray(p + 46, p + 46 + nameLen));
        p += 46 + nameLen + extraLen + commentLen;
        entries.push({
            name,
            async read() {
                const lNameLen = dv.getUint16(localOffset + 26, true);
                const lExtraLen = dv.getUint16(localOffset + 28, true);
                const start = localOffset + 30 + lNameLen + lExtraLen;
                const data = bytes.subarray(start, start + compSize);
                if (method === 0)
                    return data.slice();
                if (method !== 8)
                    throw new Error(`未対応の圧縮形式です (method=${method})`);
                const ds = new DecompressionStream('deflate-raw');
                const stream = new Blob([data]).stream().pipeThrough(ds);
                return new Uint8Array(await new Response(stream).arrayBuffer());
            },
        });
    }
    return entries;
}
