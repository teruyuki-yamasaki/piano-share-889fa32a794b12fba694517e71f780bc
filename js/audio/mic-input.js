import { Emitter } from "../core/emitter.js";
import { detectPitch, hzToMidi, PitchNoteTracker } from "./pitch.js";
const FFT_SIZE = 2048;
const HOP_MS = 20;
/**
 * マイクからの音（歌声・アコースティック楽器）を MIDI と同じノートイベントに変換する入力。
 * 伴奏をスピーカーで鳴らすと、その音もマイクが拾うので、ヘッドホンか電子ピアノからの出力を推奨。
 */
export class MicInput extends Emitter {
    supported = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
    tracker = new PitchNoteTracker();
    active = false;
    /** 検出の遅れを補う量（ミリ秒）。ノートの時刻をこの分だけ前にずらす */
    latencyMs = 0;
    ctx = null;
    stream = null;
    analyser = null;
    buf = new Float32Array(FFT_SIZE);
    timer = null;
    /** 感度（0..100）。大きいほど小さな音にも反応する */
    setSensitivity(v) {
        this.tracker.minRms = 0.03 * 10 ** (-v / 40);
    }
    async start(deviceId) {
        if (!this.supported)
            throw new Error('mic-unsupported');
        this.stop();
        this.stream = await navigator.mediaDevices.getUserMedia({
            audio: {
                deviceId: deviceId ? { exact: deviceId } : undefined,
                // 音楽の音色・音量をそのまま使いたいので、通話向けの加工はすべて切る
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false,
            },
        });
        this.ctx = new AudioContext({ latencyHint: 'interactive' });
        // ユーザー操作の前だと再開できないことがある。その場合は resume() を操作時に呼んでもらう
        this.resume();
        const src = this.ctx.createMediaStreamSource(this.stream);
        this.analyser = this.ctx.createAnalyser();
        this.analyser.fftSize = FFT_SIZE;
        src.connect(this.analyser);
        // 分析窓の中心は窓の長さの半分だけ過去にある。入力系の遅れも足す
        this.latencyMs = (FFT_SIZE / this.ctx.sampleRate) * 500 + (this.ctx.baseLatency ?? 0) * 1000 + 10;
        this.active = true;
        this.timer = setInterval(() => this.process(), HOP_MS);
    }
    resume() {
        if (this.ctx && this.ctx.state === 'suspended')
            void this.ctx.resume();
    }
    stop() {
        if (this.timer)
            clearInterval(this.timer);
        this.timer = null;
        for (const e of this.tracker.reset(performance.now()))
            this.emitNote(e.type, e.midi, e.time, 0, 0);
        this.stream?.getTracks().forEach((t) => t.stop());
        this.stream = null;
        void this.ctx?.close();
        this.ctx = null;
        this.analyser = null;
        this.active = false;
    }
    static async devices() {
        if (!navigator.mediaDevices?.enumerateDevices)
            return [];
        const list = await navigator.mediaDevices.enumerateDevices();
        return list.filter((d) => d.kind === 'audioinput' && d.deviceId).map((d) => ({ id: d.deviceId, name: d.label }));
    }
    process() {
        if (!this.analyser || !this.ctx)
            return;
        this.analyser.getFloatTimeDomainData(this.buf);
        const now = performance.now();
        const frame = detectPitch(this.buf, this.ctx.sampleRate);
        const voiced = frame.hz !== null && frame.clarity >= this.tracker.minClarity && frame.rms >= this.tracker.minRms;
        this.emit('level', { rms: frame.rms, midi: voiced ? Math.round(hzToMidi(frame.hz)) : null });
        for (const e of this.tracker.push(frame, now))
            this.emitNote(e.type, e.midi, e.time - this.latencyMs, e.velocity, e.cents);
    }
    emitNote(type, midi, time, velocity, cents) {
        this.emit('note', { type, midi, velocity, time, source: 'mic', cents });
    }
}
