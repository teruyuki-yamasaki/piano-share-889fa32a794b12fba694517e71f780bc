export class MultiOutput {
    outputs;
    constructor(outputs = []) {
        this.outputs = outputs;
    }
    noteOn(midi, velocity, time) {
        for (const o of this.outputs)
            o.noteOn(midi, velocity, time);
    }
    noteOff(midi, time) {
        for (const o of this.outputs)
            o.noteOff(midi, time);
    }
    pedal(down, time) {
        for (const o of this.outputs)
            o.pedal?.(down, time);
    }
    allNotesOff() {
        for (const o of this.outputs)
            o.allNotesOff();
    }
    get latencyMs() {
        return Math.max(0, ...this.outputs.map((o) => o.latencyMs ?? 0));
    }
}
export const silentOutput = {
    noteOn() { },
    noteOff() { },
    allNotesOff() { },
    click() { },
};
