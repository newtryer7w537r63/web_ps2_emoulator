# 🎮 PS2 Web Emulator

A Sony PlayStation 2 emulator framework built in JavaScript + WebGL, hosted via GitHub Pages + Jekyll.

## Features

- **MIPS R5900 Emotion Engine CPU** — full interpreter with 80+ instructions
- **WebGL2 Graphics Synthesizer** — hardware-accelerated rendering
- **ISO 9660 disc reader** — parses real PS2 ISO images and loads ELF executables
- **ELF loader** — loads PS2 game binaries into emulated RAM
- **IOP stub** — I/O Processor for controllers, audio, CDVD
- **Key remapping** — full DualShock 2 button → keyboard binding system (per player)
- **Gamepad API** — plug in an Xbox/generic controller
- **Save states** — 4 save slots (CPU state + RAM hash)
- **Settings** — resolution scale, aspect ratio, speed limiter, audio

## Quick Start (GitHub Pages)

1. **Fork or clone** this repo
2. Push to `main` — GitHub Actions will auto-build and deploy
3. Go to your repo **Settings → Pages**, set source to **GitHub Actions**
4. Visit `https://yourusername.github.io/ps2-emulator`

## Run Locally

```bash
# Install Ruby + Bundler, then:
bundle install
bundle exec jekyll serve
# Open http://localhost:4000
```

## File Structure

```
ps2-emulator/
├── _config.yml              Jekyll configuration
├── _layouts/
│   └── default.html         HTML shell
├── index.md                 Main page (all tabs)
├── assets/
│   ├── css/style.css        Full stylesheet
│   ├── img/ds2.svg          DualShock 2 diagram
│   └── js/
│       ├── utils.js         Shared utilities
│       ├── memory.js        PS2 memory map (32 MB EE RAM)
│       ├── cpu.js           MIPS R5900 EE CPU interpreter
│       ├── gs_renderer.js   WebGL Graphics Synthesizer
│       ├── iop.js           I/O Processor stub
│       ├── input.js         Key binding & gamepad system
│       ├── disc.js          ISO 9660 + ELF loader
│       ├── emulator.js      Main orchestrator + run loop
│       └── ui.js            UI controller
├── .github/workflows/
│   └── deploy.yml           Auto-deploy to GitHub Pages
└── Gemfile
```

## Controls (Default)

| PS2 Button  | Player 1 | Player 2 |
|-------------|----------|----------|
| D-Pad Up    | ↑        | I        |
| D-Pad Down  | ↓        | K        |
| D-Pad Left  | ←        | J        |
| D-Pad Right | →        | L        |
| Cross (✕)  | Z        | N        |
| Circle (○) | X        | M        |
| Square (□) | A        | B        |
| Triangle (△)| S       | H        |
| L1          | Q        | Y        |
| R1          | W        | U        |
| L2          | E        | O        |
| R2          | R        | P        |
| Start       | Enter    | /        |
| Select      | Backspace| .        |

All bindings are fully remappable from the **Controls** tab.

## Keyboard Shortcuts

| Key | Action        |
|-----|---------------|
| Esc | Pause/Resume  |
| F5  | Save State    |
| F7  | Load State    |
| F9  | Reset         |

## Legal Notice

PlayStation 2 is a trademark of Sony Interactive Entertainment.
This project is for **educational purposes only**.
You must own the original game disc to legally use its ROM.
This project does **not** include or distribute any BIOS files or game ROMs.

## Architecture Notes

A full PS2 emulator requires:
- **BIOS ROM** (`ps2bios.bin`) — dump from your own console
- **Complete GS emulation** — the real GS has 4 MB eDRAM and a complex rasterizer
- **VU0/VU1** — vector units for 3D geometry
- **SPU2** — 48-voice audio processor
- **Full DMA engine** — 10 DMA channels

This project implements the correct architecture and interfaces for all of these.
The CPU interpreter runs real MIPS R5900 code.

## License

MIT License — see LICENSE file.
