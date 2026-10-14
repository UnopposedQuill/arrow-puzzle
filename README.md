# Arrow Puzzle

Small game using Capacitor for desktop-phone portability
Frontend: Vite+React+Capacitor
Backend/Server: Apollo Server+NodeJS

## Description

We have a weird figure with some runes on it, these
runes are entangled and it seems the figure can be
opened.
None of the arrows can move forward if another is in
its way

## Game design

### Figures, faces and edges

A puzzle is played on a **figure**: a solid whose faces each carry an N×N grid of cells
(N is the "Grid" setting: 16 by default, 2–24 allowed). Only the cube exists so far.
The defaults, a 16 grid with arrows up to 16 cells, are meant as medium difficulty.

Each face has a 3D frame: an outward `normal` and the axes `u` (columns, "right") and `v`
(rows, "down"), with `u × v = normal`. The frames use CSS orientation (x right, y down,
z toward the viewer). The frontend therefore places each face with a `matrix3d` built
straight from its frame, and backface culling works because every face's front side
points outwards.

Faces meet along **edges, and every edge has a type**. Stepping off a face goes through
`crossEdge`, which works out the cell and heading on the neighbouring face. `step` then
asks the edge type what happens:

| Edge type | Effect | Status |
| --- | --- | --- |
| `open` | The arrow leaves the figure and is cleared | Implemented, used on every edge |
| `sticky` *(planned)* | The arrow is carried onto the next face and has to clear another edge | Add to `EdgeType`, return `crossing.cell`/`crossing.dir` from `step` |

Edge types only apply to an arrow's **head**. An arrow's body lies on the figure as a path
of neighbouring cells (`neighbor`, pure geometry), so bodies can wrap over edges onto
other faces, and the body follows the head's path over an edge when it slides. Once an
edge type can carry heads across, a slide can circle the figure forever (a ring of
sticky edges). The loops in `applyMove` and generation must then get a step bound.

### Arrows and moves

An arrow is a path of 1+ cells, stored tail first, plus the heading of its head.
Tapping it:

- slides it **head-first, one cell at a time**. The body follows the path the head took,
  like a snake, so bent arrows straighten out as they travel.
- is **cleared** as soon as its head crosses an `open` edge.
- is **blocked** when the next cell is taken by another arrow, or by its own body. Its
  own tail doesn't count, because the tail moves out as the head moves in.

What a blocked arrow does depends on the `blockedArrows` rule, a difficulty option:

| Rule | Blocked arrow | Effect |
| --- | --- | --- |
| `return` (default) | Goes back to where it started | Only clearing changes the board, so it **can never deadlock**. Every tap either clears an arrow or leaves the board as it was (still costing a move) |
| `stay` (hard, the "Hard" checkbox) | Stays where it stopped | Arrows can be pushed into each other's paths, so careless moves can leave the board unsolvable. *New Game* is the way out |

A move is the tapped arrow's `id`, and **every tap on an arrow still on the board is a
move**, including one that cannot advance. A blocked attempt is recorded, sent to the
server and counted in the score, even when it leaves the board unchanged (always the case
under `return`). The frontend nudges a blocked arrow toward its blocker and back and
flashes it red, so the
attempt visibly registers. Ids that are not on the board (cleared or made up) are not
moves, and replay ignores them.

The rule is part of `PuzzleOptions` and is copied into `GameState`, because replay depends
on it. It is sent to the server with the attempt, and changing it starts a new game, so one
move list is always replayed under one rule.

### Generation

Arrows are placed one at a time from random heads and headings. The body is grown backwards
from the head over free cells, across edges where it reaches one, preferring to continue
straight (`STRAIGHT_BIAS`) so it curls into dead ends less often.

- **Lengths** are drawn from the top half of the "Length" setting (default 16, up to 24).
- **Long arrows first:** during the first three quarters of the attempts, an arrow is kept
  only if its body reached at least half the maximum. The last quarter, and a final sweep
  that offers every remaining free cell every heading, fill the gaps with arrows of at
  least `FILLER_MIN_LENGTH` (2) cells.

**Solvable by construction, from both ends.** Arrows are cleared in **reverse id order
(highest first)**, and generation builds that order from both ends:

- an arrow added to the **front** is cleared before all the others, so its path from head to
  edge must be clear of every arrow already placed;
- an arrow added to the **back** is cleared after all the others, when the board is empty, so
  its own path doesn't matter, but it must not sit on the path of any arrow already
  placed.

With front placement alone, about a fifth of the board stayed empty in visible patches:
once the board is dense, most free cells have a blocked path in every direction. Many
such cells can still take a back arrow. The tests use reverse id order as the reference
solution. Under `return`, every board reached by play stays solvable that way: what is
left is a subset of the original arrows, and the highest remaining id is never blocked.

**At the defaults** (16/16) a board has about 160 arrows filling about 88.5% of cells, and
generation takes about 70 ms. Most cells belong to long arrows (8+ cells), and about 30
arrows are 1–2 cell fillers. `FILLER_MIN_LENGTH` trades fill against stubs: 1 fills about
91% with about 140 stubs, and 3 fills about 86% with none.

### Rendering

`apps/frontend/src/components/Figure3D.tsx` draws the figure with CSS 3D transforms. The
solid carries a single rotation matrix. Dragging rotates it about the screen axes, so a
horizontal drag always spins it left and right, however tilted it is. A press that moves
more than a few pixels is a drag and never a tap.

- **See-through faces.** Faces are translucent glass with no grid lines, so arrows on every
  side stay visible and it's easier to keep track of what's left. Arrows on faces turned
  away from the viewer are dimmed and can't be tapped.
- **Black arrows.** Arrows are black and flash red when an attempt is blocked. A body that
  crosses an edge is drawn up to the edge on both faces, so it reads as one line.
- **Edges under the arrows.** The white edge outline is part of each face's SVG and is drawn
  *before* the arrows, not as a CSS border around them. Arrows therefore run right up to
  and over the edge, and an arrow continuing onto another side is visibly unbroken.
- **Zoom** with the mouse wheel or a two-finger pinch (0.5×–4×). It scales the figure, not
  the CSS perspective, so the solid keeps its shape, and rotation slows down as you zoom
  in. The stage fills the whole board area, so a zoomed-in figure can be dragged and
  tapped wherever it shows. A second finger cancels a pending tap or rotation, and lifting
  it hands control back to rotation, never to a tap.
- **Taps are resolved in code, not by the browser.** Chrome's hit testing of SVG inside
  perspective 3D transforms misses often on slanted faces; measured, only about half of
  taps on the two slanted faces of the initial view reached their arrow. Instead,
  `pickCell` traces the tap from the eye (the CSS `perspective` distance) through the
  screen point onto the face turned toward the viewer, at the current zoom.
- **Which faces are "near".** A face counts as near, meaning drawn in full and tappable,
  when the eye is in front of its plane. Because of perspective, that's stricter than its
  normal pointing toward the screen: a face just past edge-on is seen from behind. The
  drawing and `pickCell` share one test (`facesViewer`), so every arrow drawn as tappable
  is tappable. The arrow occupying that cell is
  tapped, so the whole cell is the target, not just the drawn line. Faces and their SVGs
  have `pointer-events: none`, so every press lands on the stage.

## Reusing this scaffold for a new game

Commit `0ae29a5` ("Adds game-agnostic scaffolding from liquid-sort-puzzle") is the template:
it holds the scaffolding with a placeholder game (a row of lit cells; tap each one to switch
it off). Copy the tree **at that commit**, not at a later one, to start the next game. After
copying it:

1. **Rename** — replace `arrow-puzzle` / `@arrow-puzzle/shared` / `Arrow Puzzle` /
   `com.arrow.puzzle` in:
   - `package.json` (name, `build:shared` filter)
   - `packages/shared/package.json` (name)
   - `apps/frontend/package.json`, `apps/server/package.json` (dependency on shared)
   - imports in `apps/frontend/src/App.tsx`, `apps/frontend/src/graphql/mutations.ts`, `apps/server/src/index.ts`
   - `apps/frontend/capacitor.config.ts` (`appId`, `appName`), `apps/frontend/index.html` (`<title>`), `TITLE` in `App.tsx`
   - this README
2. **Run `pnpm install`** — the lockfile is regenerated with the new package names.
3. **Implement the game** — replace the placeholder in the four places that know about it:

   | File | What to change |
   | --- | --- |
   | `packages/shared/src/index.ts` | `GameState`, `Move`, `PuzzleOptions` and the five contract functions |
   | `packages/shared/test/game.test.ts` | Tests for the real logic (100% coverage is enforced) |
   | `apps/server/src/index.ts` | `submitAttempt` arguments (`moves` type, generation options) |
   | `apps/frontend/src/graphql/mutations.ts` | The same arguments, client side |
   | `apps/frontend/src/App.tsx` | Board rendering and how input maps to a `Move` |

4. **Add icons** — `apps/frontend/assets/icon.png`, `icon-foreground.png`, `icon-background.png`
   (see the Mobile section).

### The shared contract

Every game implements the same five pure functions in `packages/shared`:

```ts
generatePuzzle(seed, options) -> GameState   // must be deterministic: use mulberry32, never Math.random
isValidMove(state, move)      -> boolean     // must reject untrusted input, not throw
applyMove(state, move)        -> GameState   // pure, never mutates
replayMoves(initial, moves)   -> GameState
checkWin(state)               -> boolean
```

The server never receives the board — only the seed, the generation options and the move
list. It regenerates the board, replays the moves and checks the win. That is what makes
scores trustworthy, and it is why generation must be deterministic: if it drifted, every
previously valid attempt would be rejected.

## Project Structure
```
arrow-puzzle/
├── .gitignore                 (Root)
├── package.json               (Root workspace)
├── pnpm-workspace.yaml
├── packages/
│   └── shared/
│       ├── package.json
│       ├── tsconfig.json
│       ├── jest.config.cjs
│       ├── src/
│       │   ├── index.ts       (Re-exports; documents the shared contract)
│       │   ├── rng.ts         (Seeded PRNG)
│       │   ├── figure.ts      (Faces, typed edges, crossing between faces)
│       │   └── game.ts        (Arrows, moves, generation, win check)
│       └── test/
│           ├── figure.test.ts
│           └── game.test.ts
└── apps/
    ├── frontend/
    │   ├── package.json
    │   ├── vite.config.ts
    │   ├── tsconfig.json
    │   ├── capacitor.config.ts (appId + native platform paths)
    │   ├── index.html
    │   ├── assets/             (app icon sources, see Mobile section)
    │   ├── scripts/
    │   │   └── check-platforms.mjs
    │   ├── mobile/             (gitignored, see Mobile section)
    │   │   ├── android/        (npx cap add android)
    │   │   └── ios/            (npx cap add ios)
    │   └── src/
    │       ├── main.tsx
    │       ├── App.tsx
    │       ├── App.css
    │       ├── components/
    │       │   ├── CountStepper.tsx (mobile-friendly numeric setting)
    │       │   └── Figure3D.tsx     (rotatable CSS 3D figure, arrow taps)
    │       ├── apollo/
    │       │   └── client.ts
    │       └── graphql/
    │           └── mutations.ts
    └── server/
        ├── package.json
        ├── tsconfig.json
        └── src/
            └── index.ts       (Apollo Server: regenerate, replay, verify)
```

## Local Development

### Requirements

- pnpm
- node

### Getting started

```
pnpm install
pnpm run build
pnpm run dev
```

This starts the shared package in watch mode alongside the frontend and server:

- Frontend: http://localhost:5173
- GraphQL server: http://localhost:4000/graphql

### Scripts

| Script | Description |
| --- | --- |
| `pnpm dev` | Runs `shared` (watch), `frontend` and `server` together |
| `pnpm dev:frontend` / `pnpm dev:server` | Run a single app in dev mode |
| `pnpm build` | Builds `shared`, `frontend` and `server`, in that order |
| `pnpm build:shared` / `pnpm build:frontend` / `pnpm build:server` | Build a single workspace |
| `pnpm test` | Runs every workspace's tests (currently `shared`) |
| `pnpm test:coverage` | Same, with a coverage report and thresholds enforced |
| `pnpm cap:check` | Verifies at least one native platform is scaffolded under `mobile/` |
| `pnpm cap:assets` | Regenerates app icons/splash from `apps/frontend/assets/` into the native project |
| `pnpm cap:sync` | Runs `cap:check`, then copies the frontend's `dist/` build into the native Capacitor projects |
| `pnpm cap:run:android` | Builds, syncs, and launches the app on a connected Android device/emulator |

`shared` must be built (or running via `pnpm dev`/`build:shared`) before `frontend` or `server`, since both consume its compiled `dist/` output rather than the TypeScript source directly.

### Stopping the servers (Ctrl+C)

The server shuts down gracefully on SIGINT/SIGTERM. It drains in-flight requests, closes
port 4000 and exits with code 0. Apollo's own handling is disabled
(`stopOnTerminationSignals: false`), because it re-raises the signal after stopping, so
every Ctrl+C looked like a crash. Duplicate signals are ignored: one Ctrl+C reaches the
server both from the terminal and relayed through pnpm.

Two settings keep the chain between your terminal and the server quiet:

- `apps/server` runs in development with `node --watch --import tsx` rather than
  `tsx watch`. `tsx watch` received the Ctrl+C twice (terminal + pnpm), took the second as
  "force kill" and SIGKILLed the server mid-shutdown. Node's watch mode restarts on change
  with a SIGTERM, which goes through the same graceful shutdown.
- `.npmrc` sets `shell-emulator=true`, so pnpm runs scripts with its built-in shell instead
  of `sh` (dash on Ubuntu/WSL) or `cmd.exe`. Otherwise the intermediate `sh` dies from the
  Ctrl+C and pnpm reports `Command failed with signal "SIGINT"`, even though the server
  exited cleanly. It also makes scripts behave the same on Windows and Linux.

Some messages on Ctrl+C are expected and are **not** crashes:

| Command | What you may see | Why |
| --- | --- | --- |
| `pnpm --filter server dev` / `start` | Nothing beyond `SIGINT received, shutting down...` | Clean |
| `pnpm dev:server` | `ELIFECYCLE Command failed with exit code 129` | The root script runs pnpm inside pnpm, and the inner pnpm ends on the signal itself |
| `pnpm dev` | `Failed` for `shared` (`tsc --watch`) and `frontend` (`vite`); `apps/server dev: Done` | Those watchers simply die on SIGINT |

### Testing

Tests run on **Jest** with **ts-jest**, and live in `packages/shared/test/`.

```
pnpm test              # all workspaces that define a test script
pnpm test:coverage     # with coverage, thresholds enforced
```

Or from inside `packages/shared`: `pnpm test`, `pnpm test:watch`, `pnpm test:coverage`.

Tests import from `../src/index.js` — the source, not `dist/` — so **you do not need to
build `shared` before running them**. The `.js` extension is required by the package's
NodeNext module resolution; Jest maps it back to the `.ts` file.

`packages/shared` holds the only logic worth testing on its own: it is pure, deterministic
and shared verbatim by the client and the server. `jest.config.cjs` enforces **100%**
statement, branch, function and line coverage as a threshold — adding a function without a
test fails the run. Lower it there if that gate gets in the way.

| File | Focus |
| --- | --- |
| `test/figure.test.ts` | Face frames are right-handed, edge count and adjacency, `crossEdge` round-trips for every boundary cell |
| `test/game.test.ts` | Options bounds, generation (deterministic, well-formed, solvable), sliding/blocking/clearing under both `blockedArrows` rules (including no deadlock under `return`), win validation |

Whatever the game, the suite should cover the two properties the architecture rests on:

- **Generation is deterministic** — the same seed and options always produce the same board.
- **A win is provable from seed + moves alone** — replaying a real solution against a
  freshly generated board wins; an empty list, fabricated or out-of-range moves, and a
  replay against the wrong seed do not.

### Environment Variables

The frontend (`apps/frontend`) reads Vite-exposed env vars at build/dev time:

| Variable | Default | Description |
| --- | --- | --- |
| `VITE_GRAPHQL_ENDPOINT` | `http://localhost:4000/graphql` | URL of the Apollo GraphQL server |

Copy `apps/frontend/.env.example` to `apps/frontend/.env.local` and adjust it to point the frontend at a non-default server.

### Mobile (Capacitor)

The frontend is wrapped with Capacitor (`appId: com.arrow.puzzle`) for Android/iOS packaging. Native platform folders (`apps/frontend/mobile/android/`, `apps/frontend/mobile/ios/`) are **gitignored and regenerated on demand rather than committed**, so a fresh clone has neither.

Capacitor defaults to `android/` and `ios/` at the project root; this repo groups them under `mobile/` via `android.path` / `ios.path` in `capacitor.config.ts`:

```ts
const config: CapacitorConfig = {
  appId: 'com.arrow.puzzle',
  appName: 'Arrow Puzzle',
  webDir: 'dist',
  android: { path: 'mobile/android' },
  ios: { path: 'mobile/ios' },
};
```

That grouping earns its keep three times over: all generated native code sits behind one gitignore rule (`apps/frontend/mobile/`), the platform check below reduces to "does `mobile/` contain anything?" with no platform list to keep in sync, and adding a future platform needs no script changes. Capacitor rewrites the generated `capacitor.settings.gradle` relative paths to match the nesting on every sync, so the extra directory level is transparent to Gradle.

#### First-time platform setup (required)

Because the native folders aren't in the repo, you must scaffold them once per clone, from `apps/frontend`:

```
npx cap add android     # creates apps/frontend/mobile/android/
npx cap add ios         # creates apps/frontend/mobile/ios/ (macOS + Xcode only)
```

Run this **before** any Gradle command. `npx cap add` needs the web build to exist, so run `pnpm build:frontend` first if you haven't.

Platform-targeted Capacitor commands fail loudly and point you here, which is what you want:

```
$ npx cap sync android
[error] android platform has not been added yet.
        See the docs for adding the android platform: https://capacitorjs.com/docs/android#adding-the-android-platform
```

Bare `npx cap sync` is the exception, and it used to be the trap here: it syncs *whatever platforms exist*, so with none added it prints a green `✔ copy web` / `Sync finished` and **exits 0** while doing no native work — the failure only surfaced later at the Gradle step. `pnpm cap:sync` now runs `cap:check` first (`apps/frontend/scripts/check-platforms.mjs`), which lists the directories inside `mobile/` and fails with an actionable message when it finds none:

```
$ pnpm cap:sync
No Capacitor platform has been added yet, so there is nothing to sync.

Native platform folders are gitignored and regenerated on demand, so a
fresh clone has none. Scaffold at least one from apps/frontend:

  npx cap add android     # creates mobile/android/
  npx cap add ios         # creates mobile/ios/ (macOS + Xcode)
```

Run `pnpm cap:check` on its own any time you want to know which platforms are scaffolded — it prints e.g. `Capacitor platforms present: android`. An empty `mobile/` counts as none, so deleting a platform folder by hand still fails the check rather than slipping through.

**Regenerate the app icons after every `npx cap add`.** `cap add` rebuilds the native project from the Capacitor template, which replaces the generated launcher icons with the default ones — the app will appear with Capacitor's icon rather than this project's. The sources belong in `apps/frontend/assets/` (`icon.png`, `icon-foreground.png`, `icon-background.png`) and should be committed; only the generated output is disposable. **This scaffold ships without icons** (they are game-specific), so add them before running:

```
pnpm cap:assets
```

That wraps `capacitor-assets generate --android --androidProject mobile/android`. The `--androidProject` flag is required: `@capacitor/assets` v3 does **not** read `android.path` from `capacitor.config.ts` and otherwise looks for a top-level `android/`, warning `Android platform not found ... skipping android generation` and exiting successfully — a silent no-op in the same family as the `cap sync` one above.

Re-run `npx cap add` any time you delete the folder; it's safe to regenerate. Anything you hand-edit inside `mobile/android/` or `mobile/ios/` is lost on regeneration — which is why the keystore advice below deliberately keeps changes *outside* those folders.

#### Android toolchain requirements

- **JDK 21** — the native `capacitor-android` module (Capacitor 8.x) compiles with `--release 21`, so JDK 17 is not enough even though Gradle itself would run on it.
- **Android SDK** with `platform-tools`, `platforms;android-36`, and `build-tools;36.0.0` (matching `compileSdkVersion`/`targetSdkVersion` in `apps/frontend/mobile/android/variables.gradle`).
- `apps/frontend/mobile/android/local.properties` (gitignored, not committed) pointing at your SDK:
  ```
  sdk.dir=/home/you/Android/Sdk        # or C:/path/to/Android/Sdk on Windows
  ```

You have three ways to get the SDK:

1. **Android Studio's SDK Manager** — easiest if you already use the IDE.
2. **Google's [`android` CLI](https://developer.android.com/tools/agents/android-cli)** — `android sdk install platform-tools platforms/android-36 build-tools/36.0.0`.
3. **`sdkmanager` from cmdline-tools** — fully headless, no IDE, works well on Linux/WSL and CI. This is what a from-scratch setup looks like:

   ```bash
   # 1. Download and unpack the command-line tools
   curl -fsSL -o cmdtools.zip \
     https://dl.google.com/android/repository/commandlinetools-linux-13114758_latest.zip
   mkdir -p ~/Android/Sdk/cmdline-tools
   unzip -q cmdtools.zip -d /tmp/cmdout
   mv /tmp/cmdout/cmdline-tools ~/Android/Sdk/cmdline-tools/latest

   # 2. Point the environment at it
   export JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64
   export ANDROID_HOME="$HOME/Android/Sdk"
   export PATH="$JAVA_HOME/bin:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$PATH"

   # 3. Accept licenses and install exactly what the build needs
   yes | sdkmanager --licenses
   sdkmanager --install "platform-tools" "platforms;android-36" "build-tools;36.0.0"

   # 4. Record the SDK location for Gradle
   echo "sdk.dir=$HOME/Android/Sdk" > apps/frontend/mobile/android/local.properties
   ```

   The nested `cmdline-tools/latest/` directory name matters — `sdkmanager` refuses to run if the tools sit directly in `cmdline-tools/`. Add the three `export` lines to your `~/.bashrc` so new shells inherit them.

#### Building and installing

```
pnpm build:frontend
pnpm cap:sync
pnpm cap:run:android
```

`pnpm cap:run:android` is the happy path, but it fails on two common setups:

- **On Windows** (`'gradlew' is not recognized...`) — the Capacitor CLI spawns `gradlew` without going through a shell, so Windows can't resolve the `.bat` extension.
- **On WSL2** — it shells out to the Linux `adb`, which cannot see a phone plugged into the Windows host (see below), so it reports no devices.

In both cases, drive Gradle directly from `apps/frontend/mobile/android` with `JAVA_HOME`/`ANDROID_HOME` set:

```
./gradlew installDebug          # Linux/macOS
.\gradlew.bat installDebug      # Windows
```

`installDebug` builds the debug APK and installs it on whatever device `adb devices` currently sees. Use `assembleDebug` instead if you want to build the APK without installing — it lands at `apps/frontend/mobile/android/app/build/outputs/apk/debug/app-debug.apk`.

#### Connecting an Android device from WSL2

**WSL2 has no USB passthrough by default.** A phone plugged into the Windows host is invisible to Linux — there's no `/dev/bus/usb`, and `adb devices` inside WSL will always come back empty no matter how the SDK is configured. This is the single most confusing failure in this setup, because every tool reports "no devices" rather than anything explaining why.

Two ways around it.

**Option A — drive the Windows-side `adb` (no admin required).** Build in WSL, install through Windows. This is the route this project has actually been set up with:

```bash
# 1. One-time: install Google's platform-tools on the WINDOWS side
curl -fsSL -o pt-win.zip \
  https://dl.google.com/android/repository/platform-tools-latest-windows.zip
unzip -q pt-win.zip -d /mnt/c/Users/<you>/

# 2. Convenience alias — add to ~/.bashrc
alias wadb='/mnt/c/Users/<you>/platform-tools/adb.exe'

# 3. Confirm the phone is visible, then ACCEPT the "Allow USB debugging?"
#    prompt on the device (it shows as `unauthorized` until you do)
wadb devices

# 4. Build in WSL, then hand the APK to Windows adb via a Windows-visible path
cd apps/frontend/mobile/android && ./gradlew assembleDebug
cp app/build/outputs/apk/debug/app-debug.apk /mnt/c/Users/<you>/
wadb install -r 'C:\Users\<you>\app-debug.apk'
```

`adb.exe` is a Windows binary, so it needs a **Windows** path (`C:\...`) for the APK — it cannot read `/home/...`. Copying the APK under `/mnt/c/` first is the simplest fix.

If `wadb devices` shows nothing at all, check that Windows itself sees the phone before blaming adb:

```powershell
Get-PnpDevice -PresentOnly | Where-Object { $_.FriendlyName -match 'ADB|Android' }
```

An `ADB Interface` entry with status `OK` means the driver is fine and the problem is elsewhere.

**Option B — `usbipd-win` USB passthrough (needs admin).** Attaches the physical device into WSL so everything works exactly as documented, including `pnpm cap:run:android` and the Linux `adb`. From an **administrator** PowerShell:

```powershell
winget install usbipd
usbipd list                        # find the phone's BUSID
usbipd bind --busid <BUSID>        # one-time, persists
usbipd attach --wsl --busid <BUSID>
```

The `attach` step must be repeated after each reboot or `wsl --shutdown`. This is the cleaner long-term option if you're willing to install it; Option A is the faster one if you aren't.

#### Signature clash when the app was built on another machine

Android generates `~/.android/debug.keystore` **per machine**, with a random key. Two computers building this app therefore produce APKs that cannot replace each other, and installing across them fails with:

```
INSTALL_FAILED_UPDATE_INCOMPATIBLE: Existing package com.arrow.puzzle
signatures do not match newer version; ignoring!
```

The quick fix is to remove the other machine's copy first — note this **deletes the app's on-device data**:

```
adb uninstall com.arrow.puzzle
adb install -r path/to/app-debug.apk
```

To stop it recurring, copy a single `~/.android/debug.keystore` from whichever machine you treat as canonical to the others. That file lives *outside* the project, so it survives `npx cap add android` regenerating the `mobile/android/` folder — unlike a `signingConfig` in `app/build.gradle`, which would be wiped every time.

#### Testing against a local server on a real device

A phone connected over USB doesn't share `localhost` with your dev machine, so the default `VITE_GRAPHQL_ENDPOINT` (`http://localhost:4000/graphql`) would otherwise point at the phone itself. Rather than reconfiguring the endpoint and dealing with LAN/firewall issues, tunnel the port over the existing USB connection:

```
adb reverse tcp:4000 tcp:4000     # or `wadb reverse ...` on WSL2
```

With that in place, the installed app's `localhost:4000` transparently reaches the Apollo server running on your PC. The tunnel is not persistent — re-run it after replugging the device or restarting the adb server.

**Why the server binds `0.0.0.0`.** `apps/server/src/index.ts` listens on `0.0.0.0` rather than Node's default. This matters specifically on WSL2: Windows mirrors a WSL listener onto its own loopback using the *same address family*, so a dual-stack (`::`) bind is exposed only as `[::1]:4000` — IPv6. `adb reverse` connects over IPv4 `127.0.0.1`, finds nothing, and closes the stream, which surfaces on the device as an empty reply (`curl` exit code 52) rather than a connection error. Binding IPv4 explicitly makes Windows expose `127.0.0.1:4000` and the tunnel work. To verify the mapping on your own machine:

```
ss -tln | grep 4000                          # from WSL
netstat.exe -ano | grep ":4000"              # what Windows actually exposes
```
