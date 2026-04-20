/**
 * utils.js — Shared utility functions for PS2 Web Emulator
 */

"use strict";

const Utils = (() => {

  // ── Hex formatting ──────────────────────────────────────────────────────
  function hex8(n)  { return (n >>> 0).toString(16).padStart(8,  '0').toUpperCase(); }
  function hex16(n) { return (n >>> 0).toString(16).padStart(16, '0').toUpperCase(); }
  function hex2(n)  { return (n & 0xff).toString(16).padStart(2,  '0').toUpperCase(); }

  // ── Bit helpers ─────────────────────────────────────────────────────────
  function bit(n, pos) { return (n >>> pos) & 1; }
  function bits(n, hi, lo) { return (n >>> lo) & ((1 << (hi - lo + 1)) - 1); }
  function signExtend16(n) { return (n & 0x8000) ? (n | 0xffff0000) : (n & 0xffff); }
  function signExtend8(n)  { return (n & 0x80)   ? (n | 0xffffff00) : (n & 0xff); }

  // ── Logging ─────────────────────────────────────────────────────────────
  const LOG_LEVELS = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };
  let currentLevel = LOG_LEVELS.INFO;
  const logBuffer = [];
  const MAX_BUFFER = 500;

  function log(level, module, msg) {
    if (LOG_LEVELS[level] < currentLevel) return;
    const entry = `[${level}][${module}] ${msg}`;
    logBuffer.push(entry);
    if (logBuffer.length > MAX_BUFFER) logBuffer.shift();
    const el = document.getElementById('logOutput');
    if (el) {
      const line = document.createElement('div');
      line.className = `log-${level.toLowerCase()}`;
      line.style.color = level === 'ERROR' ? '#ff6060'
                       : level === 'WARN'  ? '#ffc060'
                       : level === 'DEBUG' ? '#6090ff'
                       : '#80f080';
      line.textContent = entry;
      el.appendChild(line);
      el.scrollTop = el.scrollHeight;
    }
  }

  const debug = (mod, msg) => log('DEBUG', mod, msg);
  const info  = (mod, msg) => log('INFO',  mod, msg);
  const warn  = (mod, msg) => log('WARN',  mod, msg);
  const error = (mod, msg) => log('ERROR', mod, msg);

  // ── Number formatting ───────────────────────────────────────────────────
  function formatSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes/1024).toFixed(1)} KB`;
    if (bytes < 1073741824) return `${(bytes/1048576).toFixed(1)} MB`;
    return `${(bytes/1073741824).toFixed(2)} GB`;
  }

  // ── Typed array helpers ─────────────────────────────────────────────────
  function u8(buf, offset)  { return buf[offset]; }
  function u16le(buf, off)  { return buf[off] | (buf[off+1] << 8); }
  function u32le(buf, off)  {
    return ((buf[off] | (buf[off+1]<<8) | (buf[off+2]<<16) | (buf[off+3]<<24)) >>> 0);
  }

  // ── Clamp ───────────────────────────────────────────────────────────────
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  return { hex8, hex16, hex2, bit, bits, signExtend16, signExtend8,
           debug, info, warn, error, LOG_LEVELS, formatSize,
           u8, u16le, u32le, clamp };
})();
