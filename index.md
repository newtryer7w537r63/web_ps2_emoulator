---
layout: default
title: PS2 Web Emulator
---

<div id="app">

  <!-- ═══════════════════════════ HEADER ═══════════════════════════ -->
  <header class="header">
    <div class="header-logo">
      <span class="logo-icon">▶</span>
      <h1>PS2 Web Emulator</h1>
    </div>
    <nav class="header-nav">
      <button class="nav-btn active" data-tab="emulator">Emulator</button>
      <button class="nav-btn" data-tab="controls">Controls</button>
      <button class="nav-btn" data-tab="settings">Settings</button>
      <button class="nav-btn" data-tab="about">About</button>
    </nav>
  </header>

  <!-- ═══════════════════════════ TABS ════════════════════════════ -->

  <!-- TAB: EMULATOR -->
  <section id="tab-emulator" class="tab-section active">
    <div class="emulator-layout">

      <!-- Left panel: controls -->
      <aside class="panel panel-left">
        <div class="panel-block">
          <h3>Load Game</h3>
          <div class="upload-zone" id="uploadZone">
            <div class="upload-icon">💿</div>
            <p>Drop ISO / BIN / IMG here</p>
            <p class="upload-sub">or</p>
            <label class="btn btn-primary" for="fileInput">Browse File</label>
            <input type="file" id="fileInput" accept=".iso,.bin,.img,.mdf" hidden />
          </div>
          <div id="gameInfo" class="game-info hidden">
            <div class="game-info-row">
              <span class="label">File:</span>
              <span id="gameFileName" class="value">—</span>
            </div>
            <div class="game-info-row">
              <span class="label">Size:</span>
              <span id="gameFileSize" class="value">—</span>
            </div>
            <div class="game-info-row">
              <span class="label">Status:</span>
              <span id="gameStatus" class="value status-ok">Ready</span>
            </div>
          </div>
        </div>

        <div class="panel-block">
          <h3>Emulator Control</h3>
          <div class="control-row">
            <button id="btnBoot"    class="btn btn-success" disabled>▶ Boot</button>
            <button id="btnPause"   class="btn btn-warning" disabled>⏸ Pause</button>
            <button id="btnReset"   class="btn btn-danger"  disabled>↺ Reset</button>
          </div>
        </div>

        <div class="panel-block">
          <h3>State</h3>
          <div class="control-row">
            <button id="btnSaveState" class="btn btn-secondary" disabled>💾 Save</button>
            <button id="btnLoadState" class="btn btn-secondary" disabled>📂 Load</button>
          </div>
          <select id="stateSlot" class="select-full">
            <option value="0">Slot 1</option>
            <option value="1">Slot 2</option>
            <option value="2">Slot 3</option>
            <option value="3">Slot 4</option>
          </select>
        </div>
      </aside>

      <!-- Center: screen -->
      <main class="screen-area">
        <div class="screen-wrapper" id="screenWrapper">
          <canvas id="screen" width="640" height="448"></canvas>
          <div id="screenOverlay" class="screen-overlay">
            <div class="overlay-inner">
              <div class="ps2-logo">PlayStation®2</div>
              <p>Load a game ISO to begin</p>
            </div>
          </div>
          <div id="screenPaused" class="screen-overlay hidden">
            <div class="overlay-inner">
              <p style="font-size:3rem">⏸</p>
              <p>Paused</p>
            </div>
          </div>
        </div>
        <!-- FPS / status bar -->
        <div class="status-bar">
          <span>FPS: <strong id="fpsDisplay">0</strong></span>
          <span>EE: <strong id="eeSpeed">0</strong>%</span>
          <span>GS: <strong id="gsSpeed">0</strong>%</span>
          <span id="emulatorState" class="state-idle">Idle</span>
        </div>
      </main>

      <!-- Right panel: debug -->
      <aside class="panel panel-right">
        <div class="panel-block">
          <h3>CPU Registers</h3>
          <div id="regDisplay" class="reg-display">
            <div class="reg-row"><span>PC</span><span id="reg-pc">00000000</span></div>
            <div class="reg-row"><span>SP</span><span id="reg-sp">00000000</span></div>
            <div class="reg-row"><span>RA</span><span id="reg-ra">00000000</span></div>
            <div class="reg-row"><span>v0</span><span id="reg-v0">00000000</span></div>
            <div class="reg-row"><span>v1</span><span id="reg-v1">00000000</span></div>
            <div class="reg-row"><span>a0</span><span id="reg-a0">00000000</span></div>
            <div class="reg-row"><span>a1</span><span id="reg-a1">00000000</span></div>
          </div>
        </div>
        <div class="panel-block">
          <h3>Log</h3>
          <div id="logOutput" class="log-output"></div>
          <button class="btn btn-secondary btn-sm" id="btnClearLog">Clear</button>
        </div>
      </aside>

    </div>
  </section>

  <!-- TAB: CONTROLS -->
  <section id="tab-controls" class="tab-section">
    <div class="controls-layout">
      <h2>Controller Key Mapping</h2>
      <p class="subtitle">Click a binding then press the keyboard key you want to assign.</p>

      <div class="controllers-grid">
        <!-- Controller 1 -->
        <div class="controller-card" data-player="1">
          <h3>Player 1</h3>
          <div class="controller-visual">
            <img src="assets/img/ds2.svg" alt="DualShock 2" class="ds2-img" />
          </div>
          <table class="bindings-table" id="bindingsTable1"></table>
        </div>
        <!-- Controller 2 -->
        <div class="controller-card" data-player="2">
          <h3>Player 2</h3>
          <div class="controller-visual">
            <img src="assets/img/ds2.svg" alt="DualShock 2" class="ds2-img" />
          </div>
          <table class="bindings-table" id="bindingsTable2"></table>
        </div>
      </div>

      <div class="controls-footer">
        <button class="btn btn-primary" id="btnSaveBindings">💾 Save Bindings</button>
        <button class="btn btn-secondary" id="btnResetBindings">↺ Reset Defaults</button>
      </div>
    </div>
  </section>

  <!-- TAB: SETTINGS -->
  <section id="tab-settings" class="tab-section">
    <div class="settings-layout">
      <h2>Settings</h2>

      <div class="settings-group">
        <h3>🖥️ Video</h3>
        <label>Resolution Scale
          <select id="setResScale">
            <option value="1">Native (640×448)</option>
            <option value="2" selected>2× (1280×896)</option>
            <option value="4">4× (2560×1792)</option>
          </select>
        </label>
        <label>Aspect Ratio
          <select id="setAspect">
            <option value="4/3" selected>4:3 (Original)</option>
            <option value="16/9">16:9 (Widescreen)</option>
            <option value="stretch">Stretch</option>
          </select>
        </label>
        <label class="toggle-label">
          <input type="checkbox" id="setVsync" checked />
          Enable V-Sync
        </label>
        <label class="toggle-label">
          <input type="checkbox" id="setSmoothing" />
          Texture Smoothing
        </label>
      </div>

      <div class="settings-group">
        <h3>🔊 Audio</h3>
        <label class="toggle-label">
          <input type="checkbox" id="setAudio" checked />
          Enable Audio (SPU2)
        </label>
        <label>Volume
          <input type="range" id="setVolume" min="0" max="100" value="80" />
          <span id="volumeVal">80%</span>
        </label>
      </div>

      <div class="settings-group">
        <h3>⚡ Performance</h3>
        <label class="toggle-label">
          <input type="checkbox" id="setSpeedLimit" checked />
          Limit to 60 FPS
        </label>
        <label class="toggle-label">
          <input type="checkbox" id="setDynarec" checked />
          Dynamic Recompiler (faster)
        </label>
        <label>EE Cycle Rate
          <select id="setEECycle">
            <option value="0">Normal (100%)</option>
            <option value="1">+50%</option>
            <option value="2">+100%</option>
            <option value="-1">-50% (slow)</option>
          </select>
        </label>
      </div>

      <button class="btn btn-primary" id="btnSaveSettings">💾 Save Settings</button>
    </div>
  </section>

  <!-- TAB: ABOUT -->
  <section id="tab-about" class="tab-section">
    <div class="about-layout">
      <h2>About PS2 Web Emulator</h2>
      <div class="about-card">
        <p>This is an open-source PlayStation 2 emulation framework built entirely in JavaScript and WebGL, designed to run in modern browsers and be hosted on GitHub Pages.</p>
        <h3>Architecture</h3>
        <ul>
          <li><strong>EE (Emotion Engine)</strong> — MIPS R5900 128-bit CPU core</li>
          <li><strong>GS (Graphics Synthesizer)</strong> — WebGL-accelerated renderer</li>
          <li><strong>IOP</strong> — I/O Processor (MIPS R3000A)</li>
          <li><strong>SPU2</strong> — Audio processing unit (Web Audio API)</li>
          <li><strong>CDVD</strong> — Disc image reader (ISO/BIN)</li>
        </ul>
        <h3>Supported Formats</h3>
        <ul>
          <li>.ISO — Standard disc image</li>
          <li>.BIN/.IMG — Raw binary disc image</li>
          <li>.MDF — Media Descriptor File</li>
        </ul>
        <h3>System Requirements</h3>
        <ul>
          <li>Modern browser with WebGL2 support</li>
          <li>SharedArrayBuffer support (HTTPS required)</li>
          <li>Recommended: 4+ core CPU, 8GB RAM</li>
        </ul>
        <p class="disclaimer">⚠️ PlayStation 2 is a trademark of Sony Interactive Entertainment. This project is for educational purposes. You must own the original game disc to use a ROM legally.</p>
      </div>
    </div>
  </section>

</div>
