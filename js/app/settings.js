/** 速さの段階（%）。0.5〜2.0 倍。ゆっくり練習する側（1 倍より下）を細かく */
export const TEMPO_STEPS = [50, 60, 70, 75, 80, 90, 100, 110, 125, 150, 175, 200];
/** いちばん近い段階に合わせる（以前の 40〜130% を 5% 刻みで選べたときの値も）。ちょうど中間なら遅いほうに */
export function snapTempo(v) {
    return TEMPO_STEPS.reduce((best, s) => (Math.abs(s - v) < Math.abs(best - v) ? s : best), TEMPO_STEPS[0]);
}
const KEY = 'score-companion/settings/v1';
const DEFAULTS = {
    language: 'ja',
    theme: 'auto',
    pieceId: '',
    role: 'play',
    melodyLine: false,
    style: 'follow',
    tempo: 80,
    metronome: false,
    countIn: true,
    repeat: 'off',
    inputId: 'all',
    outputId: null,
    sound: 'auto',
    monitor: false,
    accompVol: 90,
    accompVoice: 'mirror',
    accompChannel: 1,
    scorePedal: true,
    playGraces: true,
    playWedges: true,
    softBoost: 'medium',
    playGlissandos: true,
    playTremolos: true,
    sourceBreaks: true,
    glissMode: 'auto',
    names: 'solfege',
    rollZoom: 6,
    audioOffset: 0,
    fullKeys: false,
    mic: false,
    micDeviceId: '',
    micSens: 55,
    octaveFree: true,
    helpOpen: false,
    scoreHeight: null,
};
export function loadSettings() {
    try {
        const raw = localStorage.getItem(KEY);
        const s = raw ? { ...DEFAULTS, ...JSON.parse(raw) } : { ...DEFAULTS };
        // 以前の「主旋律を弾く / 伴奏を弾く / 両方弾く / 個別に選ぶ」は「弾く」に（弾くパートは曲を開くたびに主旋律から）
        if (s.role !== 'listen')
            s.role = 'play';
        s.melodyLine = s.melodyLine === true;
        if (!['follow', 'tempo', 'karaoke'].includes(s.style))
            s.style = 'follow';
        s.tempo = snapTempo(Number(s.tempo) || 80);
        if (s.language !== 'en')
            s.language = 'ja';
        if (!['auto', 'light', 'dark'].includes(s.theme))
            s.theme = 'auto';
        s.audioOffset = Math.max(0, Math.min(400, Math.round(Number(s.audioOffset) || 0)));
        if (typeof s.scoreHeight !== 'number' || !(s.scoreHeight > 0))
            s.scoreHeight = null;
        // 以前の「くり返し（オン / オフ）」は 1 曲のくり返し。プレイリストは曲の一覧の順に置き換えた
        if (!['off', 'all', 'one'].includes(s.repeat))
            s.repeat = s.repeatAll ? 'one' : 'off';
        delete s.repeatAll;
        delete s.playlist;
        delete s.playlistOn;
        return s;
    }
    catch {
        return { ...DEFAULTS };
    }
}
/** 配色を画面に当てる（auto のときは属性を外して CSS の prefers-color-scheme に任せる） */
export function applyTheme(theme) {
    if (theme === 'auto')
        delete document.documentElement.dataset.theme;
    else
        document.documentElement.dataset.theme = theme;
}
export function saveSettings(s) {
    try {
        localStorage.setItem(KEY, JSON.stringify(s));
    }
    catch {
        /* プライベートモードなど */
    }
}
