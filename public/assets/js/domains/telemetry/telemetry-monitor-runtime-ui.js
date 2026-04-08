// [TITLE] Module: public/assets/js/domains/telemetry/telemetry-monitor-runtime-ui.js
// [TITLE] Purpose: telemetry monitor canvas lifecycle + scope rendering runtime
// [TITLE] Functionality Index:
// [TITLE] - responsive canvas/grid cache lifecycle
// [TITLE] - main scope waveform animation
// [TITLE] - telemetry scope series push/draw pipeline
// [TITLE] - monitor active state transitions
// [DEV] Complex Flow:
// [DEV] Monitor rendering caps frame rate and caches grid layers to preserve UI
// [DEV] responsiveness during sustained polling.

function createTelemetryMonitorRuntimeUi(deps = {}) {
  const el = deps.el || {};
  const ui = deps.ui || {};
  const windowRef = deps.windowRef || window;
  const documentRef = deps.documentRef || document;
  const requestAnimationFrameRef = typeof deps.requestAnimationFrameRef === "function"
    ? deps.requestAnimationFrameRef
    : windowRef.requestAnimationFrame.bind(windowRef);
  const cancelAnimationFrameRef = typeof deps.cancelAnimationFrameRef === "function"
    ? deps.cancelAnimationFrameRef
    : windowRef.cancelAnimationFrame.bind(windowRef);
  const nowRef = typeof deps.nowRef === "function"
    ? deps.nowRef
    : (() => windowRef.performance.now());
  const mainScopeCtx = deps.mainScopeCtx || null;
  const telemetryScopeCtx = deps.telemetryScopeCtx || null;
  const SCOPE_MAX_PIXEL_RATIO = Number.isFinite(Number(deps.SCOPE_MAX_PIXEL_RATIO))
    ? Number(deps.SCOPE_MAX_PIXEL_RATIO)
    : 1.0;
  const MAIN_SCOPE_MAX_FPS = Math.max(1, Number(deps.MAIN_SCOPE_MAX_FPS) || 24);
  const MAIN_SCOPE_FRAME_MS = Math.round(1000 / MAIN_SCOPE_MAX_FPS);
  const telemetrySeriesMax = Math.max(60, Number(deps.telemetrySeriesMax) || 240);
  const formatLiveHzUi = typeof deps.formatLiveHzUi === "function"
    ? deps.formatLiveHzUi
    : (() => "");

  let telemetryGridCache = null;
  let mainGridCache = null;
  const telemetrySeries = {
    energy: [],
    rms: [],
    flux: [],
    hueLat: [],
    wizLat: [],
    drop: []
  };
  const clamp01 = v => Math.min(1, Math.max(0, Number(v) || 0));
  const scopeInput = {
    energy: 0.05,
    rms: 0.03,
    transient: 0,
    flux: 0,
    beat: 0,
    low: 0,
    mid: 0,
    high: 0,
    drop: false
  };
  const scopeState = {
    energy: 0.05,
    rms: 0.03,
    transient: 0,
    flux: 0,
    beat: 0,
    low: 0,
    mid: 0,
    high: 0
  };
  let ph = 0;
  let mainScopeAnimLocal = null;
  const getMainScopeAnim = typeof deps.getMainScopeAnim === "function"
    ? deps.getMainScopeAnim
    : (() => mainScopeAnimLocal);
  const setMainScopeAnim = typeof deps.setMainScopeAnim === "function"
    ? deps.setMainScopeAnim
    : (value => {
      mainScopeAnimLocal = value || null;
    });
  let mainScopeLastFrameAt = 0;

  function getCanvasResolutionScale() {
    const dpr = Math.max(1, Number(windowRef.devicePixelRatio) || 1);
    return Math.min(1, SCOPE_MAX_PIXEL_RATIO / dpr);
  }

  function resizeOneCanvas(canvas) {
    const scale = getCanvasResolutionScale();
    const nextW = Math.max(1, Math.floor(canvas.offsetWidth * scale));
    const nextH = Math.max(1, Math.floor(canvas.offsetHeight * scale));
    if (canvas.width !== nextW) canvas.width = nextW;
    if (canvas.height !== nextH) canvas.height = nextH;
  }

  function rebuildTelemetryGridCache() {
    const w = el.telemetryCanvas.width;
    const h = el.telemetryCanvas.height;
    if (!w || !h) return;

    const cache = documentRef.createElement("canvas");
    cache.width = w;
    cache.height = h;
    const ctx = cache.getContext("2d");

    ctx.fillStyle = "#030711";
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = "#17213d";
    ctx.lineWidth = 1;

    for (let i = 1; i < 6; i++) {
      const y = (i / 6) * h;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    for (let i = 1; i < 12; i++) {
      const x = (i / 12) * w;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }

    telemetryGridCache = cache;
  }

  function rebuildMainGridCache() {
    const w = el.canvas.width;
    const h = el.canvas.height;
    if (!w || !h) return;

    const cache = documentRef.createElement("canvas");
    cache.width = w;
    cache.height = h;
    const ctx = cache.getContext("2d");

    ctx.fillStyle = "#030711";
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = "rgba(23,33,61,0.85)";
    ctx.lineWidth = 1;
    for (let i = 1; i < 8; i++) {
      const y = (i / 8) * h;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
    for (let i = 1; i < 14; i++) {
      const x = (i / 14) * w;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }

    ctx.strokeStyle = "rgba(70,96,148,0.55)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, h * 0.5);
    ctx.lineTo(w, h * 0.5);
    ctx.stroke();

    mainGridCache = cache;
  }

  function resizeCanvas() {
    resizeOneCanvas(el.canvas);
    resizeOneCanvas(el.telemetryCanvas);
    rebuildMainGridCache();
    rebuildTelemetryGridCache();
  }

  function updateMainScopeInput(t, a) {
    scopeInput.energy = clamp01((Number(t?.energy || 0) / 1.2));
    scopeInput.rms = clamp01(a?.level ?? t?.audioSourceLevel ?? t?.rms ?? 0);
    scopeInput.transient = clamp01(a?.transient ?? t?.audioTransient ?? 0);
    scopeInput.flux = clamp01(a?.spectralFlux ?? t?.audioFlux ?? 0);
    scopeInput.beat = clamp01((Number(t?.beatConfidence || 0) || 0));
    scopeInput.low = clamp01(a?.bandLow ?? t?.audioBandLow ?? scopeInput.rms);
    scopeInput.mid = clamp01(a?.bandMid ?? t?.audioBandMid ?? scopeInput.rms * 0.9);
    scopeInput.high = clamp01(a?.bandHigh ?? t?.audioBandHigh ?? scopeInput.rms * 0.8);
    scopeInput.drop = Boolean(t?.drop);
  }

  function updateScopeHud(t, a) {
    const rms = clamp01(a?.level ?? t?.audioSourceLevel ?? t?.rms ?? 0);
    const eng = clamp01((Number(t?.energy || 0) / 1.2));
    const tr = clamp01(a?.transient ?? t?.audioTransient ?? 0);
    const flx = clamp01(a?.spectralFlux ?? t?.audioFlux ?? 0);
    const beat = clamp01(Number(t?.beatConfidence || 0));
    const drive = clamp01(rms * 0.46 + eng * 0.42 + tr * 0.12);
    const motion = clamp01(tr * 0.46 + flx * 0.34 + beat * 0.2);
    const activeScene = String(t?.paletteBrightnessSceneActive || ui.activeSceneToken || "").trim();
    const fallbackScene = String(t?.sceneIntent || t?.scene || "-").trim();
    const resolvedScene = String(activeScene || fallbackScene || "-")
      .replace(/^flow_/, "F:")
      .replace(/^meta_factors$/i, "AUTO");
    const behavior = String(t?.behaviorPolicyHint || t?.behavior || "-").trim().toUpperCase();
    const autoHz = Number(
      t?.cadenceAutoAppliedHz ??
      ui.cadenceAutoAppliedHz ??
      t?.metaAutoAppliedHz ??
      t?.metaAutoHz ??
      ui.metaAutoHz ??
      t?.overclockAutoHz ??
      ui.overclockAutoHz
    );
    const autoHzEnabled = Boolean(
      t?.cadenceAutoEnabled === true ||
      t?.metaAutoEnabled === true ||
      t?.overclockAutoEnabled === true
    );
    const autoHzLabel = autoHzEnabled && Number.isFinite(autoHz) && autoHz > 0
      ? ` @${formatLiveHzUi(autoHz)}HZ`
      : "";

    el.scopeDrive.textContent = drive.toFixed(2);
    el.scopeMotion.textContent = motion.toFixed(2);
    el.scopeScene.textContent = resolvedScene ? resolvedScene.toUpperCase() : "-";
    el.scopeBehav.textContent = `${behavior || "-"}${autoHzLabel}`;
  }

  function monitorsActive() {
    return ui.activeTab === "live" && !documentRef.hidden;
  }

  function drawWave() {
    const w = el.canvas.width;
    const h = el.canvas.height;
    if (!w || !h) return;

    scopeState.energy += (scopeInput.energy - scopeState.energy) * 0.16;
    scopeState.rms += (scopeInput.rms - scopeState.rms) * 0.2;
    scopeState.transient += (scopeInput.transient - scopeState.transient) * 0.22;
    scopeState.flux += (scopeInput.flux - scopeState.flux) * 0.18;
    scopeState.beat += (scopeInput.beat - scopeState.beat) * 0.2;
    scopeState.low += (scopeInput.low - scopeState.low) * 0.2;
    scopeState.mid += (scopeInput.mid - scopeState.mid) * 0.2;
    scopeState.high += (scopeInput.high - scopeState.high) * 0.2;

    const drop = scopeInput.drop;
    const drive = clamp01(
      scopeState.rms * 0.44 +
      scopeState.energy * 0.36 +
      scopeState.transient * 0.12 +
      scopeState.beat * 0.08
    );
    const motion = clamp01(
      scopeState.transient * 0.46 +
      scopeState.flux * 0.34 +
      scopeState.beat * 0.2
    );

    mainScopeCtx.clearRect(0, 0, w, h);
    if (!mainGridCache || mainGridCache.width !== w || mainGridCache.height !== h) {
      rebuildMainGridCache();
    }
    if (mainGridCache) {
      mainScopeCtx.drawImage(mainGridCache, 0, 0);
    } else {
      mainScopeCtx.fillStyle = "#030711";
      mainScopeCtx.fillRect(0, 0, w, h);
    }

    const centerY = h * 0.5;
    const maxAmp = h * 0.34;
    const amp = Math.max(1.5, maxAmp * (0.04 + drive * 0.38 + motion * 0.52));
    const points = Math.max(72, Math.min(160, Math.floor(w / 4)));
    const step = w / Math.max(1, points - 1);

    const drawTrace = (color, width, fn) => {
      mainScopeCtx.strokeStyle = color;
      mainScopeCtx.lineWidth = width;
      mainScopeCtx.beginPath();
      for (let i = 0; i < points; i++) {
        const x = i * step;
        const t = i / Math.max(1, points - 1);
        const y = fn(x, t);
        if (i === 0) mainScopeCtx.moveTo(x, y);
        else mainScopeCtx.lineTo(x, y);
      }
      mainScopeCtx.stroke();
    };

    const lowWeight = clamp01(0.35 + scopeState.low * 0.85);
    const midWeight = clamp01(0.35 + scopeState.mid * 0.85);
    const highWeight = clamp01(0.3 + scopeState.high * 0.92);
    const baseFreq = 0.012 + scopeState.beat * 0.02 + scopeState.transient * 0.012;
    const modFreq = 0.034 + scopeState.flux * 0.042;

    drawTrace("rgba(26,220,255,0.88)", 1.2, x => (
      centerY +
      Math.sin(x * baseFreq + ph * 0.09) * amp * 0.58 * lowWeight +
      Math.sin(x * 0.006 + ph * 0.05) * amp * 0.22 * scopeState.low
    ));
    drawTrace("rgba(255,74,122,0.92)", drop ? 1.8 : 1.5, x => (
      centerY +
      Math.sin(x * (baseFreq * 1.45) + ph * 0.15 + 0.7) * amp * 0.64 * midWeight +
      Math.sin(x * modFreq + ph * 0.22) * amp * 0.18 * scopeState.transient
    ));
    drawTrace("rgba(255,210,72,0.82)", 1.1, x => (
      centerY +
      Math.sin(x * (baseFreq * 2.4) + ph * 0.24 + 1.7) * amp * 0.46 * highWeight +
      Math.sin(x * (modFreq * 1.6) + ph * 0.3) * amp * 0.15 * scopeState.high
    ));
    drawTrace(drop ? "rgba(255,245,245,0.9)" : "rgba(198,226,255,0.72)", drop ? 2.2 : 1.6, x => {
      const low = Math.sin(x * baseFreq + ph * 0.09) * 0.42 * lowWeight;
      const mid = Math.sin(x * (baseFreq * 1.45) + ph * 0.15 + 0.7) * 0.34 * midWeight;
      const high = Math.sin(x * (baseFreq * 2.4) + ph * 0.24 + 1.7) * 0.24 * highWeight;
      const transientLift = Math.sin(x * modFreq + ph * 0.26) * 0.2 * scopeState.transient;
      return centerY + (low + mid + high + transientLift) * amp;
    });

    if (drop || motion > 0.58) {
      const pulseSpacing = Math.max(16, Math.round(w / 18));
      mainScopeCtx.strokeStyle = drop ? "rgba(255,255,255,0.26)" : "rgba(80,205,255,0.18)";
      mainScopeCtx.lineWidth = 1;
      for (let x = pulseSpacing; x < w; x += pulseSpacing) {
        if (((x / pulseSpacing) | 0) % 2 === 0 && !drop) continue;
        mainScopeCtx.beginPath();
        mainScopeCtx.moveTo(x, centerY - amp * (0.24 + motion * 0.24));
        mainScopeCtx.lineTo(x, centerY + amp * (0.24 + motion * 0.24));
        mainScopeCtx.stroke();
      }
    }

    ph += 0.8 + scopeState.transient * 1.45 + scopeState.flux * 1.05 + scopeState.beat * 1.1 + (drop ? 0.6 : 0);
  }

  function renderMainScope(now = nowRef()) {
    if (!monitorsActive()) {
      setMainScopeAnim(null);
      mainScopeLastFrameAt = 0;
      return;
    }

    if (!mainScopeLastFrameAt || (now - mainScopeLastFrameAt) >= MAIN_SCOPE_FRAME_MS) {
      drawWave();
      mainScopeLastFrameAt = now;
    }
    setMainScopeAnim(requestAnimationFrameRef(renderMainScope));
  }

  function updateMonitorRenderingState() {
    const mainScopeAnim = getMainScopeAnim();
    if (monitorsActive()) {
      if (!mainScopeAnim) {
        setMainScopeAnim(requestAnimationFrameRef(renderMainScope));
      }
      drawTelemetryScope();
      return;
    }
    if (mainScopeAnim) {
      cancelAnimationFrameRef(mainScopeAnim);
      setMainScopeAnim(null);
    }
    mainScopeLastFrameAt = 0;
  }

  function pushScopeSample(t, h, w, a) {
    const energy = Math.min(1, Math.max(0, Number(t?.energy || 0) / 1.2));
    const rms = Math.min(1, Math.max(0, Number(t?.audioRms ?? t?.rms ?? t?.audioSourceLevel ?? 0)));
    const flux = Math.min(1, Math.max(0, Number(a?.spectralFlux || 0)));
    const hueLat = Math.min(1, Math.max(0, Number(h?.lastDurationMs || 0) / 180));
    const wizLat = Math.min(1, Math.max(0, Number(w?.lastDurationMs || 0) / 120));
    const drop = Boolean(t?.drop);

    telemetrySeries.energy.push(energy);
    telemetrySeries.rms.push(rms);
    telemetrySeries.flux.push(flux);
    telemetrySeries.hueLat.push(hueLat);
    telemetrySeries.wizLat.push(wizLat);
    telemetrySeries.drop.push(drop ? 1 : 0);

    for (const key of Object.keys(telemetrySeries)) {
      if (telemetrySeries[key].length > telemetrySeriesMax) {
        telemetrySeries[key].shift();
      }
    }
  }

  function drawScopeLine(values, color, width = 1.4) {
    const w = el.telemetryCanvas.width;
    const h = el.telemetryCanvas.height;
    const len = values.length;
    if (!len) return;

    telemetryScopeCtx.strokeStyle = color;
    telemetryScopeCtx.lineWidth = width;
    telemetryScopeCtx.beginPath();
    for (let i = 0; i < len; i++) {
      const x = (i / Math.max(1, telemetrySeriesMax - 1)) * w;
      const y = h - values[i] * h;
      if (i === 0) telemetryScopeCtx.moveTo(x, y);
      else telemetryScopeCtx.lineTo(x, y);
    }
    telemetryScopeCtx.stroke();
  }

  function drawTelemetryScope() {
    const w = el.telemetryCanvas.width;
    const h = el.telemetryCanvas.height;
    if (!w || !h) return;

    telemetryScopeCtx.clearRect(0, 0, w, h);
    if (!telemetryGridCache || telemetryGridCache.width !== w || telemetryGridCache.height !== h) {
      rebuildTelemetryGridCache();
    }
    if (telemetryGridCache) {
      telemetryScopeCtx.drawImage(telemetryGridCache, 0, 0);
    } else {
      telemetryScopeCtx.fillStyle = "#030711";
      telemetryScopeCtx.fillRect(0, 0, w, h);
    }

    drawScopeLine(telemetrySeries.energy, "#ff334f", 1.8);
    drawScopeLine(telemetrySeries.rms, "#22d7ff", 1.5);
    drawScopeLine(telemetrySeries.flux, "#ffd34e", 1.4);
    drawScopeLine(telemetrySeries.hueLat, "#ff8c3a", 1.3);
    drawScopeLine(telemetrySeries.wizLat, "#38ff9f", 1.3);

    telemetryScopeCtx.strokeStyle = "rgba(255,255,255,0.4)";
    telemetryScopeCtx.lineWidth = 1;
    const drops = telemetrySeries.drop;
    for (let i = 0; i < drops.length; i++) {
      if (!drops[i]) continue;
      const x = (i / Math.max(1, telemetrySeriesMax - 1)) * w;
      telemetryScopeCtx.beginPath();
      telemetryScopeCtx.moveTo(x, 0);
      telemetryScopeCtx.lineTo(x, h);
      telemetryScopeCtx.stroke();
    }
  }

  function initializeTelemetryMonitorRuntimeUi() {
    windowRef.addEventListener("resize", resizeCanvas);
    resizeCanvas();
    documentRef.addEventListener("visibilitychange", updateMonitorRenderingState);
  }

  return {
    initializeTelemetryMonitorRuntimeUi,
    resizeCanvas,
    updateMainScopeInput,
    updateScopeHud,
    drawTelemetryScope,
    pushScopeSample,
    updateMonitorRenderingState,
    monitorsActive
  };
}
