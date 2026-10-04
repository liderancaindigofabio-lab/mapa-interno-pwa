(() => {
  'use strict';
  const KEY = 'huse-mapa-interno-v1';
  const DEFAULT_STEP_METERS = 0.65;
  const MIN_STEP_METERS = 0.25;
  const MAX_STEP_METERS = 1.25;
  const MAX_ZOOM = 90;
  const MIN_ZOOM = 8;
  const defaultData = () => ({ version: 1, floor: 0, x: 0, y: 0, heading: 0, stepMeters: DEFAULT_STEP_METERS, autoSteps: false, recording: false, events: [], markers: [], stepCount: 0 });
  let data = loadData();
  let viewFloor = data.floor;
  let viewCenter = { x: data.x, y: data.y };
  let followUser = true;
  let zoom = 34;
  let undoStack = [];
  let lastPeak = 0;
  let wasAbove = false;
  let motionReady = false;
  let orientationReady = false;
  let lastAlpha = null;
  let lastCompass = null;
  let compassOffset = null;
  let areaVertices = null;
  let pendingShape = 'point';
  let deferredInstall = null;
  const activePointers = new Map();
  let gesture = null;
  let suppressClick = false;
  const el = id => document.getElementById(id);
  const canvas = el('mapCanvas');
  const ctx = canvas.getContext('2d');
  const floorNames = ['Pavimento 1', 'Pavimento 2', 'Pavimento 3'];

  function loadData() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return defaultData();
      const parsed = JSON.parse(raw);
      if (parsed.version !== 1 || !Array.isArray(parsed.events) || !Array.isArray(parsed.markers)) return defaultData();
      const restored = { ...defaultData(), ...parsed, recording: false };
      const step = Number(restored.stepMeters);
      restored.stepMeters = Number.isFinite(step) ? Math.min(MAX_STEP_METERS, Math.max(MIN_STEP_METERS, step)) : DEFAULT_STEP_METERS;
      restored.autoSteps = parsed.autoSteps === true;
      return restored;
    } catch (_) { return defaultData(); }
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(data)); }
    catch (_) { setStatus('Não foi possível salvar. Exporte uma cópia dos dados.', false); }
    render();
  }
  function setStatus(text, active = data.recording) {
    el('statusText').textContent = text;
    el('statusDot').classList.toggle('active', active);
  }
  function floorName(floor) { return floorNames[Math.max(0, Math.min(2, Number(floor) || 0))]; }
  function currentPoint(type = 'move') { return { x: round(data.x), y: round(data.y), floor: data.floor, type, time: Date.now() }; }
  function round(n) { return Math.round(n * 100) / 100; }
  function radians(degrees) { return degrees * Math.PI / 180; }
  function normalize(angle) { return (angle % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2); }
  function shortestDegrees(delta) { return ((delta + 540) % 360) - 180; }
  function remember() { undoStack.push({ x: data.x, y: data.y, heading: data.heading, floor: data.floor, eventLength: data.events.length, stepCount: data.stepCount }); if (undoStack.length > 150) undoStack.shift(); }
  function recenterOnUser() {
    viewFloor = data.floor;
    viewCenter = { x: data.x, y: data.y };
    followUser = true;
    el('floorSelect').value = String(viewFloor);
    drawMap();
  }
  function addStep() {
    if (!data.recording) return;
    remember();
    data.x += Math.sin(data.heading) * data.stepMeters;
    data.y += Math.cos(data.heading) * data.stepMeters;
    data.stepCount += 1;
    data.events.push(currentPoint('move'));
    if (followUser) viewCenter = { x: data.x, y: data.y };
    save();
  }
  function startOrPause() {
    if (areaVertices) cancelArea();
    if (data.recording) {
      data.recording = false;
      save(); setStatus('Percurso pausado', false); el('startBtn').textContent = 'Continuar percurso'; return;
    }
    data.recording = true;
    if (!data.events.length || data.events[data.events.length - 1].type === 'finish') data.events.push(currentPoint('start'));
    else data.events.push(currentPoint('resume'));
    viewFloor = data.floor;
    if (followUser) viewCenter = { x: data.x, y: data.y };
    lastAlpha = null; lastCompass = null; compassOffset = null;
    save(); setStatus('Registrando percurso', true); el('startBtn').textContent = 'Pausar percurso';
    requestMotion();
  }
  async function requestMotion() {
    let motionAllowed = data.autoSteps;
    let orientationAllowed = true;
    try {
      if (data.autoSteps && 'DeviceMotionEvent' in window && typeof window.DeviceMotionEvent.requestPermission === 'function') {
        motionAllowed = await window.DeviceMotionEvent.requestPermission() === 'granted';
      }
    } catch (_) { motionAllowed = false; }
    try {
      if ('DeviceOrientationEvent' in window && typeof window.DeviceOrientationEvent.requestPermission === 'function') {
        orientationAllowed = await window.DeviceOrientationEvent.requestPermission() === 'granted';
      }
    } catch (_) { orientationAllowed = false; }
    if (data.autoSteps && motionAllowed && 'DeviceMotionEvent' in window && !motionReady) {
      window.addEventListener('devicemotion', onMotion, { passive: true }); motionReady = true;
    }
    if (orientationAllowed && 'DeviceOrientationEvent' in window && !orientationReady) {
      window.addEventListener('deviceorientation', onOrientation, { passive: true }); orientationReady = true;
    }
    const stepMsg = data.autoSteps && motionReady ? 'passos estimados pelo sensor (experimental)' : 'contagem manual de passos, para evitar movimentos falsos';
    const turnMsg = orientationReady ? 'giros acompanhados pela orientação do celular; corrija pelos botões se precisar.' : 'giros registrados pelos botões de virar.';
    el('sensorMessage').textContent = `${stepMsg}; ${turnMsg}`;
  }
  function onMotion(event) {
    if (!data.recording || !data.autoSteps) return;
    const a = event.acceleration;
    const g = event.accelerationIncludingGravity;
    let magnitude = null;
    if (a && a.x !== null && a.y !== null && a.z !== null) magnitude = Math.hypot(a.x, a.y, a.z);
    else if (g && g.x !== null && g.y !== null && g.z !== null) magnitude = Math.abs(Math.hypot(g.x, g.y, g.z) - 9.81);
    if (magnitude === null) return;
    const now = Date.now();
    const threshold = a && a.x !== null ? 1.35 : 1.05;
    if (magnitude > threshold && !wasAbove && now - lastPeak > 380) {
      wasAbove = true; lastPeak = now; addStep();
    } else if (magnitude < threshold * 0.58) wasAbove = false;
  }
  function onOrientation(event) {
    if (!data.recording) return;
    const compass = Number(event.webkitCompassHeading);
    if (Number.isFinite(compass)) {
      if (compassOffset === null) compassOffset = normalize(data.heading) - radians(compass);
      lastCompass = compass;
      data.heading = normalize(radians(compass) + compassOffset);
    } else {
      if (!Number.isFinite(event.alpha)) return;
      if (lastAlpha === null) { lastAlpha = event.alpha; return; }
      const delta = shortestDegrees(event.alpha - lastAlpha);
      lastAlpha = event.alpha;
      data.heading = normalize(data.heading - radians(delta));
    }
    if (followUser) viewCenter = { x: data.x, y: data.y };
    drawMap();
  }
  function turn(direction) {
    if (!data.recording) return;
    remember(); data.heading = normalize(data.heading + direction * Math.PI / 2);
    if (Number.isFinite(lastCompass)) compassOffset = data.heading - radians(lastCompass);
    data.events.push(currentPoint(direction > 0 ? 'turn-right' : 'turn-left')); save();
    setStatus(`Direção corrigida ${direction > 0 ? 'à direita' : 'à esquerda'}`);
  }
  function changeFloor(direction) {
    if (!data.recording) return;
    if (areaVertices) cancelArea();
    const next = data.floor + direction;
    if (next < 0 || next > 2) { setStatus('Os três pavimentos deste protótipo já estão selecionados.'); return; }
    remember();
    data.events.push(currentPoint(direction > 0 ? 'stairs-up' : 'stairs-down'));
    data.floor = next; viewFloor = next;
    data.events.push(currentPoint('floor-arrival'));
    if (followUser) viewCenter = { x: data.x, y: data.y };
    el('floorSelect').value = String(viewFloor); save();
    setStatus(`${direction > 0 ? 'Subida' : 'Descida'} registrada: ${floorName(next)}`);
  }
  function correctPosition(x, y) {
    remember(); data.x = x; data.y = y; data.floor = viewFloor;
    data.events.push(currentPoint('correction'));
    followUser = true; viewCenter = { x, y };
    save(); setStatus('Posição corrigida manualmente');
  }
  function openMarkerDialog(shape = 'point') {
    pendingShape = shape;
    el('markerName').value = '';
    el('markerDialogTitle').textContent = shape === 'area' ? 'Nomear esta área' : 'Marcar este local';
    el('markerDialogHelp').textContent = shape === 'area' ? 'Dê um nome à área que você contornou. Ela será salva no pavimento atual.' : 'Escolha um nome fácil de reconhecer. O ponto será salvo no pavimento atual.';
    el('saveMarkerBtn').textContent = shape === 'area' ? 'Salvar área' : 'Salvar ponto';
    if (typeof el('markerDialog').showModal === 'function') el('markerDialog').showModal();
    else {
      const label = window.prompt(shape === 'area' ? 'Nome desta área?' : 'Nome deste local?');
      if (label) { addMarker(label, el('markerColor').value, shape); if (shape === 'area') cancelArea(); }
    }
    setTimeout(() => el('markerName').focus(), 40);
  }
  function addMarker(name, color, shape = 'point') {
    if (!name.trim()) return;
    const marker = { id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`, name: name.trim(), color, x: round(data.x), y: round(data.y), floor: data.floor, time: Date.now(), shape };
    if (shape === 'area' && areaVertices && areaVertices.length >= 3) {
      marker.vertices = areaVertices.map(p => ({ x: round(p.x), y: round(p.y) }));
      marker.x = round(marker.vertices.reduce((sum,p) => sum+p.x,0) / marker.vertices.length);
      marker.y = round(marker.vertices.reduce((sum,p) => sum+p.y,0) / marker.vertices.length);
    }
    data.markers.push(marker);
    save(); setStatus(`${shape === 'area' ? 'Área salva' : 'Ponto salvo'}: ${name.trim()}`);
  }
  function beginArea() {
    if (!data.recording) return;
    viewFloor = data.floor; el('floorSelect').value = String(viewFloor);
    viewCenter = { x: data.x, y: data.y }; followUser = true;
    areaVertices = [];
    renderAreaTools(); drawMap();
    setStatus('Toque no contorno da área para adicionar pontos');
  }
  function cancelArea() {
    areaVertices = null; renderAreaTools(); drawMap();
    if (el('mapHint')) el('mapHint').textContent = 'Arraste para percorrer o mapa; toque para corrigir sua posição';
  }
  function finishArea() {
    if (!areaVertices || areaVertices.length < 3) return;
    openMarkerDialog('area');
  }
  function renderAreaTools() {
    const tools = el('areaTools');
    const active = Array.isArray(areaVertices);
    tools.classList.toggle('hidden', !active);
    if (!active) return;
    const count = areaVertices.length;
    el('finishAreaBtn').disabled = count < 3;
    el('finishAreaBtn').textContent = count < 3 ? `Marque ${3-count} ponto${3-count===1?'':'s'}` : `Nomear área (${count} pontos)`;
    el('mapHint').textContent = 'Toque no mapa para marcar o contorno da área';
  }
  function undo() {
    if (areaVertices && areaVertices.length) { areaVertices.pop(); renderAreaTools(); drawMap(); setStatus('Último ponto do contorno removido'); return; }
    const previous = undoStack.pop();
    if (!previous) { setStatus('Nada para desfazer.'); return; }
    data.x = previous.x; data.y = previous.y; data.heading = previous.heading; data.floor = previous.floor; data.stepCount = previous.stepCount; data.events.length = previous.eventLength;
    viewFloor = data.floor; viewCenter = { x: data.x, y: data.y }; followUser = true;
    el('floorSelect').value = String(viewFloor); save(); setStatus('Último movimento desfeito');
  }
  function setMapExpanded(expanded) {
    el('mapCard').classList.toggle('expanded', expanded);
    document.body.classList.toggle('map-open', expanded);
    el('fullscreenBtn').textContent = expanded ? '×' : '⛶';
    el('fullscreenBtn').setAttribute('aria-label', expanded ? 'Fechar tela cheia' : 'Abrir mapa em tela cheia');
    el('fullscreenBtn').title = expanded ? 'Fechar tela cheia' : 'Tela cheia';
    setTimeout(resizeCanvas, 60);
  }
  function focusMarker(marker) {
    viewFloor = marker.floor;
    viewCenter = { x: marker.x, y: marker.y };
    followUser = false;
    el('floorSelect').value = String(viewFloor);
    drawMap(); setMapExpanded(true);
  }
  function renderAreaShape(marker, sx, sy) {
    if (!Array.isArray(marker.vertices) || marker.vertices.length < 3) return;
    ctx.beginPath(); marker.vertices.forEach((p,i) => { if (i===0) ctx.moveTo(sx(p.x),sy(p.y)); else ctx.lineTo(sx(p.x),sy(p.y)); }); ctx.closePath();
    ctx.save(); ctx.globalAlpha = .22; ctx.fillStyle = marker.color; ctx.fill(); ctx.restore();
    ctx.strokeStyle = marker.color; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle='#25352f';ctx.font='600 12px system-ui';ctx.textAlign='center';ctx.fillText(marker.name.slice(0,24),sx(marker.x),sy(marker.y));ctx.textAlign='start';
  }
  function visibleBounds() {
    const ev = data.events.filter(p => p.floor === viewFloor);
    const marks = data.markers.filter(p => p.floor === viewFloor);
    return [...ev, ...marks, ...(data.floor === viewFloor ? [{ x: data.x, y: data.y }] : [])];
  }
  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(rect.width * ratio)); canvas.height = Math.max(1, Math.round(rect.height * ratio));
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0); drawMap();
  }
  function drawMap() {
    const rect = canvas.getBoundingClientRect(); const w = rect.width; const h = rect.height;
    if (!w || !h) return;
    ctx.clearRect(0, 0, w, h); ctx.fillStyle = '#f8faf8'; ctx.fillRect(0, 0, w, h);
    const scale = zoom; const cx = viewCenter.x; const cy = viewCenter.y;
    const sx = x => w / 2 + (x - cx) * scale;
    const sy = y => h / 2 - (y - cy) * scale;
    ctx.strokeStyle = '#e7ede9'; ctx.lineWidth = 1;
    const startX = Math.floor(cx - w / (2 * scale)) - 1, endX = Math.ceil(cx + w / (2 * scale)) + 1;
    const startY = Math.floor(cy - h / (2 * scale)) - 1, endY = Math.ceil(cy + h / (2 * scale)) + 1;
    for (let x = startX; x <= endX; x++) { ctx.beginPath(); ctx.moveTo(sx(x), 0); ctx.lineTo(sx(x), h); ctx.stroke(); }
    for (let y = startY; y <= endY; y++) { ctx.beginPath(); ctx.moveTo(0, sy(y)); ctx.lineTo(w, sy(y)); ctx.stroke(); }
    ctx.fillStyle = '#84918b'; ctx.font = '11px system-ui'; ctx.fillText('Grade aproximada · 1 quadrícula = 1 m', 11, 19);
    const events = data.events.filter(p => p.floor === viewFloor && ['start','resume','move','correction','floor-arrival'].includes(p.type));
    if (events.length > 1) {
      ctx.strokeStyle = '#28755f'; ctx.lineWidth = 4; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.beginPath();
      events.forEach((p, i) => { if (i === 0) ctx.moveTo(sx(p.x), sy(p.y)); else ctx.lineTo(sx(p.x), sy(p.y)); }); ctx.stroke();
    }
    for (const m of data.markers.filter(p => p.floor === viewFloor)) {
      if (m.shape === 'area') renderAreaShape(m, sx, sy);
      else {
        const x = sx(m.x), y = sy(m.y); ctx.fillStyle = m.color; ctx.beginPath(); ctx.arc(x,y,8,0,Math.PI*2); ctx.fill(); ctx.strokeStyle='#fff';ctx.lineWidth=2;ctx.stroke();
        ctx.fillStyle='#25352f';ctx.font='600 12px system-ui';ctx.textAlign='center';ctx.fillText(m.name.slice(0,24),x,y-13);ctx.textAlign='start';
      }
    }
    if (areaVertices && viewFloor === data.floor && areaVertices.length) {
      ctx.beginPath(); areaVertices.forEach((p,i) => { if (i===0) ctx.moveTo(sx(p.x),sy(p.y)); else ctx.lineTo(sx(p.x),sy(p.y)); });
      if(areaVertices.length>=3){ctx.closePath();ctx.save();ctx.globalAlpha=.14;ctx.fillStyle='#d2a84a';ctx.fill();ctx.restore();}
      ctx.strokeStyle='#d2a84a';ctx.lineWidth=2;ctx.setLineDash([5,4]);ctx.stroke();ctx.setLineDash([]);
      for(const p of areaVertices){ctx.fillStyle='#d2a84a';ctx.beginPath();ctx.arc(sx(p.x),sy(p.y),4,0,Math.PI*2);ctx.fill();}
    }
    if (data.floor === viewFloor) {
      const x = sx(data.x), y = sy(data.y);
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x,y,11,0,Math.PI*2); ctx.fill();
      ctx.fillStyle = '#2879ce'; ctx.beginPath(); ctx.arc(x,y,8,0,Math.PI*2); ctx.fill();
      ctx.strokeStyle = '#2879ce'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x,y); ctx.lineTo(x + Math.sin(data.heading)*18, y - Math.cos(data.heading)*18); ctx.stroke();
      ctx.fillStyle='#1c344a';ctx.font='700 11px system-ui';ctx.textAlign='center';ctx.fillText('VOCÊ',x,y+25);ctx.textAlign='start';
    }
    if (!visibleBounds().length) { ctx.fillStyle='#829089';ctx.textAlign='center';ctx.font='14px system-ui';ctx.fillText('Comece um percurso para desenhar o mapa',w/2,h/2+50);ctx.textAlign='start'; }
  }
  function renderMarkers() {
    const list = el('markerList'); const markers = [...data.markers].sort((a,b) => b.time - a.time);
    el('markerCount').textContent = String(markers.length);
    if (!markers.length) { list.innerHTML = '<p class="empty-state">Ainda não há pontos ou áreas marcados.</p>'; return; }
    list.innerHTML = '';
    for (const marker of markers) {
      const row = document.createElement('div'); row.className = 'marker-item';
      const swatch = document.createElement('i'); swatch.className = 'marker-color'; swatch.style.backgroundColor = marker.color;
      const info = document.createElement('div'); info.className = 'marker-info';
      const title = document.createElement('strong'); title.textContent = marker.name;
      const kind = marker.shape === 'area' ? 'Área desenhada' : 'Ponto';
      const sub = document.createElement('small'); sub.textContent = `${floorName(marker.floor)} · ${kind} · posição aproximada`;
      info.append(title, sub);
      const show = document.createElement('button'); show.type='button'; show.textContent='Ver'; show.setAttribute('aria-label',`Ver ${marker.name} no mapa`); show.addEventListener('click', () => focusMarker(marker));
      const del = document.createElement('button'); del.type='button'; del.textContent='Apagar'; del.setAttribute('aria-label',`Apagar ${marker.name}`); del.addEventListener('click', () => { data.markers = data.markers.filter(m => m.id !== marker.id); save(); });
      row.append(swatch, info, show, del); list.append(row);
    }
  }
  function render() {
    el('floorSelect').value = String(viewFloor);
    el('stepText').textContent = `${data.stepCount} ${data.stepCount === 1 ? 'passo' : 'passos'}`;
    el('stepSizeLabel').textContent = `Passo ${data.stepMeters.toFixed(2).replace('.', ',')} m`;
    el('startBtn').textContent = data.recording ? 'Pausar percurso' : (data.events.length && data.events[data.events.length - 1].type !== 'finish' ? 'Continuar percurso' : 'Começar percurso');
    for (const id of ['leftBtn','rightBtn','stepBtn','markBtn','areaBtn','floorUpBtn','floorDownBtn','undoBtn','finishBtn']) el(id).disabled = !data.recording;
    el('stepCalBtn').disabled = data.recording;
    el('autoStepsToggle').checked = data.autoSteps;
    el('autoStepsToggle').disabled = data.recording;
    setStatus(data.recording ? 'Registrando percurso' : 'Pronto para começar', data.recording);
    renderAreaTools(); renderMarkers(); drawMap();
  }
  function exportData() {
    const blob = new Blob([JSON.stringify({ ...data, exportedAt: new Date().toISOString() }, null, 2)], { type: 'application/json' });
    const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = 'meu-mapa-interno.json'; link.click(); URL.revokeObjectURL(link.href);
  }
  function importData(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.events) || !Array.isArray(parsed.markers)) throw new Error('bad');
        if (!window.confirm('Importar este arquivo e substituir os dados salvos neste aparelho?')) return;
        data = { ...defaultData(), ...parsed, recording: false };
        data.floor = Math.max(0, Math.min(2, Number(data.floor) || 0));
        const step = Number(data.stepMeters); data.stepMeters = Number.isFinite(step) ? Math.min(MAX_STEP_METERS, Math.max(MIN_STEP_METERS, step)) : DEFAULT_STEP_METERS;
        viewFloor = data.floor; viewCenter = { x: data.x, y: data.y }; followUser = true; undoStack = []; save();
      } catch (_) { window.alert('Não consegui ler esse arquivo como uma cópia válida do Mapa Interno.'); }
      el('importInput').value = '';
    };
    reader.readAsText(file);
  }
  function openCalibration() {
    if (data.recording) { setStatus('Pause o percurso antes de calibrar a passada.'); return; }
    el('calibrationDistance').value = '10';
    el('calibrationStepCount').value = '';
    el('calibrationHelp').textContent = 'Meça um trecho reto, caminhe contando seus passos e informe os dois valores. O celular parado não contará movimentos como passos.';
    el('calibrationDialog').showModal();
  }
  function handleCalibrationSubmit(event) {
    event.preventDefault();
    const action = event.submitter ? event.submitter.value : 'save';
    if (action === 'cancel') { el('calibrationDialog').close(); return; }
    const distance = Number(el('calibrationDistance').value);
    const steps = Number(el('calibrationStepCount').value);
    if (!Number.isFinite(distance) || distance < 1 || distance > 500) { el('calibrationHelp').textContent = 'Informe uma distância entre 1 e 500 metros.'; return; }
    if (!Number.isInteger(steps) || steps < 2 || steps > 2000) { el('calibrationHelp').textContent = 'Informe quantos passos você realmente deu (de 2 a 2.000).'; return; }
    const measuredStep = distance / steps;
    if (measuredStep < MIN_STEP_METERS || measuredStep > MAX_STEP_METERS) {
      el('calibrationHelp').textContent = `O resultado (${measuredStep.toFixed(2)} m por passo) parece fora do esperado. Confira a distância e a contagem.`; return;
    }
    data.stepMeters = round(measuredStep);
    el('calibrationDialog').close(); save(); setStatus(`Passada calibrada: ${data.stepMeters.toFixed(2).replace('.', ',')} m`);
  }
  function setMapExpanded(expanded) {
    el('mapCard').classList.toggle('expanded', expanded);
    document.body.classList.toggle('map-open', expanded);
    el('fullscreenBtn').textContent = expanded ? '×' : '⛶';
    el('fullscreenBtn').setAttribute('aria-label', expanded ? 'Fechar tela cheia' : 'Abrir mapa em tela cheia');
    el('fullscreenBtn').title = expanded ? 'Fechar tela cheia' : 'Tela cheia';
    setTimeout(resizeCanvas, 60);
  }
  function focusMarker(marker) {
    viewFloor = marker.floor; viewCenter = { x: marker.x, y: marker.y }; followUser = false;
    el('floorSelect').value = String(viewFloor); drawMap(); setMapExpanded(true);
  }
  function distanceBetween(a,b) { return Math.hypot(a.x-b.x,a.y-b.y); }
  function onPointerDown(event) {
    if (areaVertices) return;
    canvas.setPointerCapture(event.pointerId);
    activePointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
    if (activePointers.size === 1) gesture = { type:'pan', lastX:event.clientX, lastY:event.clientY, moved:false };
    else if (activePointers.size >= 2) {
      const pts=[...activePointers.values()]; gesture={type:'pinch',startDistance:Math.max(1,distanceBetween(pts[0],pts[1])),startZoom:zoom,moved:false};
    }
  }
  function onPointerMove(event) {
    if (!activePointers.has(event.pointerId) || areaVertices) return;
    activePointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
    if (activePointers.size >= 2) {
      const pts=[...activePointers.values()];
      if (!gesture || gesture.type !== 'pinch') gesture={type:'pinch',startDistance:Math.max(1,distanceBetween(pts[0],pts[1])),startZoom:zoom,moved:false};
      const d=distanceBetween(pts[0],pts[1]);
      zoom=Math.min(MAX_ZOOM,Math.max(MIN_ZOOM,gesture.startZoom*d/gesture.startDistance));
      gesture.moved=true; drawMap(); return;
    }
    if (!gesture || gesture.type !== 'pan') return;
    const dx=event.clientX-gesture.lastX, dy=event.clientY-gesture.lastY;
    if (Math.abs(dx)+Math.abs(dy)>3) gesture.moved=true;
    if (gesture.moved) {
      viewCenter.x -= dx/zoom; viewCenter.y += dy/zoom; followUser=false;
      gesture.lastX=event.clientX; gesture.lastY=event.clientY; drawMap();
    }
  }
  function onPointerUp(event) {
    if (!activePointers.has(event.pointerId)) return;
    const didMove=Boolean(gesture && gesture.moved);
    activePointers.delete(event.pointerId);
    if (didMove) { suppressClick=true; setTimeout(()=>{suppressClick=false;},180); }
    if (activePointers.size === 1) {
      const remaining=[...activePointers.values()][0]; gesture={type:'pan',lastX:remaining.x,lastY:remaining.y,moved:didMove};
    } else gesture=null;
  }

  el('startBtn').addEventListener('click', startOrPause);
  el('leftBtn').addEventListener('click', () => turn(-1));
  el('rightBtn').addEventListener('click', () => turn(1));
  el('stepBtn').addEventListener('click', addStep);
  el('markBtn').addEventListener('click', () => openMarkerDialog('point'));
  el('areaBtn').addEventListener('click', beginArea);
  el('cancelAreaBtn').addEventListener('click', cancelArea);
  el('finishAreaBtn').addEventListener('click', finishArea);
  el('floorUpBtn').addEventListener('click', () => changeFloor(1));
  el('floorDownBtn').addEventListener('click', () => changeFloor(-1));
  el('undoBtn').addEventListener('click', undo);
  el('stepCalBtn').addEventListener('click', openCalibration);
  el('calibrationForm').addEventListener('submit', handleCalibrationSubmit);
  el('autoStepsToggle').addEventListener('change', e => { if (data.recording) { e.target.checked = data.autoSteps; return; } data.autoSteps = e.target.checked; save(); setStatus(data.autoSteps ? 'Contagem automática experimental ativada; confira os passos' : 'Contagem automática desligada; modo manual preciso'); });
  el('finishBtn').addEventListener('click', () => { if (!window.confirm('Finalizar este percurso? O traçado continuará salvo.')) return; data.recording = false; data.events.push(currentPoint('finish')); save(); setStatus('Percurso finalizado', false); });
  el('floorSelect').addEventListener('change', e => { if (areaVertices) { e.target.value = String(data.floor); setStatus('Finalize ou cancele o desenho da área antes de trocar de pavimento.'); return; } viewFloor = Number(e.target.value); followUser = viewFloor === data.floor; if (followUser) viewCenter={x:data.x,y:data.y}; drawMap(); });
  el('zoomIn').addEventListener('click', () => { zoom = Math.min(MAX_ZOOM, zoom + 8); drawMap(); });
  el('zoomOut').addEventListener('click', () => { zoom = Math.max(MIN_ZOOM, zoom - 8); drawMap(); });
  el('fullscreenBtn').addEventListener('click', () => setMapExpanded(!el('mapCard').classList.contains('expanded')));
  el('recenterBtn').addEventListener('click', recenterOnUser);
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('wheel', e => { if (!el('mapCard').classList.contains('expanded')) return; e.preventDefault(); zoom=Math.min(MAX_ZOOM,Math.max(MIN_ZOOM,zoom*(e.deltaY<0?1.12:0.89))); drawMap(); }, {passive:false});
  window.addEventListener('keydown', e => { if (e.key === 'Escape' && el('mapCard').classList.contains('expanded')) setMapExpanded(false); });
  canvas.addEventListener('click', e => {
    if (suppressClick) { suppressClick=false; return; }
    const r=canvas.getBoundingClientRect();
    const x=viewCenter.x+(e.clientX-r.left-r.width/2)/zoom;
    const y=viewCenter.y-(e.clientY-r.top-r.height/2)/zoom;
    if (areaVertices) { areaVertices.push({x:round(x),y:round(y)}); renderAreaTools(); drawMap(); setStatus(`${areaVertices.length} ponto${areaVertices.length===1?'':'s'} no contorno da área`); return; }
    if (!data.recording) return;
    if (viewFloor !== data.floor) { setStatus('Volte ao pavimento atual para corrigir sua posição.'); return; }
    correctPosition(x,y);
  });
  el('markerForm').addEventListener('submit', e => {
    e.preventDefault();
    if (e.submitter && e.submitter.value === 'cancel') { el('markerDialog').close(); return; }
    const name=el('markerName').value, color=el('markerColor').value;
    el('markerDialog').close(); addMarker(name,color,pendingShape); if (pendingShape==='area') cancelArea();
  });
  el('exportBtn').addEventListener('click', exportData);
  el('importInput').addEventListener('change', e => { if (e.target.files && e.target.files[0]) importData(e.target.files[0]); });
  el('clearTrackBtn').addEventListener('click', () => { if (!window.confirm('Apagar os traçados e a contagem de passos, mantendo os pontos e áreas salvos?')) return; data.events=[]; data.stepCount=0; data.x=0; data.y=0; data.heading=0; data.floor=0; data.recording=false; viewFloor=0; viewCenter={x:0,y:0}; followUser=true; undoStack=[]; cancelArea(); save(); setStatus('Traçado apagado; pontos e áreas preservados'); });
  el('clearBtn').addEventListener('click', () => { if (!window.confirm('Apagar permanentemente os percursos e pontos salvos neste aparelho? Exporte uma cópia antes se quiser guardar.')) return; localStorage.removeItem(KEY); data=defaultData(); viewFloor=0; viewCenter={x:0,y:0}; followUser=true; undoStack=[]; cancelArea(); save(); setStatus('Dados apagados'); });
  window.addEventListener('resize', resizeCanvas);
  window.addEventListener('orientationchange', () => setTimeout(resizeCanvas,200));
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredInstall=e; el('installBtn').classList.remove('hidden'); });
  el('installBtn').addEventListener('click', async () => { if (!deferredInstall) return; deferredInstall.prompt(); await deferredInstall.userChoice; deferredInstall=null; el('installBtn').classList.add('hidden'); });
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
  el('mapHint').textContent='Arraste para percorrer o mapa; toque para corrigir sua posição';
  resizeCanvas(); render();
})();
