/**
 * gs_renderer.js — PS2 Graphics Synthesizer (GS) Renderer
 *
 * The PS2 GS is a dedicated rasterizer chip with:
 *   • 4 MB of embedded VRAM (eDRAM)
 *   • Hardware alpha blending, fogging, texture mapping
 *   • Render targets: 320×240 to 1280×1024
 *   • Pixel formats: PSMCT32, PSMCT24, PSMCT16, PSMT8, PSMT4
 *
 * This renderer uses WebGL2 for hardware-accelerated output.
 */

"use strict";

class GSRenderer {
  constructor(canvas) {
    this.canvas = canvas;

    // Try WebGL2 first, fall back to WebGL1
    this.gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!this.gl) throw new Error('WebGL not supported');
    this.isGL2 = !!(canvas.getContext('webgl2'));

    // ── GS VRAM: 4 MB
    this.vram = new Uint8Array(4 * 1024 * 1024);

    // ── GS Registers (64-bit each, stored as lo/hi Uint32)
    this.regs = new Array(0x80).fill(null).map(() => ({ lo: 0, hi: 0 }));

    // ── GS Privileged registers (PMODE, SMODE2, etc.)
    this.PMODE  = 0;
    this.SMODE2 = 0; // interlacing info
    this.DISPFB1 = 0;
    this.DISPLAY1 = 0;

    // ── Render state
    this.scissor = { x1: 0, y1: 0, x2: 639, y2: 447 };
    this.xyoffset = { x: 0, y: 0 };
    this.frame = { base: 0, width: 10, format: 0 };
    this.zbuf  = { base: 0, format: 0, mask: 0 };
    this.tex0  = { base: 0, width: 0, format: 0, tw: 0, th: 0 };
    this.alpha = { a: 0, b: 0, c: 0, d: 0, fix: 0x80 };

    // ── WebGL resources
    this._initGL();
    this._createFramebuffer();

    // ── Vertex buffer for batched primitives
    this.vtxBuf  = [];
    this.vtxMax  = 6 * 4096; // ~4K quads

    // ── Frame statistics
    this.drawCalls = 0;
    this.frameCount = 0;

    Utils.info('GS', `Renderer initialized (${this.isGL2 ? 'WebGL2' : 'WebGL1'}), canvas ${canvas.width}×${canvas.height}`);
  }

  // ── GL init ─────────────────────────────────────────────────────────────
  _initGL() {
    const gl = this.gl;

    // ── Vertex shader
    const vsrc = `
      attribute vec2 aPos;
      attribute vec2 aUV;
      attribute vec4 aColor;
      varying vec2 vUV;
      varying vec4 vColor;
      uniform vec2 uResolution;
      void main() {
        vec2 clip = (aPos / uResolution) * 2.0 - 1.0;
        gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
        vUV = aUV;
        vColor = aColor;
      }
    `;

    // ── Fragment shader
    const fsrc = `
      precision mediump float;
      varying vec2 vUV;
      varying vec4 vColor;
      uniform sampler2D uTex;
      uniform int uTexEnable;
      void main() {
        vec4 col = vColor;
        if (uTexEnable == 1) {
          col *= texture2D(uTex, vUV);
        }
        gl_FragColor = col;
      }
    `;

    this.program = this._createProgram(vsrc, fsrc);
    gl.useProgram(this.program);

    this.aPos   = gl.getAttribLocation(this.program, 'aPos');
    this.aUV    = gl.getAttribLocation(this.program, 'aUV');
    this.aColor = gl.getAttribLocation(this.program, 'aColor');
    this.uRes   = gl.getUniformLocation(this.program, 'uResolution');
    this.uTex   = gl.getUniformLocation(this.program, 'uTex');
    this.uTexEn = gl.getUniformLocation(this.program, 'uTexEnable');

    // ── VBO
    this.vbo = gl.createBuffer();

    // ── Default texture (1×1 white)
    this.defaultTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.defaultTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
                  new Uint8Array([255,255,255,255]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  _createProgram(vsrc, fsrc) {
    const gl = this.gl;
    const vs = gl.createShader(gl.VERTEX_SHADER);
    const fs = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(vs, vsrc); gl.compileShader(vs);
    gl.shaderSource(fs, fsrc); gl.compileShader(fs);
    if (!gl.getShaderParameter(vs, gl.COMPILE_STATUS)) Utils.error('GS', gl.getShaderInfoLog(vs));
    if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) Utils.error('GS', gl.getShaderInfoLog(fs));
    const prog = gl.createProgram();
    gl.attachShader(prog, vs); gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) Utils.error('GS', gl.getProgramInfoLog(prog));
    return prog;
  }

  _createFramebuffer() {
    const gl = this.gl;
    this.fbo = gl.createFramebuffer();
    this.fboTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.fboTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 640, 448, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.fboTex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  // ── GS Register write ───────────────────────────────────────────────────
  writeReg(regIdx, lo, hi) {
    if (regIdx >= this.regs.length) return;
    this.regs[regIdx].lo = lo;
    this.regs[regIdx].hi = hi;
    this._applyReg(regIdx, lo, hi);
  }

  _applyReg(idx, lo, hi) {
    switch (idx) {
      case 0x00: // PRIM
        this._flushPrimitives();
        this._currentPrimType = lo & 0x7;
        break;
      case 0x01: // RGBAQ
        this._currR = lo & 0xFF;
        this._currG = (lo >> 8)  & 0xFF;
        this._currB = (lo >> 16) & 0xFF;
        this._currA = (lo >> 24) & 0xFF;
        this._currQ = new Float32Array(new Uint32Array([hi]).buffer)[0];
        break;
      case 0x05: // XYZ2
        this._submitVertex(lo & 0xFFFF, (lo >> 16) & 0xFFFF, hi & 0xFFFFFF,
                           this._currR/255, this._currG/255, this._currB/255, this._currA/128);
        break;
      case 0x18: // XYOFFSET_1
        this.xyoffset.x = lo & 0xFFFF;
        this.xyoffset.y = hi & 0xFFFF;
        break;
      case 0x1A: // PRMODECONT — use PRIM register
        break;
      case 0x40: // SCISSOR_1
        this.scissor.x1 = lo & 0x7FF;
        this.scissor.x2 = (lo >> 16) & 0x7FF;
        this.scissor.y1 = hi & 0x7FF;
        this.scissor.y2 = (hi >> 16) & 0x7FF;
        break;
      case 0x4C: // FRAME_1
        this.frame.base  = (lo & 0x1FF) << 11;
        this.frame.width = ((lo >> 16) & 0x3F) << 6;
        this.frame.format = (lo >> 24) & 0x3F;
        break;
    }
  }

  // Current draw state
  _currentPrimType = 6; // SPRITE
  _currR = 128; _currG = 128; _currB = 128; _currA = 128; _currQ = 1;
  _vtxQueue = [];

  _submitVertex(x, y, z, r, g, b, a) {
    const fx = (x - this.xyoffset.x) / 16;
    const fy = (y - this.xyoffset.y) / 16;
    this._vtxQueue.push({ x: fx, y: fy, z, r, g, b, a });

    const vertsNeeded = this._vertsPerPrim(this._currentPrimType);
    if (this._vtxQueue.length >= vertsNeeded) {
      this._rasterizePrim(this._currentPrimType, this._vtxQueue.splice(0, vertsNeeded));
    }
  }

  _vertsPerPrim(type) {
    // 0=POINT 1=LINE 2=LINESTRIP 3=TRI 4=TRISTRIP 5=TRIFAN 6=SPRITE
    return [1, 2, 2, 3, 3, 3, 2][type] || 3;
  }

  _rasterizePrim(type, verts) {
    if (type === 6) {
      // SPRITE: axis-aligned rectangle from 2 vertices
      const v0 = verts[0], v1 = verts[1];
      this._pushQuad(v0.x, v0.y, v1.x, v1.y, v1.r, v1.g, v1.b, v1.a);
    } else if (type === 3 || type === 4 || type === 5) {
      this._pushTri(verts[0], verts[1], verts[2]);
    } else if (type === 0) {
      this._pushPoint(verts[0]);
    }
    this.drawCalls++;
  }

  _pushQuad(x0, y0, x1, y1, r, g, b, a) {
    // Two triangles forming a quad
    this.vtxBuf.push(
      x0, y0, 0, 0, r, g, b, a,
      x1, y0, 1, 0, r, g, b, a,
      x0, y1, 0, 1, r, g, b, a,
      x1, y0, 1, 0, r, g, b, a,
      x1, y1, 1, 1, r, g, b, a,
      x0, y1, 0, 1, r, g, b, a
    );
    if (this.vtxBuf.length >= this.vtxMax * 8) this._flushPrimitives();
  }

  _pushTri(v0, v1, v2) {
    for (const v of [v0, v1, v2])
      this.vtxBuf.push(v.x, v.y, 0, 0, v.r, v.g, v.b, v.a);
  }

  _pushPoint(v) {
    this._pushQuad(v.x-0.5, v.y-0.5, v.x+0.5, v.y+0.5, v.r, v.g, v.b, v.a);
  }

  // ── Flush to GPU ────────────────────────────────────────────────────────
  _flushPrimitives() {
    if (this.vtxBuf.length === 0) return;
    const gl = this.gl;
    const data = new Float32Array(this.vtxBuf);
    const stride = 8 * 4; // 8 floats per vertex

    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);

    gl.enableVertexAttribArray(this.aPos);
    gl.enableVertexAttribArray(this.aUV);
    gl.enableVertexAttribArray(this.aColor);
    gl.vertexAttribPointer(this.aPos,   2, gl.FLOAT, false, stride, 0);
    gl.vertexAttribPointer(this.aUV,    2, gl.FLOAT, false, stride, 2*4);
    gl.vertexAttribPointer(this.aColor, 4, gl.FLOAT, false, stride, 4*4);

    gl.uniform2f(this.uRes, this.canvas.width, this.canvas.height);
    gl.uniform1i(this.uTexEn, 0);
    gl.bindTexture(gl.TEXTURE_2D, this.defaultTex);

    gl.drawArrays(gl.TRIANGLES, 0, data.length / 8);
    this.vtxBuf = [];
  }

  // ── Frame start/end ─────────────────────────────────────────────────────
  beginFrame() {
    const gl = this.gl;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clear(gl.COLOR_BUFFER_BIT);
    this.drawCalls = 0;
    this._vtxQueue = [];
    this.vtxBuf = [];
  }

  endFrame() {
    this._flushPrimitives();
    this.frameCount++;
  }

  // ── Render the PS2 splash / boot screen ─────────────────────────────────
  renderBootSplash(t) {
    const gl = this.gl;
    const c = this.canvas;
    // Animated blue gradient background
    const b = 0.5 + 0.5 * Math.sin(t * 0.5);
    gl.clearColor(0, 0, b * 0.4, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    // Draw the tower of blocks (PS2 memory cards)
    const now = t;
    for (let i = 0; i < 8; i++) {
      const h = 20 + i * 4;
      const x = c.width/2 - 40 + i * 10;
      const y = c.height/2 + Math.sin(now + i * 0.4) * 20;
      const bright = 0.3 + i / 12;
      this._pushQuad(x, y, x+8, y+h, bright, bright*0.5, 1, 1);
    }
    this._flushPrimitives();
  }

  reset() {
    this.vram.fill(0);
    for (const r of this.regs) { r.lo = 0; r.hi = 0; }
    this.vtxBuf = [];
    this._vtxQueue = [];
    const gl = this.gl;
    gl.clearColor(0,0,0,1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    Utils.info('GS', 'Renderer reset');
  }
}
