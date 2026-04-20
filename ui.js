/**
 * ui.js — UI Controller
 * Handles all DOM interactions: tabs, file upload, key binding editor,
 * settings, debug display, drag-and-drop.
 */

"use strict";

(function () {
  const emu = window.ps2emu;

  // ── Tab navigation ────────────────────────────────────────────────────────
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-section').forEach(s => s.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`tab-${tab}`).classList.add('active');
      if (tab === 'controls') buildBindingsTables();
    });
  });

  // ── Canvas attachment ─────────────────────────────────────────────────────
  const canvas = document.getElementById('screen');
  emu.attachCanvas(canvas);

  // ── File upload ───────────────────────────────────────────────────────────
  const fileInput  = document.getElementById('fileInput');
  const uploadZone = document.getElementById('uploadZone');

  fileInput.addEventListener('change', e => {
    if (e.target.files[0]) handleFile(e.target.files[0]);
  });

  // Drag-and-drop
  uploadZone.addEventListener('dragover', e => {
    e.preventDefault();
    uploadZone.classList.add('drag-over');
  });
  uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('drag-over'));
  uploadZone.addEventListener('drop', e => {
    e.preventDefault();
    uploadZone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  });

  async function handleFile(file) {
    const allowed = ['.iso', '.bin', '.img', '.mdf'];
    const ext = '.' + file.name.split('.').pop().toLowerCase();
    if (!allowed.includes(ext)) {
      alert(`Unsupported file type: ${ext}\nSupported: ${allowed.join(', ')}`);
      return;
    }

    document.getElementById('gameFileName').textContent = file.name;
    document.getElementById('gameFileSize').textContent = Utils.formatSize(file.size);
    document.getElementById('gameStatus').textContent   = 'Loading…';
    document.getElementById('gameStatus').className     = 'value';
    document.getElementById('gameInfo').classList.remove('hidden');

    const ok = await emu.loadDisc(file);

    if (ok) {
      document.getElementById('gameStatus').textContent = emu.disc.gameID || 'Ready';
      document.getElementById('gameStatus').className   = 'value status-ok';
      document.getElementById('btnBoot').disabled       = false;
    } else {
      document.getElementById('gameStatus').textContent = 'Error';
      document.getElementById('gameStatus').className   = 'value';
      document.getElementById('gameStatus').style.color = 'var(--danger)';
    }
  }

  // ── Emulator buttons ──────────────────────────────────────────────────────
  document.getElementById('btnBoot').addEventListener('click', () => {
    emu.boot();
    document.getElementById('btnPause').disabled   = false;
    document.getElementById('btnReset').disabled   = false;
    document.getElementById('btnSaveState').disabled = false;
    document.getElementById('btnLoadState').disabled = false;
    document.getElementById('screenOverlay').classList.add('hidden');
    updateStateDisplay();
  });

  document.getElementById('btnPause').addEventListener('click', () => {
    emu.togglePause();
    updateStateDisplay();
  });

  document.getElementById('btnReset').addEventListener('click', () => {
    if (!confirm('Reset the emulator?')) return;
    emu.reset();
    document.getElementById('screenOverlay').classList.remove('hidden');
    document.getElementById('btnPause').disabled = true;
    document.getElementById('btnReset').disabled = true;
    document.getElementById('btnBoot').disabled  = false;
    updateStateDisplay();
  });

  document.getElementById('btnSaveState').addEventListener('click', () => {
    const slot = parseInt(document.getElementById('stateSlot').value);
    emu.saveState(slot);
  });

  document.getElementById('btnLoadState').addEventListener('click', () => {
    const slot = parseInt(document.getElementById('stateSlot').value);
    emu.loadState(slot);
  });

  // ── State display update ──────────────────────────────────────────────────
  function updateStateDisplay() {
    const s    = emu.getState();
    const el   = document.getElementById('emulatorState');
    const pBtn = document.getElementById('btnPause');
    const po   = document.getElementById('screenPaused');

    el.textContent  = s.charAt(0).toUpperCase() + s.slice(1);
    el.className    = `state-${s}`;
    pBtn.textContent = s === 'paused' ? '▶ Resume' : '⏸ Pause';
    po.classList.toggle('hidden', s !== 'paused');
  }

  // ── Debug register display ────────────────────────────────────────────────
  function updateRegisters() {
    if (emu.getState() !== 'running' && emu.getState() !== 'paused') return;
    const snap = emu.cpu.snapshot();
    document.getElementById('reg-pc').textContent = Utils.hex8(snap.pc);
    document.getElementById('reg-sp').textContent = Utils.hex8(snap.sp);
    document.getElementById('reg-ra').textContent = Utils.hex8(snap.ra);
    document.getElementById('reg-v0').textContent = Utils.hex8(snap.v0);
    document.getElementById('reg-v1').textContent = Utils.hex8(snap.v1);
    document.getElementById('reg-a0').textContent = Utils.hex8(snap.a0);
    document.getElementById('reg-a1').textContent = Utils.hex8(snap.a1);
  }

  // ── FPS/status bar update ─────────────────────────────────────────────────
  setInterval(() => {
    document.getElementById('fpsDisplay').textContent = emu.getFPS();
    document.getElementById('eeSpeed').textContent    = emu.getState() === 'running' ? '100' : '0';
    document.getElementById('gsSpeed').textContent    = emu.gs ? (emu.getState() === 'running' ? '100' : '0') : '0';
    updateRegisters();
    updateStateDisplay();
  }, 250);

  // ── Log clear ─────────────────────────────────────────────────────────────
  document.getElementById('btnClearLog').addEventListener('click', () => {
    document.getElementById('logOutput').innerHTML = '';
  });

  // ══════════════════════════════════════════════════════════════════════════
  //  CONTROLS TAB — Key Binding Editor
  // ══════════════════════════════════════════════════════════════════════════

  let _listeningBtn = null;  // currently waiting for a keypress
  let _listeningPlayer = 0;
  let _listeningButton = -1;

  function buildBindingsTables() {
    for (const player of [1, 2]) {
      const table = document.getElementById(`bindingsTable${player}`);
      table.innerHTML = '';

      // Header
      const thead = document.createElement('thead');
      thead.innerHTML = '<tr><th>PS2 Button</th><th>Keyboard Key</th></tr>';
      table.appendChild(thead);

      const tbody = document.createElement('tbody');

      for (const [btnIdx, label] of Object.entries(DS2_LABELS)) {
        const idx = parseInt(btnIdx);
        const key  = emu.input.bindings[player][idx] || '—';

        const tr  = document.createElement('tr');
        const tdL = document.createElement('td');
        const tdK = document.createElement('td');

        tdL.textContent = label;

        const btn = document.createElement('button');
        btn.className   = 'binding-btn';
        btn.textContent = InputManager.prettyKey(key);
        btn.dataset.player = player;
        btn.dataset.button = idx;

        btn.addEventListener('click', () => startListening(btn, player, idx));

        tdK.appendChild(btn);
        tr.appendChild(tdL);
        tr.appendChild(tdK);
        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
    }
  }

  function startListening(btn, player, buttonIdx) {
    // Cancel previous listener
    if (_listeningBtn) {
      _listeningBtn.classList.remove('listening');
      _listeningBtn.textContent = InputManager.prettyKey(emu.input.bindings[_listeningPlayer][_listeningButton] || '—');
    }
    _listeningBtn     = btn;
    _listeningPlayer  = player;
    _listeningButton  = buttonIdx;
    btn.classList.add('listening');
    btn.textContent   = '…';
  }

  // Global keydown for binding capture
  window.addEventListener('keydown', e => {
    if (!_listeningBtn) return;
    // Don't bind modifier-only keys
    if (['Meta', 'OS', 'ContextMenu'].includes(e.key)) return;

    const key    = e.key;
    const player = _listeningPlayer;
    const button = _listeningButton;

    emu.input.setBinding(player, button, key);
    _listeningBtn.textContent = InputManager.prettyKey(key);
    _listeningBtn.classList.remove('listening');
    _listeningBtn = null;

    e.preventDefault();
    e.stopPropagation();
  }, true);

  document.getElementById('btnSaveBindings').addEventListener('click', () => {
    emu.input.saveBindings();
    showToast('✅ Bindings saved!');
  });

  document.getElementById('btnResetBindings').addEventListener('click', () => {
    if (!confirm('Reset all bindings to defaults?')) return;
    emu.input.resetBindings();
    buildBindingsTables();
    showToast('↺ Bindings reset to defaults');
  });

  // ══════════════════════════════════════════════════════════════════════════
  //  SETTINGS TAB
  // ══════════════════════════════════════════════════════════════════════════

  // Load current settings into UI
  (function loadSettingsUI() {
    const s = emu.settings;
    document.getElementById('setResScale').value   = s.resScale;
    document.getElementById('setAspect').value     = s.aspect;
    document.getElementById('setVsync').checked    = s.vsync;
    document.getElementById('setSmoothing').checked = s.smoothing;
    document.getElementById('setAudio').checked    = s.audio;
    document.getElementById('setVolume').value     = s.volume;
    document.getElementById('volumeVal').textContent = s.volume + '%';
    document.getElementById('setSpeedLimit').checked = !s.speedUnlimited;
    document.getElementById('setDynarec').checked  = s.dynarec;
    document.getElementById('setEECycle').value    = s.eeCycleRate;
  })();

  document.getElementById('setVolume').addEventListener('input', e => {
    document.getElementById('volumeVal').textContent = e.target.value + '%';
  });

  document.getElementById('btnSaveSettings').addEventListener('click', () => {
    const newSettings = {
      resScale:       parseInt(document.getElementById('setResScale').value),
      aspect:         document.getElementById('setAspect').value,
      vsync:          document.getElementById('setVsync').checked,
      smoothing:      document.getElementById('setSmoothing').checked,
      audio:          document.getElementById('setAudio').checked,
      volume:         parseInt(document.getElementById('setVolume').value),
      speedUnlimited: !document.getElementById('setSpeedLimit').checked,
      dynarec:        document.getElementById('setDynarec').checked,
      eeCycleRate:    parseInt(document.getElementById('setEECycle').value),
    };
    emu.saveSettings(newSettings);
    applySettings(newSettings);
    showToast('✅ Settings saved!');
  });

  function applySettings(s) {
    // Apply canvas scaling
    const wrapper = document.getElementById('screenWrapper');
    if (s.aspect === 'stretch') {
      canvas.style.aspectRatio = 'unset';
    } else {
      canvas.style.aspectRatio = s.aspect;
    }
  }

  // ── Toast notification ─────────────────────────────────────────────────────
  function showToast(msg) {
    let t = document.getElementById('toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'toast';
      t.style.cssText = `
        position:fixed;bottom:24px;right:24px;
        background:var(--bg-card);border:1px solid var(--border);
        color:var(--text-main);padding:10px 18px;border-radius:8px;
        font-size:13px;z-index:9999;box-shadow:var(--shadow);
        transition:opacity .3s;
      `;
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.style.opacity = '1';
    clearTimeout(t._timer);
    t._timer = setTimeout(() => { t.style.opacity = '0'; }, 2500);
  }

  // ── Keyboard shortcut: F5 = save, F7 = load, Space = pause ───────────────
  window.addEventListener('keydown', e => {
    if (_listeningBtn) return; // don't fire shortcuts during binding
    switch (e.key) {
      case 'F5': e.preventDefault(); document.getElementById('btnSaveState').click(); break;
      case 'F7': e.preventDefault(); document.getElementById('btnLoadState').click(); break;
      case 'F9': e.preventDefault(); document.getElementById('btnReset').click(); break;
      case 'Escape':
        if (emu.getState() === 'running' || emu.getState() === 'paused') {
          emu.togglePause(); updateStateDisplay();
        }
        break;
    }
  });

  // ── Initial log message ───────────────────────────────────────────────────
  Utils.info('UI', 'PS2 Web Emulator ready. Drop an ISO file to begin.');
  Utils.info('UI', 'Shortcuts: Esc=Pause  F5=Save State  F7=Load State  F9=Reset');

})();
