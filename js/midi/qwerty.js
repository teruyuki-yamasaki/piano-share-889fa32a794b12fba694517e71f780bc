import { Emitter } from "../core/emitter.js";
/**
 * MIDI 機器がないときの代わりに、パソコンのキーボードで弾けるようにする入力。
 *   白鍵: A S D F G H J K L ;   黒鍵: W E T Y U O P
 *   Z / X でオクターブ切り替え
 */
const KEYS = {
    KeyA: 0, KeyW: 1, KeyS: 2, KeyE: 3, KeyD: 4, KeyF: 5, KeyT: 6, KeyG: 7, KeyY: 8, KeyH: 9, KeyU: 10, KeyJ: 11,
    KeyK: 12, KeyO: 13, KeyL: 14, KeyP: 15, Semicolon: 16,
};
export class QwertyInput extends Emitter {
    base = 60;
    enabled = true;
    down = new Map();
    attach(target = window) {
        target.addEventListener('keydown', (e) => this.onKey(e, true));
        target.addEventListener('keyup', (e) => this.onKey(e, false));
        target.addEventListener('blur', () => this.releaseAll());
    }
    onKey(e, isDown) {
        if (!this.enabled || e.metaKey || e.ctrlKey || e.altKey)
            return;
        const el = e.target;
        if (el && isTextEntry(el))
            return;
        if (isDown && (e.code === 'KeyZ' || e.code === 'KeyX')) {
            this.base = Math.max(24, Math.min(96, this.base + (e.code === 'KeyZ' ? -12 : 12)));
            this.emit('octave', { base: this.base });
            return;
        }
        const off = KEYS[e.code];
        if (off === undefined)
            return;
        e.preventDefault();
        if (isDown) {
            if (e.repeat || this.down.has(e.code))
                return;
            const midi = this.base + off;
            this.down.set(e.code, midi);
            this.emit('note', { type: 'on', midi, velocity: 80, time: performance.now(), source: 'PC キーボード' });
        }
        else {
            const midi = this.down.get(e.code);
            if (midi === undefined)
                return;
            this.down.delete(e.code);
            this.emit('note', { type: 'off', midi, velocity: 0, time: performance.now(), source: 'PC キーボード' });
        }
    }
    releaseAll() {
        for (const midi of this.down.values()) {
            this.emit('note', { type: 'off', midi, velocity: 0, time: performance.now(), source: 'PC キーボード' });
        }
        this.down.clear();
    }
}
/** 文字入力中だけはピアノとして扱わない（スライダーやチェックボックスにフォーカスがあっても弾ける） */
function isTextEntry(el) {
    if (el.tagName === 'TEXTAREA' || el.isContentEditable)
        return true;
    if (el.tagName === 'INPUT') {
        const type = el.type;
        return !['range', 'checkbox', 'radio', 'button', 'submit', 'file', 'color'].includes(type);
    }
    return false;
}
