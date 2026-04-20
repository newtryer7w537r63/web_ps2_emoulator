/**
 * disc.js — PS2 Disc Image Reader
 *
 * Supports:
 *   - ISO 9660 (standard .iso files)
 *   - Raw binary (.bin / .img with 2352-byte sectors)
 *   - Reads the PS2 System.cnf and ELF executable
 */

"use strict";

class DiscReader {
  constructor() {
    this.data   = null;   // Uint8Array of the full disc image
    this.name   = '';
    this.size   = 0;
    this.type   = 'none'; // 'iso' | 'bin' | 'img'

    this.sectorSize  = 2048; // ISO 9660 default
    this.sectorCount = 0;

    // ISO 9660 parsed fields
    this.volumeLabel = '';
    this.rootDir     = null;
    this.files       = {};   // path → { sector, size }

    // PS2-specific
    this.systemCnf   = null; // parsed SYSTEM.CNF
    this.bootPath    = '';   // e.g. "cdrom0:\\SLUS_200.01;1"
    this.gameID      = '';   // e.g. "SLUS-20001"

    Utils.info('DISC', 'Disc reader ready');
  }

  // ── Load from ArrayBuffer (called after file upload) ─────────────────────
  async load(arrayBuffer, filename) {
    this.data     = new Uint8Array(arrayBuffer);
    this.name     = filename;
    this.size     = this.data.length;
    this.type     = filename.toLowerCase().endsWith('.bin') ? 'bin' : 'iso';

    // BIN images use 2352-byte raw sectors
    if (this.type === 'bin') {
      this.sectorSize  = 2352;
      this.dataOffset  = 24; // sync + header bytes before data
    } else {
      this.sectorSize  = 2048;
      this.dataOffset  = 0;
    }

    this.sectorCount = Math.floor(this.size / this.sectorSize);
    Utils.info('DISC', `Loaded: ${filename} (${Utils.formatSize(this.size)}, ${this.sectorCount} sectors)`);

    // Parse ISO 9660 filesystem
    try {
      this._parseISO();
    } catch(e) {
      Utils.warn('DISC', `ISO parse failed: ${e.message}`);
      return false;
    }

    return true;
  }

  // ── Raw sector read ──────────────────────────────────────────────────────
  readSector(lba) {
    const off = lba * this.sectorSize + this.dataOffset;
    if (off + 2048 > this.data.length) return new Uint8Array(2048);
    return this.data.slice(off, off + 2048);
  }

  // ── ISO 9660 parser ───────────────────────────────────────────────────────
  _parseISO() {
    // Volume Descriptor at LBA 16
    const pvd = this.readSector(16);

    // Check descriptor type (1 = Primary Volume Descriptor)
    if (pvd[0] !== 1) throw new Error('Not a valid ISO 9660 image');
    // Check standard identifier "CD001"
    const ident = String.fromCharCode(pvd[1], pvd[2], pvd[3], pvd[4], pvd[5]);
    if (ident !== 'CD001') throw new Error(`Invalid ISO identifier: "${ident}"`);

    this.volumeLabel = this._readString(pvd, 40, 32).trim();
    const rootDirEntry = pvd.slice(156, 190);
    const rootLBA  = Utils.u32le(rootDirEntry, 2);
    const rootSize = Utils.u32le(rootDirEntry, 10);
    this.rootDir = { lba: rootLBA, size: rootSize };

    Utils.info('DISC', `Volume: "${this.volumeLabel}", root LBA=${rootLBA}`);

    // Walk root directory
    this._walkDir(rootLBA, rootSize, '');

    // Read SYSTEM.CNF
    if (this.files['SYSTEM.CNF']) {
      this._parseSystemCNF();
    } else if (this.files['system.cnf']) {
      this._parseSystemCNF('system.cnf');
    } else {
      Utils.warn('DISC', 'SYSTEM.CNF not found — may not be a PS2 disc');
    }
  }

  _walkDir(lba, size, prefix) {
    let off = 0;
    const data = this.readSector(lba);

    while (off < Math.min(size, 2048)) {
      const recLen = data[off];
      if (recLen === 0) { off += 2; continue; } // padding
      if (off + recLen > 2048) break;

      const flags      = data[off + 25];
      const fileLBA    = Utils.u32le(data, off + 2);
      const fileSize   = Utils.u32le(data, off + 10);
      const nameLen    = data[off + 32];
      let   name       = '';
      for (let i = 0; i < nameLen; i++) name += String.fromCharCode(data[off + 33 + i]);

      // Strip ISO 9660 version suffix ";1"
      name = name.replace(/;.*$/, '');

      if (name !== '.' && name !== '\x00' && name !== '\x01') {
        const fullPath = prefix ? `${prefix}/${name}` : name;
        if (flags & 0x02) {
          // Directory — recurse (one level deep for now)
          this._walkDir(fileLBA, fileSize, fullPath);
        } else {
          this.files[name] = this.files[fullPath] = { lba: fileLBA, size: fileSize };
        }
      }
      off += recLen;
    }
  }

  _parseSystemCNF(key = 'SYSTEM.CNF') {
    const f = this.files[key];
    if (!f) return;
    const sectors = Math.ceil(f.size / 2048);
    let raw = '';
    for (let i = 0; i < sectors; i++) {
      const sec = this.readSector(f.lba + i);
      for (let b = 0; b < Math.min(2048, f.size - i*2048); b++) {
        raw += String.fromCharCode(sec[b]);
      }
    }
    this.systemCnf = {};
    for (const line of raw.split('\n')) {
      const m = line.match(/^\s*(\w+)\s*=\s*(.+)/);
      if (m) this.systemCnf[m[1].trim()] = m[2].trim();
    }
    this.bootPath = this.systemCnf['BOOT2'] || this.systemCnf['BOOT'] || '';
    // Extract game ID from boot path e.g. "cdrom0:\\SLUS_200.01;1" → "SLUS-20001"
    const gm = this.bootPath.match(/([A-Z]{4})_(\d{3})\.(\d{2})/);
    if (gm) this.gameID = `${gm[1]}-${gm[2]}${gm[3]}`;
    Utils.info('DISC', `SYSTEM.CNF parsed. BOOT2=${this.bootPath}, GameID=${this.gameID}`);
  }

  // ── Read a file from the disc ─────────────────────────────────────────────
  readFile(name) {
    const f = this.files[name.toUpperCase()] || this.files[name];
    if (!f) { Utils.warn('DISC', `File not found: ${name}`); return null; }
    const out = new Uint8Array(f.size);
    const sectors = Math.ceil(f.size / 2048);
    for (let i = 0; i < sectors; i++) {
      const sec = this.readSector(f.lba + i);
      const chunk = Math.min(2048, f.size - i*2048);
      out.set(sec.subarray(0, chunk), i*2048);
    }
    return out;
  }

  // ── ELF loader ────────────────────────────────────────────────────────────
  loadELF(memory) {
    // Extract filename from BOOT2 path
    const m = this.bootPath.match(/\\([^\\;]+)/);
    if (!m) { Utils.error('DISC', 'Cannot parse ELF path from: ' + this.bootPath); return 0; }
    const elfName = m[1].replace(/;.*$/, '');
    const elf = this.readFile(elfName);
    if (!elf) { Utils.error('DISC', `ELF not found: ${elfName}`); return 0; }
    return this._parseELF(elf, memory);
  }

  _parseELF(data, memory) {
    const view = new DataView(data.buffer);
    // Magic: 0x7F 'E' 'L' 'F'
    if (view.getUint32(0) !== 0x7F454C46) {
      Utils.error('DISC', 'Invalid ELF magic');
      return 0;
    }
    const e_entry = view.getUint32(24, true); // Entry point
    const e_phoff = view.getUint32(28, true); // Program header offset
    const e_phnum = view.getUint16(44, true); // Number of program headers

    Utils.info('DISC', `ELF entry=0x${Utils.hex8(e_entry)}, ${e_phnum} segments`);

    for (let i = 0; i < e_phnum; i++) {
      const ph = e_phoff + i * 32;
      const p_type   = view.getUint32(ph,    true);
      const p_offset = view.getUint32(ph+4,  true);
      const p_vaddr  = view.getUint32(ph+8,  true);
      const p_filesz = view.getUint32(ph+16, true);
      const p_memsz  = view.getUint32(ph+20, true);

      if (p_type !== 1) continue; // PT_LOAD only
      Utils.info('DISC', `  LOAD seg vaddr=0x${Utils.hex8(p_vaddr)} filesz=${Utils.formatSize(p_filesz)}`);
      memory.loadIntoRAM(data.subarray(p_offset, p_offset + p_filesz), p_vaddr);
    }
    return e_entry;
  }

  _readString(buf, off, len) {
    let s = '';
    for (let i = 0; i < len; i++) s += String.fromCharCode(buf[off+i]);
    return s;
  }

  listFiles() { return Object.keys(this.files); }

  reset() {
    this.data = null;
    this.files = {};
    this.systemCnf = null;
    this.bootPath = '';
    this.gameID = '';
  }
}
