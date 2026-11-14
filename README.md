# THIS & THAT

A teacher points at a whiteboard and says "this"; the app whispers the pointed term to a blind student.

## Requirements

- Node 22.12 or newer
- A webcam and microphone, and a modern Chromium-based browser
- Optional: an Anthropic API key or AWS credentials (see below). Without them the app still runs on the saved demo board and the browser voice.

## Setup

```bash
npm install
cp .env.example .env    # then fill in the values you have
```

### `.env` keys (server only, never sent to the browser)

| Key | Purpose |
|---|---|
| `AWS_REGION` | Enables Polly voice and Transcribe speech (for example `us-east-1`) |
| `AWS_ACCESS_KEY_ID` | AWS credentials |
| `AWS_SECRET_ACCESS_KEY` | AWS credentials |
| `MODEL_PROVIDER` | Optional `bedrock` or `anthropic`. `bedrock` forces Bedrock for the board and notes. Default: Anthropic if `ANTHROPIC_API_KEY` is set, else Bedrock |
| `BOARD_MODEL_ID` | Bedrock vision model or inference profile that reads the board |
| `NOTES_MODEL_ID` | Optional Bedrock model for notes (default `us.amazon.nova-micro-v1:0`) |
| `TRANSCRIBE_VOCABULARY` | Optional name of an existing Transcribe custom vocabulary (see below) |
| `NOTES_BUCKET` | Optional existing S3 bucket. Enables the "Copy share link" button (24 hour link, `notes/<uuid>.txt`) |
| `ANTHROPIC_API_KEY` | Optional. If set, the board is read through the Anthropic API instead of Bedrock, and notes are enabled |
| `ANTHROPIC_MODEL_ID` | Optional model override for board reads |
| `ANTHROPIC_NOTES_MODEL_ID` | Optional model override for notes |
| `POLLY_VOICE`, `POLLY_ENGINE` | Optional Polly voice and engine (`generative` or `neural`) |

The presigned share URL contains your AWS access key ID (not the secret). Use a dedicated IAM user's static keys, not root or temporary credentials: temporary credentials make the link expire early.

`GET /api/health` also reports `share` and `provider` (which provider serves the board and notes). It reports which of these are present (never their values), and the app shows a dismissible strip at the top when something is missing.

### AWS check and Transcribe vocabulary

`npm run aws:check` makes tiny calls to STS, Polly, Bedrock (board and notes models) and Transcribe, then prints a table with the next step for each failure. It always exits 0. The app never creates AWS resources; create the vocabulary once yourself:

```
aws transcribe create-vocabulary --vocabulary-name this-and-that-math --language-code en-US \
  --phrases this that cancels squared cubed numerator denominator fraction over plus minus times equals x y
```

(The same words are in `scripts/math-vocabulary.txt`.) Wait until `aws transcribe get-vocabulary --vocabulary-name this-and-that-math` says `READY`, then set `TRANSCRIBE_VOCABULARY=this-and-that-math`.

## Run

| Command | What it does |
|---|---|
| `npm start` | One command: builds the frontend, then serves it and the API from one process at `http://127.0.0.1:8787/` |
| `npm run dev` | Vite dev server on `http://localhost:5173/` (proxies `/api` and `/ws` to the server) |
| `npm run server` | API server with reload on `127.0.0.1:8787`. Run alongside `npm run dev` |
| `npm test` | Test suite |
| `npx tsc --noEmit` | Type check |
| `npm run demo:check` | Scripted check against a running dev server |

URL options:

- `?demo=1` loads the saved board and opens the transcript panel. No camera board reads or AWS needed.
- `?fixture=1` loads the saved board only.
- `?mirror=1` mirrors the camera preview (off by default, because the camera faces the board).

## Keyboard

| Key | Action |
|---|---|
| `P` | Point |
| `Y` | Mark the newest resolution correct |
| `N` | Mark the newest resolution wrong |
| `W` | Toggle "with / without app" |

## Demo script

1. Say: "A blind student hears 'this' and 'that' and nothing else."
2. The judge puts in one earbud and closes their eyes. Play it without the app first (press `W`).
3. App on. A teammate writes a fraction, points, and says "this cancels with that". The judge hears the terms.
4. The teammate says "so this is my favorite part" with no pointing. Nothing plays: the gate is working.
5. The judge opens their eyes. The screen shows boxes, the fingertip, the resolved words, and a measured number (for example "correct term 46 of 50").
6. Ask "what's on the board?": every term is whispered in reading order.
7. Show the student view on the second screen. Click "Open student view": it opens in its own window. Keep the judge window visible, because a hidden window stops hand tracking.
8. Show the Notes (Said vs Meant) and the professor report card.
9. Close: "Past work needed gloves and raised prints. Ours needs a camera and a browser."

## Troubleshooting

- **Camera denied**: allow camera access for the page in the browser's site settings, then reload. Use `?demo=1` to run without a camera board.
- **Microphone denied**: allow microphone access and reload. Without it there is no speech, so pointing alone will not trigger a whisper.
- **Transcribe not subscribed or not configured**: the app falls back to the browser's Web Speech recognition automatically. The status line shows which one is active.
- **Voice sounds robotic**: Polly is not configured, so the browser voice is in use. Set `AWS_REGION` and credentials.
- **Board never reads**: set `BOARD_MODEL_ID` (Bedrock) or `ANTHROPIC_API_KEY`. Otherwise only the saved demo board is available.
- **Student view shows "nothing in reach" every time**: the judge window is minimised or covered, so tracking paused. Keep it visible.
- **Port 8787 in use**: stop the other server; the port is fixed.

## Privacy

Camera frames are sent to the board reader only when the board changes (never while a hand is in frame). Nothing is stored. Keys stay on the server, and the server listens on `127.0.0.1` only.
