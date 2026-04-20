/**
 * iop.js — I/O Processor (IOP)
 *
 * The IOP is a MIPS R3000A running at ~36 MHz.
 * It handles: CD/DVD, memory cards, USB, FireWire, SPU2 (audio),
 * SIO2 (controllers), and compatibility with PS1 games.
 *
 * This is a simplified IOP stub. A full implementation requires
 * loading the IOP firmware from the PS2 BIOS and running it in parallel.
 */

"use strict";

class IOP {
  constructor(memory) {
    this.mem = memory;

    // IOP has its own 2 MB RAM (separate from EE RAM)
    this.ram = memory.iopRam;

    // IOP registers (simplified)
    this.pc = 0xBFC00000; // IOP boot vector
    this.gpr = new Int32Array(32);
    this.hi  = 0;
    this.lo  = 0;
    this.cop0 = new Uint32Array(32);

    // ── SPU2 audio state
    this.spu2 = {
      enabled: false,
      masterVolL: 0x3FFF,
      masterVolR: 0x3FFF,
      voices: new Array(48).fill(null).map(() => ({
        pitchLFO: 0,
        startAddr: 0,
        loopAddr: 0,
        curAddr: 0,
        adsr: 0,
        volL: 0, volR: 0
      }))
    };

    // ── SIO2 controller interface
    this.sio2 = {
      send: new Uint8Array(256),
      recv: new Uint8Array(256),
      sendIdx: 0, recvIdx: 0
    };

    // ── CDVD interface bridge
    this.cdvd = {
      status: 0x40, // ready
      type: 0x12,   // PS2 DVD
      discPresent: false
    };

    Utils.info('IOP', 'I/O Processor initialized');
  }

  // ── Run N simplified IOP cycles ─────────────────────────────────────────
  step(cycles) {
    // In a real emulator, the IOP executes its own MIPS code here.
    // We stub it: just process pending IRQ/events.
    this._processSPU2(cycles);
    this._processSIO2();
  }

  // ── SPU2 audio processing ────────────────────────────────────────────────
  _processSPU2(cycles) {
    if (!this.spu2.enabled) return;
    // TODO: Mix 48 voice channels into an audio output buffer.
    // Each voice has an ADSR envelope and a looping sample in SPU2 RAM.
    // Real SPU2 emulation: mix at 48 kHz and feed to Web Audio API.
  }

  // ── Controller (SIO2) polling ────────────────────────────────────────────
  _processSIO2() {
    // The SIO2 DMA transfers pad data to EE.
    // Our input.js writes to a shared state; IOP reads it here.
  }

  // ── CDVD register handler ────────────────────────────────────────────────
  readCDVD(reg) {
    switch (reg & 0xFF) {
      case 0x04: return this.cdvd.type;
      case 0x05: return this.cdvd.status;
      case 0x0F: return 0x00; // mechanical con
      default:   return 0xFF;
    }
  }

  writeCDVD(reg, val) {
    switch (reg & 0xFF) {
      case 0x05: // N-command
        this._cdvdCommand(val);
        break;
    }
  }

  _cdvdCommand(cmd) {
    switch (cmd) {
      case 0x00: Utils.debug('IOP', 'CDVD: NOP'); break;
      case 0x01: Utils.debug('IOP', 'CDVD: GetMechCon'); break;
      case 0x02: Utils.debug('IOP', 'CDVD: GetDiscType'); break;
      default:   Utils.debug('IOP', `CDVD: unknown cmd 0x${Utils.hex2(cmd)}`); break;
    }
  }

  // ── Timer / interrupt helpers ────────────────────────────────────────────
  raiseIRQ(irqLine) {
    Utils.debug('IOP', `IRQ ${irqLine} raised`);
    // Set bit in I_STAT, trigger EE INT1 if IOP→EE INTC enabled
  }

  reset() {
    this.pc = 0xBFC00000;
    this.gpr.fill(0);
    this.hi = 0; this.lo = 0;
    this.spu2.enabled = false;
    this.cdvd.discPresent = false;
    Utils.info('IOP', 'Reset');
  }
}
