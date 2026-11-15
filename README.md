# TagAlong

Teachers point at the board and say "this cancels with that". A blind student hears only "this" and "that". They don't know what was pointed at.

TagAlong fixes that. A camera watches the board and the teacher's hand. When the teacher says "this" or "that", the student hears the exact term in their earbud, for example *"the x plus 3 on top"*.

## How it works

1. **Reading the board.** When new writing appears and the board stays still for a second, Claude reads it and returns each term with its position. Boxes appear one by one as they are read.
2. **Pointing.** The camera tracks the teacher's finger, a pointer stick or a laser dot, in the browser.
3. **Listening.** Speech recognition picks up "this", "that", "these" and "those". Words like "top", "bottom" or "whole equation" pick a bigger part of the board.
4. **Whispering.** The pointed term is spoken to the student. The voice comes from the left or right, depending on where the term is on the board. If the teacher says "this" without pointing, nothing plays.

No AI runs while the teacher is pointing, so the whisper comes right away. AI is only used to read the board when it changes.

## In a classroom

One camera device sits at the front. Every blind student listens on their own phone.

1. On the camera device, enter the course name (for example `math201`) and press **Open class**.
2. Students scan the QR code or open the student link once, and can add it to their Home Screen. The link stays the same for that course.
3. The student taps **Start listening**. Whispers play on their phone. **Repeat** and **What's on the board?** work on the phone too.
4. **Close class** ends it for everyone.

The phones only listen; nothing is sent back to the teacher. Each phrase is voiced once on the server and shared, so ten students cost the same as one.

## Run it

You need Node 22.12 or newer and a Chromium-based browser with a camera and microphone.

```bash
npm install
cp .env.example .env   # add the keys you have
npm start              # opens at http://127.0.0.1:8787/
```

To try it without a camera or any keys, open `http://127.0.0.1:8787/?demo=1`. Move the mouse over the board photo and press `P` to point.

### Keys (in `.env`, server only)

| Key | What it turns on |
|---|---|
| `ANTHROPIC_API_KEY` | Reading the board with Claude, and class notes |
| `ELEVENLABS_API_KEY` | The natural whisper voice |
| `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | Amazon Transcribe speech recognition and the Polly backup voice |
| `ACCESS_KEY` | Required when hosted publicly. Open the app once with `?key=<ACCESS_KEY>` |

With no keys, the app falls back to the browser's own voice and speech recognition. See [.env.example](.env.example) for the optional settings.

### Keyboard (camera device)

| Key | Action |
|---|---|
| `P` | Point (acts as if the teacher said "this") |
| `F` | Freeze the boxes on the board |
| `W` | Switch between with and without the app |
| `Y` / `N` | Mark the last whisper right or wrong |

### Development

| Command | What it does |
|---|---|
| `npm run dev` + `npm run server` | Dev server at `http://localhost:5173/`, with live reload |
| `npm test` | Tests |
| `npx tsc --noEmit` | Type check |

## Privacy

The camera image is sent to the board reader only when the board changes, and never while a hand is in view. Nothing is stored. Keys stay on the server.
