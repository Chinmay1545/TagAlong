# Handoff to Person 2: Pointing (finger, stick or laser)

Person 1 has finished the speed lane. This document covers what changed, how it affects your tasks (2.1 to 2.7 in the team plan), and the rules your coding agent must follow. Give the whole file to your agent at the start of each session.

---

## 1. Where the code is

| What | Where |
|---|---|
| Speed-lane work | Branch `feat/team-plan` on `Chinmay1545/TagAlong`, 11 commits ahead of `main` |
| PR | Not opened yet. Open it from `https://github.com/Chinmay1545/TagAlong/pull/new/feat/team-plan` |
| Teammate's hosting PR | PR #1, branch `feat/railway-deploy`. It changes `server/index.ts`, `server/transcribe.ts`, `package.json`, `.env.example` |
| Test baseline | 414 tests passing; `npx tsc --noEmit` clean; `npm run build` passing |

**Start your branch from `feat/team-plan`, not `main`.** Most of the files you will touch (`src/live/live.ts`, `src/ui/JudgeScreen.tsx`, `src/core/config.ts`) changed on that branch. Branching from `main` means a painful merge later.

```bash
git fetch origin
git switch -c feat/pointing origin/feat/team-plan
npm install
npm test && npx tsc --noEmit && npm run build   # confirm 414 green before you change anything
```

If `feat/team-plan` gets merged into `main` while you work, run `git rebase origin/main`. Your commits sit on top and nothing should conflict.

---

## 2. What changed in the speed lane

### Results (measured on real board photos with a real key)

| | Before | After |
|---|---|---|
| Model read, first box drawn | ~5.7 s | ~2 s through the server (~1 s direct to the model) |
| Professor steps back → box appears | 7 to 8 s | about 3.5 to 4.5 s |

### Changes, file by file

| File | Change | Touches your lane? |
|---|---|---|
| `server/anthropic.ts`, `server/prompt.ts`, `server/parseBoard.ts`, `server/boardStream.ts`, `server/readBoard.ts`, `server/bedrock.ts` | The board read streams terms one at a time. The model writes `latex\|x\|y\|w\|h` lines, at low effort in fast mode | No. Leave `server/` alone |
| `src/core/phrase.ts` (new) | The spoken phrase ("x squared on top left") is built from the LaTeX plus box position, no longer by the model | No |
| `src/core/mergeTerms.ts` (new) | A re-read keeps existing terms (same LaTeX, centre moved < 0.06) with their old id and box; only new terms get new ids | **Yes, see §3.2** |
| `src/core/frameDiff.ts` | New `changedRegion(a, b)`: bounding box of the 64x36 cells whose brightness moved more than 24 | **Yes, see §3.1** |
| `src/board/boardLoop.ts` | Checks every 1 s; waits for the picture to be still for 1 s before reading; draws boxes as they stream; new `pendingRegion()` | **Yes, see §3.1** |
| `src/board/boardClient.ts` | `readBoard(blob, onTerm?)` streams NDJSON and calls `onTerm` per term | No |
| `src/board/mode.ts` (new) | Demo mode vs live mode. Demo (`?demo=1` or `?fixture=1`) shows the saved photo with its boxes; the **mouse** is a pointer there | **Yes, see §3.4** |
| `src/live/live.ts` | "No silence after writing": a `this`/`that`/`here` with no box under it, aimed at ink not read yet, is **held** and whispered when the box arrives (gives up after 8 s). New `checkHeld()` | **Yes, see §3.3** |
| `src/transcript/store.ts` | `addResolution()` now returns `true` when a late (held) word joined an earlier sentence | Minor |
| `src/ui/JudgeScreen.tsx`, `src/ui/judge.css` | Demo photo layer, DEMO/LIVE tag, mouse pointing in demo mode, `checkHeld()` called on every term change and once a second | **Yes, see §3.4** |
| `src/core/config.ts` | See the table below | **Yes** |
| `scripts/bench-board.mjs` (new) | Times board reads: `node scripts/bench-board.mjs <folder of jpgs> --runs 2` against a running server | Optional |

### New and changed constants (`src/core/config.ts`)

| Constant | Value | Meaning |
|---|---|---|
| `BOARD_INTERVAL_MS` | 1000 (was 3000) | How often the board is checked for change |
| `SETTLE_MS` | 1000 (new) | The picture must be still this long before a read starts |
| `HOLD_MAX_MS` | 8000 (new) | How long a held "this" waits for its box |
| `MATCH_DIST` | 0.06 (new) | Distance under which a re-read term counts as the same term. **Separate from `MAX_DIST`**, which is the pointer reach; don't merge them |
| `MAX_DIST`, `TIP_WINDOW_MS`, `TIP_BUFFER_MS`, `HAND_RECENT_MS`, `POINTER_WORDS` | unchanged | |

`src/core/types.ts` is unchanged and still **frozen**. `src/core/resolver.ts`, `src/core/tipBuffer.ts` and `src/vision/handTracker.ts` were **not** changed, so they are yours to edit.

---

## 3. How this affects your tasks

### 3.1 Laser and stick vs the board loop (affects 2.1, 2.3, 2.4): the most important point

The board loop now depends on two signals that a laser or stick will disturb.

1. **"A hand is in view" blocks reads.** `shouldReadBoard()` skips a read while `tips.lastAt()` is within `HAND_RECENT_MS` (300 ms). It assumes every point in the `TipBuffer` is a hand blocking the board. If you push **laser** points into the same buffer, a laser held on the board **stops all board reads** for as long as it is on.
   - What to do: only things that physically cover the board (finger/hand, stick) should block reads; a laser must not. Either keep a separate "occluder last seen" signal, or give `TipBuffer` a kind and have `boardLoop` look at hand/stick only. Add a test: "laser on the board does not block a read".
2. **Frame changes drive "settle" and "pending".**
   - **Settle:** every 1 s the loop compares the frame with the previous one, and any change resets the stillness count. A read only starts after `SETTLE_MS` of stillness.
   - **Pending:** `pendingRegion()` returns the box of changed cells (`changedRegion`, per-cell threshold 24 on a 64x36 grid) that have not been read yet.
   - A bright laser dot can easily push one cell past 24, so the dot itself becomes a "pending region". Then a "this" said with the laser on a spot with no box is **held for up to 8 s** instead of going silent. A moving dot or stick can also keep the board from ever settling.
   - What to do: mask the detected laser dot (a few cells around it) and the stick out of the frame passed to `toGraySmall`/`changedRegion`, or ignore pending regions smaller than about 2x2 cells. Write tests for both: "a laser dot alone does not create a pending region" and "a moving laser does not prevent settle".

### 3.2 Bracket bug (2.2)

- Put the "smallest box that contains the pointer" fix **inside `termAt()`** in `src/core/resolver.ts`. Both `resolvePointer()` and the new `live.checkHeld()` call `termAt()`, so one fix covers both. A fix only inside `resolvePointer()` would leave held words with the old bug.
- Term ids now come from `mergeTerms`: a term keeps its id across reads, and new terms get ids above all existing ones. So **ids are age order, not reading order**, and the current "lowest id wins a tie" rule means the oldest term wins. Don't rely on ids for position. Use `readingOrder()` in `src/live/boardQuery.ts` when you need reading order.

### 3.3 "Only whisper when something points" gate (2.5)

`live.handleItems()` now does this, in order:
1. `resolvePointer(word, terms, tips)`
2. if no terms **and** the word is `this`/`that`/`here` **and** the steadiest tip is near `pendingRegion()`: **hold** the word (no emit)
3. otherwise emit (whisper, or a silent resolution)

Your gate must run **before step 2**. A word the gate rejects ("not really pointing") must be emitted as silent and **never held**, or the hold logic will whisper it up to 8 s later when a box appears. The cleanest way is for the gate to report *why* it found nothing ("not pointing" vs "pointing at empty space") and to hold only in the second case.

- The hold uses `steadiestTip()` over `TIP_WINDOW_MS`. If you add laser smoothing, use the smoothed point for both the gate and the hold so they agree.
- `these`/`those` are never held, which matches the plan (the sweep keeps its current behaviour).
- The tests in `tests/liveHold.test.ts` must keep passing. Add yours next to them.

### 3.4 Pointer interface and judge screen (2.1, 2.6, 2.7)

- **There is already a second pointer source:** in demo mode, `JudgeScreen.tsx` pushes **mouse** positions into `tipsRef.current` (`onPointerMove` on `.stage`, via `mouseToBoard` in `src/board/mode.ts`). When you add `kind` to points, give the mouse its own kind (or treat it as `finger`) so demo mode keeps working.
- In demo mode the camera still runs and the hand tracker still feeds the same buffer, so a real hand can point at the saved photo too.
- **`JudgeScreen.tsx` now has:**
  - a `stage` object (`stageFor(boardMode(...))`)
  - a `<img className="demo-photo">` layer, with the video given the `behind-photo` class in demo mode
  - a DEMO/LIVE tag
  - `checkHeld()` called in `setTerms` and in the 1 s stats interval
- **Rules for `JudgeScreen.tsx`:** build your pointer dot/label as its own component and add one line here to mount it. Keep the `P` shortcut working (2.6 may only need verifying).
- **Drawing coordinates:** anything drawn on the overlay must use the existing `flipX()` helper, because live mode can be mirrored (`?mirror=1`). The demo photo is never mirrored.

### 3.5 Things you can ignore

The server, streaming, phrase building, prompt format and Railway/Vercel hosting. None of it changes the pointer path.

---

## 4. Heads-up for your coding agent (paste this in)

**Hard rules**
1. **Never write any dates into any file** (code, comments, tests, docs, commit-tracked files). Hard team rule.
2. **Never change `src/core/types.ts`.** It is frozen. Put new types (for example the pointer point `{ kind, x, y, confidence, t }`) in a new file such as `src/vision/pointer.ts`.
3. **No AI or model calls on the live pointing path.** Laser and stick detection must be plain image processing in the browser.
4. **Test first.** For every task, write the failing test and watch it fail, then fix. Never delete a test or weaken an assertion to get green. The baseline is 414 passing.
5. **Before every commit** run `npm test`, `npx tsc --noEmit` and `npm run build`; all must pass. One commit per task, message like `feat(pointing): laser dot detector (2.3)`, ending with the team's Co-Authored-By line.
6. **Demo mode must work at every commit.** `?demo=1` shows the saved photo with its boxes, the mouse points, `P` resolves. It is the stage fallback.
7. **Don't edit** `server/`, `src/board/boardClient.ts`, `src/core/phrase.ts`, `src/core/mergeTerms.ts` or `scripts/bench-board.mjs`. That's Person 1's lane, and PR #1 also touches `server/`.
8. **Shared files:** edit `src/board/boardLoop.ts` and `src/core/frameDiff.ts` only for the laser/stick masking in §3.1, with tests. In `src/ui/JudgeScreen.tsx`, add one-line mounts only.
9. **Keys** stay in `.env` and are never printed, logged, committed or put in tests (use obvious fakes).

**Design guidance**
- Write detectors as **pure functions over an ImageData-like input** (`{ data: Uint8ClampedArray, width, height }`) so they can be tested with synthetic frames. No DOM, no camera in tests.
- They run **every frame on the main thread**, next to MediaPipe. Keep each one to a few milliseconds by working on a downscaled frame or a region around the last known point.
- **Laser:** a small, very bright spot, often white in the centre with a red or green halo, that persists 2 or more frames. Reject big bright areas (glare, windows) by size.
- **Stick:** step 1 (do this) is to track a bright tape colour on the tip; make the colour configurable. Step 2 (stretch only) is to find the far end of a long straight object leaving the hand.
- Always coordinate in **raw, unmirrored board coordinates 0 to 1**, like the existing fingertip.

**Order that avoids rework:** 2.2 bracket bug (small, in `termAt`) → 2.1 pointer interface (add `kind`, keep the finger and mouse working) → 2.5 gate (before step 2 of §3.3) → 2.3 laser plus its board-loop masking (§3.1) → 2.4 stick → 2.6 → 2.7.

---

## 5. Testing without a whiteboard

- **Demo mode:** `npm run server` plus `npm run dev`, then open `http://localhost:5173/?demo=1`. Move the mouse over a term and press `P`. This covers the resolver, gate and bracket fix with no camera or key.
- **Fake camera:** Chrome can play a video file as the camera: launch it with `--use-fake-device-for-media-stream --use-file-for-fake-video-capture=/path/clip.y4m` (or `.mjpeg`). Record 30-second clips of finger, stick and laser pointing at a board once, convert them with ffmpeg, and replay them for every change.
- **Home "board":** a window, mirror or a sheet in a plastic sleeve taped flat to a wall works with dry-erase marker. Keep the camera propped still, not hand-held.
- **Earlier drafts:** first drafts of the laser and stick detectors were written but never committed (`src/vision/laser.ts`, `src/vision/stick.ts`, `src/vision/pointer.ts` and their tests). They are on Person 1's laptop in `.claude/worktrees/`. Ask Person 1 to push them to a branch if you want a starting point, and review them as untrusted first drafts.

---

## 6. Known rough edges from the speed lane (not yours to fix, but you may notice them)

- Reset doesn't clear a held "this".
- The teacher's own hand counts as changed ink, so a missed "this" may be held until the hand leaves instead of going silent at once.
- With 1 s checks, a person standing still in front of the board can clear the boxes after two empty reads sooner than before.
- The new compact reply format sometimes finds a few fewer terms on crowded boards than the old JSON format. Person 1 is watching this.
