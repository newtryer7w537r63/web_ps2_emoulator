/**
 * input.js — PS2 Controller Input & Key Binding System
 *
 * Maps keyboard keys → DualShock 2 buttons for up to 2 players.
 * Supports remapping, saving to localStorage, and gamepad API.
 *
 * DualShock 2 buttons:
 *   SELECT, L3, R3, START, UP, RIGHT, DOWN, LEFT
 *   L2, R2, L1, R1, TRIANGLE, CIRCLE, CROSS, SQUARE
 *   L_STICK_X, L_STICK_Y, R_STICK_X, R_STICK_Y  (analog)
 */

"use strict";

const DS2 = {
  // Digital buttons (bit positions in the 16-bit pad word)
  SELECT:   0,  L3:       1,  R3:    2,  START:    3,
  UP:       4,  RIGHT:    5,  DOWN:  6,  LEFT:     7,
  L2:       8,  R2:       9,  L1:   10,  R1:      11,
  TRIANGLE: 12, CIRCLE:  13,  CROSS: 14, SQUARE:  15,
  // Analog axes (stored separately)
  L_AXIS_X: 'lx', L_AXIS_Y: 'ly',
  R_AXIS_X: 'rx', R_AXIS_Y: 'ry',
};

const DS2_LABELS = {
  [DS2.SELECT]:   '⬜ Select',
  [DS2.L3]:       'L3 (Click)',
  [DS2.R3]:       'R3 (Click)',
  [DS2.START]:    '▶ Start',
  [DS2.UP]:       '↑ D-Up',
  [DS2.RIGHT]:    '→ D-Right',
  [DS2.DOWN]:     '↓ D-Down',
  [DS2.LEFT]:     '← D-Left',
  [DS2.L2]:       'L2',
  [DS2.R2]:       'R2',
  [DS2.L1]:       'L1',
  [DS2.R1]:       'R1',
  [DS2.TRIANGLE]: '△ Triangle',
  [DS2.CIRCLE]:   '○ Circle',
  [DS2.CROSS]:    '✕ Cross',
  [DS2.SQUARE]:   '□ Square',
};

// Default key bindings
const DEFAULT_BINDINGS = {
  1: {
    [DS2.UP]:       'ArrowUp',
    [DS2.DOWN]:     'ArrowDown',
    [DS2.LEFT]:     'ArrowLeft',
    [DS2.RIGHT]:    'ArrowRight',
    [DS2.CROSS]:    'z',
    [DS2.CIRCLE]:   'x',
    [DS2.SQUARE]:   'a',
    [DS2.TRIANGLE]: 's',
    [DS2.L1]:       'q',
    [DS2.R1]:       'w',
    [DS2.L2]:       'e',
    [DS2.R2]:       'r',
    [DS2.START]:    'Enter',
    [DS2.SELECT]:   'Backspace',
    [DS2.L3]:       'c',
    [DS2.R3]:       'v',
  },
  2: {
    [DS2.UP]:       'i',
    [DS2.DOWN]:     'k',
    [DS2.LEFT]:     'j',
    [DS2.RIGHT]:    'l',
    [DS2.CROSS]:    'n',
    [DS2.CIRCLE]:   'm',
    [DS2.SQUARE]:   'b',
    [DS2.TRIANGLE]: 'h',
    [DS2.L1]:       'y',
    [DS2.R1]:       'u',
    [DS2.L2]:       'o',
    [DS2.R2]:       'p',
    [DS2.START]:    '/',
    [DS2.SELECT]:   '.',
    [DS2.L3]:       ',',
    [DS2.R3]:       ';',
  }
};

class InputManager {
  constructor() {
    // Load or use defaults
    this.bindings = this._loadBindings();

    // Live pad state: 16-bit button word, 0=pressed
    this.padState = {
      1: { buttons: 0xFFFF, lx: 128, ly: 128, rx: 128, ry: 128 },
      2: { buttons: 0xFFFF, lx: 128, ly: 128, rx: 128, ry: 128 },
    };

    // Key state set
    this._held = new Set();

    // Reverse map: key → { player, button }
    this._keyMap = {};
    this._buildKeyMap();

    // Event listeners
    window.addEventListener('keydown', e => this._onKeyDown(e));
    window.addEventListener('keyup',   e => this._onKeyUp(e));

    // Gamepad polling
    this._gamepads = {};
    window.addEventListener('gamepadconnected',    e => this._onGamepad(e, true));
    window.addEventListener('gamepaddisconnected', e => this._onGamepad(e, false));

    Utils.info('INPUT', 'Input manager initialized');
  }

  // ── Key map rebuild ──────────────────────────────────────────────────────
  _buildKeyMap() {
    this._keyMap = {};
    for (const player of [1, 2]) {
      const b = this.bindings[player];
      for (const [btn, key] of Object.entries(b)) {
        this._keyMap[key] = { player, button: parseInt(btn) };
      }
    }
  }

  // ── Key events ───────────────────────────────────────────────────────────
  _onKeyDown(e) {
    if (this._held.has(e.key)) return;
    this._held.add(e.key);
    const m = this._keyMap[e.key];
    if (m) {
      this.padState[m.player].buttons &= ~(1 << m.button);
      e.preventDefault();
    }
  }

  _onKeyUp(e) {
    this._held.delete(e.key);
    const m = this._keyMap[e.key];
    if (m) {
      this.padState[m.player].buttons |= (1 << m.button);
    }
  }

  // ── Gamepad support ──────────────────────────────────────────────────────
  _onGamepad(e, connected) {
    if (connected) {
      this._gamepads[e.gamepad.index] = e.gamepad;
      Utils.info('INPUT', `Gamepad connected: "${e.gamepad.id}" idx=${e.gamepad.index}`);
    } else {
      delete this._gamepads[e.gamepad.index];
      Utils.info('INPUT', `Gamepad disconnected idx=${e.gamepad.index}`);
    }
  }

  pollGamepads() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (let i = 0; i < Math.min(pads.length, 2); i++) {
      const pad = pads[i];
      if (!pad) continue;
      const player = i + 1;
      const state  = this.padState[player];

      // Standard gamepad mapping (Xbox/generic layout)
      const btn = (idx) => pad.buttons[idx]?.pressed ?? false;
      state.buttons = 0xFFFF;
      if (btn(12))  state.buttons &= ~(1 << DS2.UP);
      if (btn(13))  state.buttons &= ~(1 << DS2.DOWN);
      if (btn(14))  state.buttons &= ~(1 << DS2.LEFT);
      if (btn(15))  state.buttons &= ~(1 << DS2.RIGHT);
      if (btn(0))   state.buttons &= ~(1 << DS2.CROSS);
      if (btn(1))   state.buttons &= ~(1 << DS2.CIRCLE);
      if (btn(2))   state.buttons &= ~(1 << DS2.SQUARE);
      if (btn(3))   state.buttons &= ~(1 << DS2.TRIANGLE);
      if (btn(4))   state.buttons &= ~(1 << DS2.L1);
      if (btn(5))   state.buttons &= ~(1 << DS2.R1);
      if (btn(6))   state.buttons &= ~(1 << DS2.L2);
      if (btn(7))   state.buttons &= ~(1 << DS2.R2);
      if (btn(8))   state.buttons &= ~(1 << DS2.SELECT);
      if (btn(9))   state.buttons &= ~(1 << DS2.START);
      if (btn(10))  state.buttons &= ~(1 << DS2.L3);
      if (btn(11))  state.buttons &= ~(1 << DS2.R3);

      // Analog sticks → 0–255 (128 = center)
      state.lx = Math.round((pad.axes[0] + 1) * 127.5);
      state.ly = Math.round((pad.axes[1] + 1) * 127.5);
      state.rx = Math.round((pad.axes[2] + 1) * 127.5);
      state.ry = Math.round((pad.axes[3] + 1) * 127.5);
    }
  }

  // ── Read pad state (called by emulator core) ─────────────────────────────
  getPad(player) {
    return this.padState[player] || this.padState[1];
  }

  // ── Binding management ────────────────────────────────────────────────────
  setBinding(player, button, key) {
    // Remove old mapping for this key
    for (const [btn, k] of Object.entries(this.bindings[player])) {
      if (k === key) delete this.bindings[player][btn];
    }
    this.bindings[player][button] = key;
    this._buildKeyMap();
  }

  resetBindings() {
    this.bindings = JSON.parse(JSON.stringify(DEFAULT_BINDINGS));
    this._buildKeyMap();
    this._saveBindings();
  }

  _loadBindings() {
    try {
      const raw = localStorage.getItem('ps2emu_bindings');
      if (raw) {
        const parsed = JSON.parse(raw);
        // Merge with defaults for any missing buttons
        return {
          1: Object.assign({}, DEFAULT_BINDINGS[1], parsed[1]),
          2: Object.assign({}, DEFAULT_BINDINGS[2], parsed[2]),
        };
      }
    } catch(e) {}
    return JSON.parse(JSON.stringify(DEFAULT_BINDINGS));
  }

  _saveBindings() {
    try {
      localStorage.setItem('ps2emu_bindings', JSON.stringify(this.bindings));
      Utils.info('INPUT', 'Bindings saved');
    } catch(e) {
      Utils.warn('INPUT', 'Could not save bindings: ' + e.message);
    }
  }

  saveBindings() { this._saveBindings(); }

  // ── Pretty key name ───────────────────────────────────────────────────────
  static prettyKey(key) {
    const map = {
      'ArrowUp': '↑', 'ArrowDown': '↓', 'ArrowLeft': '←', 'ArrowRight': '→',
      'Enter': '⏎', 'Backspace': '⌫', 'Escape': 'Esc', ' ': 'Space',
      'Control': 'Ctrl', 'Shift': '⇧', 'Alt': 'Alt', 'Tab': '↹',
    };
    return map[key] || key.toUpperCase();
  }

  reset() {
    this.padState[1].buttons = 0xFFFF;
    this.padState[2].buttons = 0xFFFF;
    this._held.clear();
  }
}
