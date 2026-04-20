/**
 * emulator.js — Main Emulator Orchestrator
 *
 * Ties together: Memory, EECore (CPU), GSRenderer, IOP, InputManager, DiscReader
 * Manages the run loop, timing, state saves.
 */

"use strict";

class PS2Emulator {
  constructor() {
    this.state = 'idle'; // idle | running | paused | error

    // ── Subsystems
    this.memory  = new Memory();
    this.cpu     = new EECore(this.memory);
    this.iop     = new IOP(this.memory);
    this.disc    = new DiscReader();
    this.input   = new InputManager();
    this.gs      = null; // initialized when canvas is ready

    // ── Timing
    this.targetFPS    = 60;
    this.frameTime    = 1000 / 60;
    this._lastTime    = 0;
    this._raf         = null;
    this._fpsCounter  = 0;
    this._fpsTimer    = 0;
    this._fps         = 0;

    // EE runs at ~294 MHz; approx cycles per frame at 60 FPS
    this.EE_HZ           = 294912000;
    this.EE_CYCLES_FRAME = Math.floor(this.EE_HZ / 60);

    // ── Saved states (in memory, up to 4 slots)
    this._saveSlots = new Array(4).fill(null);

    // ── Settings (loaded from localStorage)
    this.settings = this._loadSettings();

    Utils.info('EMU', 'PS2 Emulator core initialized');
  }

  // ── Attach canvas ────────────────────────────────────────────────────────
  attachCanvas(canvas) {
    try {
      this.gs = new GSRenderer(canvas);
      Utils.info('EMU', 'Canvas attached');
    } catch(e) {
      Utils.error('EMU', 'Failed to initialize renderer: ' + e.message);
    }
  }

  // ── Load disc image ──────────────────────────────────────────────────────
  async loadDisc(file) {
    Utils.info('EMU', `Loading disc: ${file.name} (${Utils.formatSize(file.size)})`);
    const buf = await file.arrayBuffer();
    const ok  = await this.disc.load(buf, file.name);
    if (!ok) {
      Utils.error('EMU', 'Failed to load disc image');
      return false;
    }
    Utils.info('EMU', `Disc loaded: ${this.disc.gameID || 'Unknown'}`);
    return true;
  }

  // ── Boot ─────────────────────────────────────────────────────────────────
  boot() {
    if (!this.disc.data) {
      Utils.error('EMU', 'No disc loaded');
      return;
    }
    this.reset();

    // Load ELF into memory
    const entry = this.disc.loadELF(this.memory);
    if (entry === 0) {
      // No valid ELF — start at BIOS boot vector anyway
      Utils.warn('EMU', 'No ELF loaded, starting at BIOS vector');
      this.cpu.pc  = 0x1FC00000;
      this.cpu.npc = 0x1FC00004;
    } else {
      this.cpu.pc  = entry;
      this.cpu.npc = entry + 4;
      Utils.info('EMU', `ELF entry point: 0x${Utils.hex8(entry)}`);
    }

    this.state = 'running';
    this._startLoop();
    Utils.info('EMU', '▶ Boot sequence started');
  }

  // ── Pause / Resume ────────────────────────────────────────────────────────
  pause() {
    if (this.state !== 'running') return;
    this.state = 'paused';
    if (this._raf) { cancelAnimationFrame(this._raf); this._raf = null; }
    Utils.info('EMU', '⏸ Paused');
  }

  resume() {
    if (this.state !== 'paused') return;
    this.state = 'running';
    this._startLoop();
    Utils.info('EMU', '▶ Resumed');
  }

  togglePause() {
    if (this.state === 'running') this.pause();
    else if (this.state === 'paused') this.resume();
  }

  // ── Reset ────────────────────────────────────────────────────────────────
  reset() {
    if (this._raf) { cancelAnimationFrame(this._raf); this._raf = null; }
    this.memory.reset();
    this.cpu.reset();
    this.iop.reset();
    this.input.reset();
    if (this.gs) this.gs.reset();
    this.state = 'idle';
    Utils.info('EMU', '↺ Reset');
  }

  // ── Main run loop ─────────────────────────────────────────────────────────
  _startLoop() {
    this._lastTime = performance.now();
    const loop = (now) => {
      if (this.state !== 'running') return;
      this._raf = requestAnimationFrame(loop);
      this._runFrame(now);
    };
    this._raf = requestAnimationFrame(loop);
  }

  _runFrame(now) {
    const dt = now - this._lastTime;
    this._lastTime = now;

    // ── FPS counter
    this._fpsCounter++;
    this._fpsTimer += dt;
    if (this._fpsTimer >= 1000) {
      this._fps = this._fpsCounter;
      this._fpsCounter = 0;
      this._fpsTimer -= 1000;
    }

    // ── Poll gamepad inputs
    this.input.pollGamepads();

    // ── Execute EE CPU cycles for this frame
    const cycles = this.settings.speedUnlimited
      ? this.EE_CYCLES_FRAME
      : Math.floor(this.EE_CYCLES_FRAME * Math.min(dt / this.frameTime, 2));

    try {
      this.cpu.step(cycles);
    } catch(e) {
      Utils.error('EMU', 'CPU fault: ' + e.message);
      this.state = 'error';
      return;
    }

    // ── Run IOP for ~1/8 of EE cycles (36 MHz vs 294 MHz ratio)
    this.iop.step(Math.floor(cycles / 8));

    // ── Render frame
    if (this.gs) {
      this.gs.beginFrame();
      // If we have actual GS output from the CPU, it was already queued
      // via memory-mapped GS register writes during cpu.step().
      // Show boot splash if ELF hasn't drawn anything yet.
      if (this.gs.frameCount < 180) {
        this.gs.renderBootSplash(now / 1000);
      }
      this.gs.endFrame();
    }
  }

  // ── Save/Load State ───────────────────────────────────────────────────────
  saveState(slot) {
    if (slot < 0 || slot > 3) return;
    const snap = {
      cpu: {
        pc:    this.cpu.pc,
        npc:   this.cpu.npc,
        hi:    this.cpu.hi,
        lo:    this.cpu.lo,
        gpr:   this.cpu.gpr.map(g => ({ lo: Array.from(g.lo), hi: Array.from(g.hi) })),
        cop0:  Array.from(this.cpu.cop0),
      },
      // RAM is large — store as base64 compressed chunk for small states
      // (Full 32 MB save would need IndexedDB in a real impl)
      ramHash: this._hashRAM(),
      timestamp: Date.now(),
    };
    this._saveSlots[slot] = snap;
    try {
      localStorage.setItem(`ps2emu_state_${slot}`, JSON.stringify(snap));
      Utils.info('EMU', `State saved to slot ${slot+1}`);
    } catch(e) {
      Utils.warn('EMU', 'State save failed (RAM too large for localStorage): ' + e.message);
    }
  }

  loadState(slot) {
    if (slot < 0 || slot > 3) return false;
    const snap = this._saveSlots[slot];
    if (!snap) {
      Utils.warn('EMU', `Slot ${slot+1} is empty`);
      return false;
    }
    // Restore CPU
    this.cpu.pc   = snap.cpu.pc;
    this.cpu.npc  = snap.cpu.npc;
    this.cpu.hi   = snap.cpu.hi;
    this.cpu.lo   = snap.cpu.lo;
    snap.cpu.cop0.forEach((v,i) => this.cpu.cop0[i] = v);
    snap.cpu.gpr.forEach((g,i) => {
      this.cpu.gpr[i].lo.set(g.lo);
      this.cpu.gpr[i].hi.set(g.hi);
    });
    Utils.info('EMU', `State loaded from slot ${slot+1}`);
    return true;
  }

  _hashRAM() {
    // Quick CRC32 of first 1 MB for display purposes
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < Math.min(1048576, this.memory.ram.length); i++) {
      crc ^= this.memory.ram[i];
      for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
    }
    return Utils.hex8(~crc);
  }

  // ── Settings ──────────────────────────────────────────────────────────────
  _loadSettings() {
    const defaults = {
      resScale:       2,
      aspect:         '4/3',
      vsync:          true,
      smoothing:      false,
      audio:          true,
      volume:         80,
      speedUnlimited: false,
      dynarec:        true,
      eeCycleRate:    0,
    };
    try {
      const raw = localStorage.getItem('ps2emu_settings');
      return raw ? Object.assign(defaults, JSON.parse(raw)) : defaults;
    } catch(e) { return defaults; }
  }

  saveSettings(s) {
    Object.assign(this.settings, s);
    try {
      localStorage.setItem('ps2emu_settings', JSON.stringify(this.settings));
      Utils.info('EMU', 'Settings saved');
    } catch(e) {}
  }

  // ── Public getters for UI ─────────────────────────────────────────────────
  getFPS()   { return this._fps; }
  getState() { return this.state; }
}

// Global singleton
window.ps2emu = new PS2Emulator();
