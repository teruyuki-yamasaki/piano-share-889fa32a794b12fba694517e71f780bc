import { isVirtualPort } from "../midi/devices.js";
/** ブラウザ内の MIDI ブリッジは、実際に発音できる電子ピアノとは区別する。 */
export function isBrowserMidiOutput(name) {
    return /MIDIWeb/i.test(name);
}
/** ネット接続やオンライン／オフラインの URL によらず同じ音源を選ぶ。 */
export function soundTargets(mode, port) {
    if (mode === 'synth')
        return { midi: false, synth: true };
    if (mode === 'both')
        return { midi: !!port, synth: true };
    if (mode === 'piano')
        return { midi: !!port, synth: !port };
    const physical = !!port && !isVirtualPort(port.name) && !isBrowserMidiOutput(port.name);
    return { midi: physical, synth: !physical };
}
