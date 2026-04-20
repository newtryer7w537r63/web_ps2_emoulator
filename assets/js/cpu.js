/**
 * cpu.js — MIPS R5900 Emotion Engine CPU
 *
 * The PS2's EE is a 128-bit MIPS-III derivative running at ~294 MHz.
 * Key differences from standard MIPS:
 *   • 128-bit general-purpose registers (lo64 / hi64)
 *   • Two floating-point units: FPU (COP1) and VU0/VU1
 *   • Multimedia instructions (SIMD on 128-bit regs)
 *   • TLB-based virtual memory
 */

"use strict";

class EECore {
  constructor(memory) {
    this.mem = memory;

    // ── General Purpose Registers (128-bit each, stored as lo/hi 32-bit pairs)
    // GPR[0] is always zero
    this.gpr = new Array(32).fill(null).map(() => ({ lo: new Uint32Array(2), hi: new Uint32Array(2) }));

    // ── Special registers
    this.pc  = 0x1FC00000;  // Boot vector (BIOS entry)
    this.npc = 0x1FC00004;  // Next PC (for branch delay slot)
    this.hi  = 0; this.hi1 = 0;
    this.lo  = 0; this.lo1 = 0;

    // ── COP0 (System control) registers
    this.cop0 = new Uint32Array(32);
    // COP0[12] = Status register
    this.cop0[12] = 0x00400000; // BEV=1 (bootstrap exception vector)
    // COP0[15] = PRId (processor ID)
    this.cop0[15] = 0x00002E20; // EE processor ID

    // ── FPU (COP1) registers
    this.fpr = new Float32Array(32);
    this.fpuAcc = 0;
    this.fpuCtrl = 0;

    // ── Cycle tracking
    this.cycles = 0;
    this.cyclesBudget = 0;

    // ── Branch delay
    this._branchDelay = false;
    this._branchTarget = 0;

    // ── Instruction decode table
    this._buildDecodeTable();

    Utils.info('EE', `CPU initialized, PC=0x${Utils.hex8(this.pc)}`);
  }

  // ── Register helpers ────────────────────────────────────────────────────
  getGPR32(r)    { return r === 0 ? 0 : this.gpr[r].lo[0]; }
  setGPR32(r, v) { if (r === 0) return; this.gpr[r].lo[0] = v >>> 0; this.gpr[r].lo[1] = (v & 0x80000000) ? 0xFFFFFFFF : 0; }
  getGPR64Lo(r)  { return r === 0 ? 0 : this.gpr[r].lo[0]; }
  getGPR64Hi(r)  { return r === 0 ? 0 : this.gpr[r].lo[1]; }

  // ── Run N cycles ────────────────────────────────────────────────────────
  step(cycles) {
    this.cyclesBudget = cycles;
    while (this.cyclesBudget > 0) {
      try {
        this._executeOne();
      } catch(e) {
        Utils.error('EE', `Exception at PC=0x${Utils.hex8(this.pc)}: ${e.message}`);
        this._raiseException(0x00); // General exception
        break;
      }
    }
  }

  _executeOne() {
    const instr = this.mem.read32(this.pc);

    // Advance PC before execution (branch delay handled separately)
    const curPC  = this.pc;
    this.pc      = this.npc;
    this.npc     = this.pc + 4;

    if (this._branchDelay) {
      this._branchDelay = false;
      this.npc = this._branchTarget;
    }

    this._dispatch(instr, curPC);
    this.cycles++;
    this.cyclesBudget--;
  }

  // ── Instruction dispatch ────────────────────────────────────────────────
  _dispatch(instr, pc) {
    const op  = (instr >>> 26) & 0x3F;
    const rs  = (instr >>> 21) & 0x1F;
    const rt  = (instr >>> 16) & 0x1F;
    const rd  = (instr >>> 11) & 0x1F;
    const sa  = (instr >>>  6) & 0x1F;
    const fn  = instr & 0x3F;
    const imm = instr & 0xFFFF;
    const simm = Utils.signExtend16(imm);
    const tgt = (instr & 0x03FFFFFF);

    switch (op) {
      case 0x00: this._special(fn, rs, rt, rd, sa, instr, pc); break;
      case 0x01: this._regimm(rt, rs, simm, pc); break;
      case 0x02: this._j  (tgt, pc); break;       // J
      case 0x03: this._jal(tgt, rt, pc); break;   // JAL
      case 0x04: this._beq (rs, rt, simm, pc); break;
      case 0x05: this._bne (rs, rt, simm, pc); break;
      case 0x06: this._blez(rs, simm, pc); break;
      case 0x07: this._bgtz(rs, simm, pc); break;
      case 0x08: this._addi (rt, rs, simm); break;
      case 0x09: this._addiu(rt, rs, simm); break;
      case 0x0A: this._slti (rt, rs, simm); break;
      case 0x0B: this._sltiu(rt, rs, imm);  break;
      case 0x0C: this._andi (rt, rs, imm);  break;
      case 0x0D: this._ori  (rt, rs, imm);  break;
      case 0x0E: this._xori (rt, rs, imm);  break;
      case 0x0F: this._lui  (rt, imm);      break;
      case 0x10: this._cop0 (rs, rt, rd, fn, instr); break;
      case 0x11: this._cop1 (rs, rt, rd, fn, sa, instr); break;
      case 0x14: this._beql (rs, rt, simm, pc); break;
      case 0x15: this._bnel (rs, rt, simm, pc); break;
      case 0x20: this._lb  (rt, rs, simm); break;
      case 0x21: this._lh  (rt, rs, simm); break;
      case 0x23: this._lw  (rt, rs, simm); break;
      case 0x24: this._lbu (rt, rs, simm); break;
      case 0x25: this._lhu (rt, rs, simm); break;
      case 0x28: this._sb  (rt, rs, simm); break;
      case 0x29: this._sh  (rt, rs, simm); break;
      case 0x2B: this._sw  (rt, rs, simm); break;
      case 0x37: this._ld  (rt, rs, simm); break;
      case 0x3F: this._sd  (rt, rs, simm); break;
      case 0x1A: this._ldl (rt, rs, simm); break;
      case 0x1B: this._ldr (rt, rs, simm); break;
      default:
        Utils.warn('EE', `Unimplemented opcode 0x${op.toString(16).padStart(2,'0')} @ 0x${Utils.hex8(pc)}`);
    }
  }

  // ── SPECIAL (opcode 0x00) ───────────────────────────────────────────────
  _special(fn, rs, rt, rd, sa, instr, pc) {
    switch (fn) {
      case 0x00: this.setGPR32(rd, this.getGPR32(rt) << sa); break;             // SLL
      case 0x02: this.setGPR32(rd, this.getGPR32(rt) >>> sa); break;            // SRL
      case 0x03: this.setGPR32(rd, this.getGPR32(rt) >> sa); break;             // SRA
      case 0x04: this.setGPR32(rd, this.getGPR32(rt) << (this.getGPR32(rs)&31)); break; // SLLV
      case 0x06: this.setGPR32(rd, this.getGPR32(rt) >>> (this.getGPR32(rs)&31)); break;// SRLV
      case 0x07: this.setGPR32(rd, this.getGPR32(rt) >> (this.getGPR32(rs)&31)); break; // SRAV
      case 0x08: this._jr (rs, pc); break;
      case 0x09: this._jalr(rs, rd, pc); break;
      case 0x0C: this._syscall(instr, pc); break;
      case 0x0F: /* SYNC */ break;
      case 0x10: this.setGPR32(rd, this.hi); break;  // MFHI
      case 0x11: this.hi = this.getGPR32(rs); break; // MTHI
      case 0x12: this.setGPR32(rd, this.lo); break;  // MFLO
      case 0x13: this.lo = this.getGPR32(rs); break; // MTLO
      case 0x18: this._mult (rs, rt); break;
      case 0x19: this._multu(rs, rt); break;
      case 0x1A: this._div  (rs, rt); break;
      case 0x1B: this._divu (rs, rt); break;
      case 0x20: this.setGPR32(rd, (this.getGPR32(rs) + this.getGPR32(rt)) | 0); break; // ADD
      case 0x21: this.setGPR32(rd, (this.getGPR32(rs) + this.getGPR32(rt)) | 0); break; // ADDU
      case 0x22: this.setGPR32(rd, (this.getGPR32(rs) - this.getGPR32(rt)) | 0); break; // SUB
      case 0x23: this.setGPR32(rd, (this.getGPR32(rs) - this.getGPR32(rt)) | 0); break; // SUBU
      case 0x24: this.setGPR32(rd, this.getGPR32(rs) & this.getGPR32(rt)); break;        // AND
      case 0x25: this.setGPR32(rd, this.getGPR32(rs) | this.getGPR32(rt)); break;        // OR
      case 0x26: this.setGPR32(rd, this.getGPR32(rs) ^ this.getGPR32(rt)); break;        // XOR
      case 0x27: this.setGPR32(rd, ~(this.getGPR32(rs) | this.getGPR32(rt))); break;     // NOR
      case 0x2A: this.setGPR32(rd, ((this.getGPR32(rs)|0) < (this.getGPR32(rt)|0)) ? 1 : 0); break; // SLT
      case 0x2B: this.setGPR32(rd, (this.getGPR32(rs) >>> 0) < (this.getGPR32(rt) >>> 0) ? 1 : 0); break; // SLTU
      default:
        Utils.warn('EE', `SPECIAL fn=0x${fn.toString(16)} unimplemented @ 0x${Utils.hex8(pc)}`);
    }
  }

  // ── REGIMM (opcode 0x01) ────────────────────────────────────────────────
  _regimm(rt, rs, simm, pc) {
    const rsv = this.getGPR32(rs) | 0;
    switch (rt) {
      case 0x00: if (rsv <  0) this._branch(simm, pc); break; // BLTZ
      case 0x01: if (rsv >= 0) this._branch(simm, pc); break; // BGEZ
      case 0x10: if (rsv <  0) { this.setGPR32(31, pc+8); this._branch(simm, pc); } break; // BLTZAL
      case 0x11: if (rsv >= 0) { this.setGPR32(31, pc+8); this._branch(simm, pc); } break; // BGEZAL
    }
  }

  // ── Branch/Jump helpers ─────────────────────────────────────────────────
  _branch(simm, pc) {
    this._branchDelay  = true;
    this._branchTarget = (pc + 4) + (simm << 2);
  }
  _j(tgt, pc)       { this._branchDelay = true; this._branchTarget = ((pc & 0xF0000000) | (tgt << 2)); }
  _jal(tgt, rt, pc) { this.setGPR32(31, pc + 8); this._j(tgt, pc); }
  _jr(rs, pc)       { this._branchDelay = true; this._branchTarget = this.getGPR32(rs); }
  _jalr(rs, rd, pc) { this.setGPR32(rd, pc + 8); this._jr(rs, pc); }

  _beq (rs, rt, simm, pc) { if (this.getGPR32(rs) === this.getGPR32(rt)) this._branch(simm, pc); }
  _bne (rs, rt, simm, pc) { if (this.getGPR32(rs) !== this.getGPR32(rt)) this._branch(simm, pc); }
  _blez(rs, simm, pc)     { if ((this.getGPR32(rs)|0) <= 0) this._branch(simm, pc); }
  _bgtz(rs, simm, pc)     { if ((this.getGPR32(rs)|0) >  0) this._branch(simm, pc); }
  _beql(rs, rt, simm, pc) { if (this.getGPR32(rs) === this.getGPR32(rt)) this._branch(simm, pc); else this.pc += 4; }
  _bnel(rs, rt, simm, pc) { if (this.getGPR32(rs) !== this.getGPR32(rt)) this._branch(simm, pc); else this.pc += 4; }

  // ── ALU immediate ───────────────────────────────────────────────────────
  _addi (rt, rs, s) { this.setGPR32(rt, (this.getGPR32(rs) + s) | 0); }
  _addiu(rt, rs, s) { this.setGPR32(rt, (this.getGPR32(rs) + s) | 0); }
  _slti (rt, rs, s) { this.setGPR32(rt, ((this.getGPR32(rs)|0) < s) ? 1 : 0); }
  _sltiu(rt, rs, s) { this.setGPR32(rt, (this.getGPR32(rs)>>>0) < (s>>>0) ? 1 : 0); }
  _andi (rt, rs, u) { this.setGPR32(rt, this.getGPR32(rs) & u); }
  _ori  (rt, rs, u) { this.setGPR32(rt, this.getGPR32(rs) | u); }
  _xori (rt, rs, u) { this.setGPR32(rt, this.getGPR32(rs) ^ u); }
  _lui  (rt, u)     { this.setGPR32(rt, u << 16); }

  // ── Multiply/Divide ─────────────────────────────────────────────────────
  _mult(rs, rt) {
    const r = Math.imul(this.getGPR32(rs)|0, this.getGPR32(rt)|0);
    this.lo = r | 0; this.hi = 0; // simplified (full 64-bit needs BigInt)
  }
  _multu(rs, rt) {
    const r = (this.getGPR32(rs)>>>0) * (this.getGPR32(rt)>>>0);
    this.lo = (r >>> 0) | 0; this.hi = Math.floor(r / 4294967296) | 0;
  }
  _div(rs, rt) {
    const a = this.getGPR32(rs)|0, b = this.getGPR32(rt)|0;
    if (b === 0) { this.lo = a >= 0 ? -1 : 1; this.hi = a; return; }
    this.lo = (a / b) | 0; this.hi = a % b;
  }
  _divu(rs, rt) {
    const a = this.getGPR32(rs)>>>0, b = this.getGPR32(rt)>>>0;
    if (b === 0) { this.lo = 0xFFFFFFFF; this.hi = a; return; }
    this.lo = (a / b) | 0; this.hi = a % b;
  }

  // ── Load/Store ──────────────────────────────────────────────────────────
  _lb (rt, rs, s) { this.setGPR32(rt, Utils.signExtend8(this.mem.read8(this.getGPR32(rs)+s))); }
  _lbu(rt, rs, s) { this.setGPR32(rt, this.mem.read8(this.getGPR32(rs)+s) & 0xFF); }
  _lh (rt, rs, s) { this.setGPR32(rt, Utils.signExtend16(this.mem.read16(this.getGPR32(rs)+s))); }
  _lhu(rt, rs, s) { this.setGPR32(rt, this.mem.read16(this.getGPR32(rs)+s) & 0xFFFF); }
  _lw (rt, rs, s) { this.setGPR32(rt, this.mem.read32(this.getGPR32(rs)+s)); }
  _ld (rt, rs, s) {
    const addr = this.getGPR32(rs)+s;
    const q = this.mem.read64(addr);
    this.gpr[rt].lo[0] = q.lo; this.gpr[rt].lo[1] = q.hi;
  }
  _ldl(rt, rs, s) { /* Load Doubleword Left — simplified */ this._ld(rt, rs, s); }
  _ldr(rt, rs, s) { /* Load Doubleword Right — simplified */ }

  _sb(rt, rs, s) { this.mem.write8 (this.getGPR32(rs)+s, this.getGPR32(rt)); }
  _sh(rt, rs, s) { this.mem.write16(this.getGPR32(rs)+s, this.getGPR32(rt)); }
  _sw(rt, rs, s) { this.mem.write32(this.getGPR32(rs)+s, this.getGPR32(rt)); }
  _sd(rt, rs, s) {
    const addr = this.getGPR32(rs)+s;
    this.mem.write64(addr, this.gpr[rt].lo[0], this.gpr[rt].lo[1]);
  }

  // ── COP0 ────────────────────────────────────────────────────────────────
  _cop0(rs, rt, rd, fn, instr) {
    switch (rs) {
      case 0x00: this.setGPR32(rt, this.cop0[rd]); break; // MFC0
      case 0x04: this.cop0[rd] = this.getGPR32(rt); break; // MTC0
      case 0x10: // CO — TLBWI, ERET, etc.
        if (fn === 0x18) this._eret(); // ERET
        break;
    }
  }

  _eret() {
    if (this.cop0[12] & (1<<2)) { // ERL
      this.pc  = this.cop0[30]; // ErrorEPC
      this.cop0[12] &= ~(1<<2);
    } else {
      this.pc  = this.cop0[14]; // EPC
      this.cop0[12] &= ~(1<<1); // clear EXL
    }
    this.npc = this.pc + 4;
    Utils.debug('EE', `ERET → 0x${Utils.hex8(this.pc)}`);
  }

  // ── COP1 / FPU ──────────────────────────────────────────────────────────
  _cop1(rs, rt, rd, fn, sa, instr) {
    // Minimal FPU stubs
    switch (rs) {
      case 0x00: this.setGPR32(rt, new Uint32Array(new Float32Array([this.fpr[rd]]).buffer)[0]); break; // MFC1
      case 0x04: { const f32 = new Float32Array(new Uint32Array([this.getGPR32(rt)]).buffer); this.fpr[rd] = f32[0]; } break; // MTC1
    }
  }

  // ── System call / exception ─────────────────────────────────────────────
  _syscall(instr, pc) {
    const code = (instr >> 6) & 0xFFFFF;
    Utils.debug('EE', `SYSCALL 0x${code.toString(16)} @ 0x${Utils.hex8(pc)}`);
    this._raiseException(0x08);
  }

  _raiseException(cause) {
    this.cop0[14] = this.pc; // EPC = current PC
    this.cop0[13] = (cause << 2) & 0x7C; // Cause register
    this.cop0[12] |= (1<<1); // set EXL
    // Exception vector
    const bev = (this.cop0[12] >> 22) & 1;
    this.pc  = bev ? 0xBFC00380 : 0x80000080;
    this.npc = this.pc + 4;
    this._branchDelay = false;
  }

  _buildDecodeTable() {
    // Lookup tables could be built here for JIT-style dispatch
    // (used by the interpreter; a dynarec would compile to JS functions)
  }

  reset() {
    this.pc  = 0x1FC00000;
    this.npc = 0x1FC00004;
    this.cycles = 0;
    this._branchDelay = false;
    for (let i = 0; i < 32; i++) {
      this.gpr[i].lo.fill(0);
      this.gpr[i].hi.fill(0);
    }
    this.cop0.fill(0);
    this.cop0[12] = 0x00400000;
    this.cop0[15] = 0x00002E20;
    this.fpr.fill(0);
    Utils.info('EE', 'CPU reset');
  }

  // ── Debug snapshot ──────────────────────────────────────────────────────
  snapshot() {
    return {
      pc:  this.pc,
      sp:  this.getGPR32(29),
      ra:  this.getGPR32(31),
      v0:  this.getGPR32(2),
      v1:  this.getGPR32(3),
      a0:  this.getGPR32(4),
      a1:  this.getGPR32(5),
    };
  }
}
