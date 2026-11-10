# Score Companion User Guide

Play (or sing) the melody yourself, and the accompaniment follows you.

## FAQ: I want to play the right hand and hear the left-hand accompaniment

Choose **“Play”** in the practice bar (it is the default).

- The right hand (melody) is your part; the left hand (accompaniment) is played **automatically** and follows you
- Check the part tags in the practice bar: “Right hand **You**” and “Left hand **Auto**”
- Click a tag to switch that part between “You” and “Auto” (left hand only, both hands, and so on)
- In a piano duet, the tags are grouped by player (Secondo, Primo). The player tag switches both hands at once, a hand tag switches one hand (Primo’s two hands are yours at first)
- **“Listen”** makes every part Auto. Going back to “Play” restores the parts you had chosen
- Accompaniment output and volume: click the device name in the top bar → **Accompaniment output / Accompaniment volume**

| I want to… | Choose |
|---|---|
| Play the right hand, hear the left hand | Play (the default) |
| Play the left hand, hear the melody | Play → set Right hand to Auto, Left hand to You |
| Play both hands myself (nothing is auto-played) | Play → set both hands to You |
| Just listen to everything | Listen |

## Starting and quitting

1. Double-click `start.command` (or run `npm start` in a terminal)
2. Google Chrome opens http://localhost:5173
3. To quit, press <kbd>Ctrl</kbd>+<kbd>C</kbd> in the terminal window (or close it)

> <kbd>Ctrl</kbd>+<kbd>Z</kbd> only *suspends* the server and blocks the next launch. If that happens, just open `start.command` again: it cleans up the stuck server automatically.

## The screen

- **Top bar**: piece (also adding to and deleting from My library), playback (previous, play, next, repeat), speed, MIDI device (click for device and sound settings), note names, keyboard range, theme, language, guide (this page)
- **Practice bar**: Play / Listen, progression (Wait for me, Keep tempo, Score), You / Auto for each part, microphone, metronome, count-in, loop
- **Score**: the red cursor shows where you are; the next notes light up. Click a measure to jump there
- **Piano roll and keyboard**: play when a falling bar reaches the red line. Bar length = how long to hold
- **Border between the score and the piano roll**: drag it up or down to change the height of the score area (the score shrinks to fit). Double-click to go back to the automatic height
- **Status bar**: measure number, notes played and mistakes

## Accompaniment voice and pedal

**Voice**: device name in the top bar → “Accompaniment voice”

- **Same as my playing** (default): when you select a voice on the digital piano, the accompaniment switches to it. The app reuses the voice information the piano sends when you press its voice buttons. A voice selected before the page was opened is unknown, so select it again on the piano
- **Piano / Electric piano / Harpsichord / Organ / Strings / Choir**: a different voice for the accompaniment only. It is requested by General MIDI program number, so some pianos pick a similar but different sound
- If choosing an accompaniment voice also changes the sound of your own keys, set “MIDI channel for accompaniment” to **2**
- When playing through the computer, the app's built-in voices (six) are used

**Pedal**: if the score has pedal markings (MusicXML Ped. marks, or pedal data in a MIDI file), the accompaniment uses the sustain pedal as marked

- In “Wait for me”, the pedal stays down while waiting and changes the moment you play
- The two included pieces have no pedal markings (they are played without pedal)
- Your own pedal works directly on the digital piano's sound
- Turn it off with “Use the sustain pedal in the accompaniment as marked in the score”

## Progression (three modes)

| Mode | Behavior | Good for |
|---|---|---|
| Wait for me | The piece (and accompaniment) waits until you play the next note | Reading a new piece |
| Keep tempo | The piece keeps going; notes you skip are counted as missed | Run-throughs |
| Score | Keeps tempo and scores every note, then saves the result | Checking progress, karaoke |

In “Wait for me”, you don't need to press Play: playing the first highlighted note starts the piece.

## Score mode (karaoke)

1. Choose **Score** under progression
2. Press Play (or Space). There is always a one-measure count-in
3. The result appears at the end. If a loop range is set, that range is scored once

**Grades** (for each of your notes)

| Grade | Timing deviation |
|---|---|
| Perfect | within 50 ms |
| Great | within 100 ms |
| Good | within 200 ms |
| Miss | not played |

- The score is out of 100. It also considers **note length** (did you hold the written length?) and, with the microphone, **pitch deviation** in cents
- Wrong notes cost a few points
- The result shows whether you rush or drag, how each measure went, and your history for the piece (best and last 5 runs)
- History is stored in this browser (per piece, up to 20 runs)

## Microphone input (voice / acoustic instruments)

No digital piano? You can **sing**, or play a **recorder, violin, flute, acoustic piano** and so on.

1. Press **Mic** in the practice bar (allow microphone access the first time). The input level and the detected note show inside the button
2. Sing / play the highlighted note. The note heard is shown on the keyboard
3. If it doesn't react, raise **Microphone sensitivity** in the settings (device name in the top bar). Lower it if it reacts to noise

- It hears **one note at a time (a melody)**. For chord parts, any one note of the chord counts
- **Accept notes in another octave** (on by default): singing an octave lower or higher than written counts as correct
- Accompaniment played through computer speakers can leak into the mic. **Headphones** or the digital piano output are recommended (notes that match the sounding accompaniment are not counted as mistakes)
- The app compensates for the small delay of pitch detection

## Playing with the computer keyboard

| Keys | Notes |
|---|---|
| <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd> <kbd>F</kbd> <kbd>G</kbd> <kbd>H</kbd> <kbd>J</kbd> <kbd>K</kbd> | White keys (C to C) |
| <kbd>W</kbd> <kbd>E</kbd> <kbd>T</kbd> <kbd>Y</kbd> <kbd>U</kbd> | Black keys |
| <kbd>Z</kbd> / <kbd>X</kbd> | Octave down / up |

## Shortcuts

| Action | Key |
|---|---|
| Play / pause | <kbd>Space</kbd> |
| From the beginning | <kbd>Home</kbd> |
| Previous / next measure | <kbd>←</kbd> / <kbd>→</kbd> |
| Previous / next piece (in the piece list) | <kbd>Shift</kbd> + <kbd>←</kbd> / <kbd>→</kbd> |
| Open / close this guide | <kbd>?</kbd> |

## Speed, metronome, loop

- **Speed**: choose a step from 0.5× to 2.0×. Hover to see the actual tempo (♩=)
- **Metronome**: a click on every beat
- **Count-in**: one measure of clicks before playing (always on in Score mode)
- **Loop**: tick it and choose the start and end measures. Clicking a measure in the score sets the start
- **Repeat** (⟳ next to the play button): each click switches between off (grey) → all → one (with a “1” badge)
  - **All**: when a piece ends, go on to the next piece in the piece list (the order in the piece menu at the top); after the last piece, start again from the first
  - **One**: start the piece over from the beginning after the last measure
- **Previous / next piece**: ⏮ / ⏭ around the play button go to the previous / next piece in the list (⏮ goes back to the start of the piece if you are partway in, or to the previous piece if you are at the start)
- **Note names**: “Do Re Mi / C D E / No names” in the top bar switches the labels on the keys and falling notes
- **Keyboard**: “Fit to piece” shows only the range the piece uses, with larger keys (easier); “88 keys” shows the whole piano

## Using your own scores

Drag and drop a file onto the window. To keep a score, add it with “+ Add scores…” at the end of the piece menu.

| Format | Notes |
|---|---|
| MusicXML (.musicxml / .xml / .mxl) | Most accurate. Opens immediately |
| MIDI (.mid) | Opens immediately. Single-track files are split automatically: the top note becomes the melody |

### My library

Open the piece menu and choose **“+ Add scores…”** at the end to add MusicXML and MIDI files so they stay in the piece list. While a My library piece is open, **“− Delete “title””** in the same place removes it.

- Add many from the terminal: `npm run add -- score1.musicxml score2.mxl`
- PDF files cannot be opened directly. Convert them to MusicXML with a score recognition tool (such as score-omr) first

## Settings (click the device name in the top bar)

| Setting | What it does |
|---|---|
| Input (keyboard) | Which MIDI device you play |
| Accompaniment output | Digital piano / this computer / both |
| MIDI output | The MIDI device that receives the accompaniment |
| Also play my performance through this computer | For MIDI keyboards without built-in sounds |
| Accompaniment volume | Volume of the accompaniment only |
| Accompaniment voice | Same as my playing / Piano / Electric piano / Harpsichord / Organ / Strings / Choir |
| MIDI channel for accompaniment | Normally 1. Use 2 for a different accompaniment voice |
| Use the sustain pedal… as marked in the score | For scores with pedal markings |
| Note names | Do Re Mi / C D E / hidden |
| Note fall speed, show all 88 keys | Display options |
| Microphone input | On/off, which microphone, sensitivity, accept other octaves |

## Troubleshooting

- **It won't start / the page doesn't open**: close the terminal and open `start.command` again. A stuck old server is cleaned up automatically. If port 5173 is used by another app, the server starts on 5174 or later (the URL is printed in the terminal)
- **The digital piano isn't detected**: make sure you are using Chrome and that MIDI is “Allowed” under the lock icon in the address bar. Re-plugging the cable is detected automatically
- **The accompaniment voice doesn't change**: with “Same as my playing”, select the voice again on the digital piano. If it still doesn't change, pick the accompaniment voice directly
- **No accompaniment sound**: set “Accompaniment output” to “Play through this computer” to test. Some browsers need one click on the page before they make sound
- **The microphone doesn't react**: check that the Mic button is lit and the input level moves in the settings. Raise the sensitivity or move closer to the mic
- **The microphone reacts to the accompaniment or noise**: use headphones or lower the sensitivity
