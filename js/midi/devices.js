import { Emitter } from "../core/emitter.js";
import { MidiSendQueue } from "./send-queue.js";
/** MIDIWeb のブリッジでは timestamp 対応に依存せず、アプリ側で送信時刻を守る。 */
export function needsMidiSendQueue(portName, userAgent = typeof navigator === 'undefined' ? '' : navigator.userAgent) {
    return /MIDIWeb/i.test(portName) || /MIDIWeb/i.test(userAgent);
}
/**
 * IAC Driver（Mac の仮想 MIDI バス）やネットワーク MIDI などの仮想ポートか。
 * 仮想ポートに伴奏を送っても、それを受け取るアプリがなければ音は鳴らない。
 */
export function isVirtualPort(name) {
    return /IAC|Network|ネットワーク|Session|loopMIDI|Virtual|仮想/i.test(name);
}
/**
 * Web MIDI API のラッパー。
 * - 機器の抜き差しを検知して一覧を更新
 * - 入力は選択中のポート（'all' なら全ポート）からノートオン/オフだけを取り出して通知
 * - 出力は NoteOutput として伴奏の送り先に使える
 */
export class MidiHub extends Emitter {
    access = null;
    inputId = 'all';
    outputId = null;
    /** 伴奏を送る MIDI チャンネル（0 始まり。0 = チャンネル 1） */
    channel = 0;
    /** 入力機器から届いたバンクセレクト（チャンネルごと） */
    banks = new Map();
    sendQueue = new MidiSendQueue();
    supported = typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator;
    async init() {
        if (!this.supported)
            throw new Error('このブラウザは Web MIDI に対応していません。Google Chrome か Microsoft Edge で開いてください。');
        this.access = await navigator.requestMIDIAccess({ sysex: false });
        this.access.onstatechange = () => this.refresh();
        this.refresh();
    }
    get inputs() {
        return this.access ? [...this.access.inputs.values()].filter((p) => p.state !== 'disconnected').map(info) : [];
    }
    get outputs() {
        return this.access ? [...this.access.outputs.values()].filter((p) => p.state !== 'disconnected').map(info) : [];
    }
    selectInput(id) {
        this.inputId = id;
        this.bindInputs();
    }
    selectOutput(id) {
        if (this.outputId && this.outputId !== id)
            this.allNotesOff();
        this.outputId = id;
    }
    /** 入力機器と同じ名前の出力があれば返す（電子ピアノは入出力が同名のことが多い） */
    guessOutputFor(inputId) {
        const inp = this.inputs.find((p) => p.id === inputId);
        if (!inp)
            return null;
        return this.outputs.find((o) => o.name === inp.name)?.id ?? null;
    }
    /**
     * 伴奏を送る出力を自動で選ぶ。入力機器と同じ名前の出力（電子ピアノ本体）を優先し、仮想ポートは選ばない。
     * preferredSource: 実際に弾かれた入力機器の名前（あればそれを最優先）
     */
    autoOutput(preferredSource = '') {
        if (this.inputId !== 'all' && this.inputId !== 'none') {
            const out = this.guessOutputFor(this.inputId);
            const name = this.outputs.find((o) => o.id === out)?.name ?? '';
            return out && !isVirtualPort(name) ? out : null;
        }
        const inputs = [...this.inputs].sort((a, b) => Number(b.name === preferredSource) - Number(a.name === preferredSource));
        for (const inp of inputs) {
            if (isVirtualPort(inp.name))
                continue;
            const out = this.guessOutputFor(inp.id);
            if (out)
                return out;
        }
        return this.outputs.find((o) => !isVirtualPort(o.name))?.id ?? null;
    }
    refresh() {
        this.bindInputs();
        if (this.outputId && !this.outputs.some((o) => o.id === this.outputId)) {
            this.sendQueue.clear();
            this.outputId = null;
        }
        this.emit('devices', { inputs: this.inputs, outputs: this.outputs });
    }
    bindInputs() {
        if (!this.access)
            return;
        for (const port of this.access.inputs.values()) {
            const active = this.inputId === 'all' || port.id === this.inputId;
            port.onmidimessage = active ? (e) => this.handle(e, port.name ?? '') : null;
        }
    }
    handle(e, source) {
        const d = e.data;
        if (!d || d.length < 2)
            return;
        const kind = d[0] & 0xf0;
        const time = e.timeStamp || performance.now();
        if (kind === 0x90 && d[2] > 0)
            this.emit('note', { type: 'on', midi: d[1], velocity: d[2], time, source });
        else if (kind === 0x80 || (kind === 0x90 && d[2] === 0))
            this.emit('note', { type: 'off', midi: d[1], velocity: 0, time, source });
        else if (kind === 0xb0 && d[1] === 64)
            this.emit('pedal', { down: d[2] >= 64 });
        else if (kind === 0xb0 && (d[1] === 0 || d[1] === 32)) {
            const ch = d[0] & 0x0f;
            const b = this.banks.get(ch) ?? { msb: 0, lsb: 0 };
            if (d[1] === 0)
                b.msb = d[2];
            else
                b.lsb = d[2];
            this.banks.set(ch, b);
        }
        else if (kind === 0xc0) {
            const b = this.banks.get(d[0] & 0x0f) ?? { msb: 0, lsb: 0 };
            this.emit('program', { program: d[1], bankMsb: b.msb, bankLsb: b.lsb, source });
        }
    }
    get port() {
        return this.outputId ? this.access?.outputs.get(this.outputId) : undefined;
    }
    send(data, time) {
        const port = this.port;
        if (!port)
            return;
        if (needsMidiSendQueue(port.name ?? '')) {
            const message = [...data];
            this.sendQueue.enqueue(time ?? performance.now(), () => {
                try {
                    // ブリッジへは期日になってから即時送信する。
                    port.send(message);
                }
                catch {
                    /* 予約後に抜かれた場合 */
                }
            });
            return;
        }
        try {
            port.send(data, time);
        }
        catch {
            /* 抜かれた直後など */
        }
    }
    allNotesOff() {
        this.sendQueue.clear();
        const port = this.port;
        if (!port)
            return;
        try {
            port.clear?.();
        }
        catch {
            /* 未実装のブラウザ */
        }
        this.send([0xb0 | this.channel, 64, 0]);
        this.send([0xb0 | this.channel, 123, 0]);
    }
    /** 伴奏のチャンネルの音色を指定する */
    sendProgram(p) {
        this.send([0xb0 | this.channel, 0, p.bankMsb]);
        this.send([0xb0 | this.channel, 32, p.bankLsb]);
        this.send([0xc0 | this.channel, p.program]);
    }
    /** 伴奏の送り先として使う NoteOutput（channel で指定したチャンネル） */
    output = {
        noteOn: (midi, velocity, time) => this.send([0x90 | this.channel, midi, velocity], time),
        noteOff: (midi, time) => this.send([0x80 | this.channel, midi, 0], time),
        pedal: (down, time) => this.send([0xb0 | this.channel, 64, down ? 127 : 0], time),
        allNotesOff: () => this.allNotesOff(),
    };
}
function info(p) {
    return { id: p.id, name: p.name ?? '不明な機器', manufacturer: p.manufacturer ?? '' };
}
