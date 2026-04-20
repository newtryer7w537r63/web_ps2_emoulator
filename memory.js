/**
 * memory.js — PS2 Memory Map
 *
 * PS2 Memory Layout:
 *   0x00000000 – 0x01FFFFFF  EE RAM (32 MB)
 *   0x1FC00000 – 0x1FFFFFFF  BIOS ROM (4 MB)
 *   0x10000000 – 0x1000FFFF  EE Registers (hardware)
 *   0x12000000 – 0x12001FFF  GS Registers (privileged)
 *   0x70000000 – 0x70003FFF  Scratchpad RAM (16 KB)
 */

"use strict";

class Memory {
  constructor() {
    // Main EE RAM: 32 MB
    this.ram    = new Uint8Array(32 * 1024 * 1024);
    // BIOS ROM placeholder (4 MB)
    this.bios   = new Uint8Array(4 * 1024 * 1024);
    // Scratchpad RAM: 16 KB
    this.spad   = new Uint8Array(16 * 1024);
    // IOP RAM: 2 MB
    this.iopRam = new Uint8Array(2 * 1024 * 1024);

    // Hardware register banks (word-indexed)
    this.hwRegs  = new Uint32Array(0x10000 / 4);
    this.gsRegs  = new Uint32Array(0x2000  / 4);

    this._initBIOS();
    Utils.info('MEM', 'Memory subsystem initialized (32 MB EE RAM)');
  }

  _initBIOS() {
    // Minimal BIOS stub — jump to a no-op loop so the CPU doesn't fault
    // Real emulation requires a BIOS dump (PS2BIOS.bin)
    const view = new DataView(this.bios.buffer);
    // 0x1FC00000 → physical offset 0 in bios array
    // Write MIPS: j 0x1FC00000 (infinite loop as placeholder)
    view.setUint32(0, 0x08000000 | ((0x1FC00000 >> 2) & 0x3FFFFFF), true); // J instruction
    view.setUint32(4, 0x00000000, true); // NOP (branch delay slot)
    Utils.debug('MEM', 'BIOS stub written at 0x1FC00000');
  }

  // ── Physical address resolver ──────────────────────────────────────────
  _resolve(addr) {
    addr = addr >>> 0; // force unsigned
    // Kuseg / Kseg0 / Kseg1 mask (strip top 3 bits for KSEG)
    const phys = addr & 0x1FFFFFFF;

    if (phys < 0x02000000)             return { buf: this.ram,    off: phys,           rw: true  };
    if (phys >= 0x1FC00000)            return { buf: this.bios,   off: phys - 0x1FC00000, rw: false };
    if (phys >= 0x10000000 && phys < 0x10010000) return { buf: null, off: phys, rw: true, hw: true };
    if (phys >= 0x12000000 && phys < 0x12002000) return { buf: null, off: phys, rw: true, gs: true };
    if (phys >= 0x70000000 && phys < 0x70004000) return { buf: this.spad, off: phys - 0x70000000, rw: true };

    return null;
  }

  // ── Byte read / write ───────────────────────────────────────────────────
  read8(addr) {
    const r = this._resolve(addr);
    if (!r) { Utils.warn('MEM', `Unmapped read8  @ 0x${Utils.hex8(addr)}`); return 0xFF; }
    if (r.hw) return this._readHW8(addr);
    return r.buf[r.off];
  }

  write8(addr, val) {
    const r = this._resolve(addr);
    if (!r)     { Utils.warn('MEM', `Unmapped write8 @ 0x${Utils.hex8(addr)}`); return; }
    if (!r.rw)  { Utils.warn('MEM', `Write to ROM    @ 0x${Utils.hex8(addr)}`); return; }
    if (r.hw)   { this._writeHW8(addr, val); return; }
    r.buf[r.off] = val & 0xFF;
  }

  // ── 16-bit ─────────────────────────────────────────────────────────────
  read16(addr) {
    const r = this._resolve(addr);
    if (!r) { Utils.warn('MEM', `Unmapped read16 @ 0x${Utils.hex8(addr)}`); return 0xFFFF; }
    if (r.hw) return this._readHW16(addr);
    const v = new DataView(r.buf.buffer, r.buf.byteOffset + r.off, 2);
    return v.getUint16(0, true);
  }

  write16(addr, val) {
    const r = this._resolve(addr);
    if (!r || !r.rw) return;
    if (r.hw) { this._writeHW16(addr, val); return; }
    const v = new DataView(r.buf.buffer, r.buf.byteOffset + r.off, 2);
    v.setUint16(0, val & 0xFFFF, true);
  }

  // ── 32-bit ─────────────────────────────────────────────────────────────
  read32(addr) {
    const r = this._resolve(addr);
    if (!r) { Utils.warn('MEM', `Unmapped read32 @ 0x${Utils.hex8(addr)}`); return 0xFFFFFFFF; }
    if (r.hw) return this._readHW32(addr);
    if (r.gs) return this._readGS32(addr);
    const v = new DataView(r.buf.buffer, r.buf.byteOffset + r.off, 4);
    return v.getUint32(0, true);
  }

  write32(addr, val) {
    const r = this._resolve(addr);
    if (!r || !r.rw) return;
    if (r.hw) { this._writeHW32(addr, val); return; }
    if (r.gs) { this._writeGS32(addr, val); return; }
    const v = new DataView(r.buf.buffer, r.buf.byteOffset + r.off, 4);
    v.setUint32(0, val >>> 0, true);
  }

  // ── 64-bit ─────────────────────────────────────────────────────────────
  read64(addr) {
    return { lo: this.read32(addr), hi: this.read32(addr + 4) };
  }

  write64(addr, lo, hi) {
    this.write32(addr,     lo >>> 0);
    this.write32(addr + 4, hi >>> 0);
  }

  // ── 128-bit (quadword) ─────────────────────────────────────────────────
  read128(addr) {
    return [
      this.read32(addr),
      this.read32(addr + 4),
      this.read32(addr + 8),
      this.read32(addr + 12)
    ];
  }

  write128(addr, words) {
    for (let i = 0; i < 4; i++) this.write32(addr + i*4, words[i] >>> 0);
  }

  // ── Hardware register stubs ─────────────────────────────────────────────
  _readHW8(addr)      { return 0xFF; }
  _readHW16(addr)     { return 0xFFFF; }
  _readHW32(addr) {
    const idx = ((addr & 0xFFFF) >> 2);
    return this.hwRegs[idx] >>> 0;
  }
  _writeHW8(addr, v)  { }
  _writeHW16(addr, v) { }
  _writeHW32(addr, v) {
    const idx = ((addr & 0xFFFF) >> 2);
    this.hwRegs[idx] = v >>> 0;
    // Intercept known registers
    this._hwRegWrite(addr & 0xFFFF, v >>> 0);
  }

  _hwRegWrite(offset, val) {
    switch (offset) {
      case 0xE010: // D_CTRL — DMA control
        Utils.debug('MEM', `DMA CTRL write: 0x${Utils.hex8(val)}`);
        break;
      default: break;
    }
  }

  _readGS32(addr)    { const i = ((addr & 0x1FFF) >> 2); return this.gsRegs[i]; }
  _writeGS32(addr, v){ const i = ((addr & 0x1FFF) >> 2); this.gsRegs[i] = v >>> 0; }

  // ── Bulk load ───────────────────────────────────────────────────────────
  loadIntoRAM(data, baseAddr) {
    const base = baseAddr >>> 0;
    const phys  = base & 0x1FFFFFFF;
    if (phys + data.length > this.ram.length) {
      Utils.error('MEM', 'loadIntoRAM: data exceeds RAM bounds');
      return;
    }
    this.ram.set(data, phys);
    Utils.info('MEM', `Loaded ${Utils.formatSize(data.length)} @ 0x${Utils.hex8(base)}`);
  }

  reset() {
    this.ram.fill(0);
    this.spad.fill(0);
    this.hwRegs.fill(0);
    this.gsRegs.fill(0);
    this._initBIOS();
    Utils.info('MEM', 'Memory reset');
  }
}
