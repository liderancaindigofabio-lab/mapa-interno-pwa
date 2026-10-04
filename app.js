(() => {
  'use strict';
  const KEY = 'huse-mapa-interno-v1';
  const STEP_METERS = 0.65;
  const MAX_ZOOM = 70;
  const MIN_ZOOM = 12;
  const defaultData = () => ({ version: 1, floor: 0, x: 0, y: 0, heading: 0, recording: false, events: [], markers: [], stepCount: 0 });
  let data = loadData();
  let viewFloor = data.floor;
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
      return { ...defaultData(), ...parsed, recording: false };
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
  function addStep() {
    if (!data.recording) return;
    remember();
    data.x += Math.sin(data.heading) * STEP_METERS;
    data.y += Math.cos(data.heading) * STEP_METERS;
    data.stepCount += 1;
    data.events.push(currentPoint('move'));
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
    lastAlpha = null; lastCompass = null; compassOffset = null;
    save(); setStatus('Registrando percurso', true); el('startBtn').textContent = 'Pausar percurso';
    requestMotion();
  }
  async function requestMotion() {
    let motionAllowed = true;
    let orientationAllowed = true;
    try {
      if ('DeviceMotionEvent' in window && typeof window.DeviceMotionEvent.requestPermission === 'function') {
        motionAllowed = await window.DeviceMotionEvent.requestPermission() === 'granted';
      }
    } catch (_) { motionAllowed = false; }
    try {
      if ('DeviceOrientationEvent' in window && typeof window.DeviceOrientationEvent.requestPermission === 'function') {
        orientationAllowed = await window.DeviceOrientationEvent.requestPermission() === 'granted';
      }
    } catch (_) { orientationAllowed = false; }
    if (motionAllowed && 'DeviceMotionEvent' in window && !motionReady) {
      window.addEventListener('devicemotion', onMotion, { passive: true }); motionReady = true;
    }
    if (orientationAllowed && 'DeviceOrientationEvent' in window && !orientationReady) {
      window.addEventListener('deviceorientation', onOrientation, { passive: true }); orientationReady = true;
    }
    const stepMsg = motionReady ? 'passos estimados pelo sensor' : 'passos manuais';
    const turnMsg = orientationReady ? 'curvas acompanhadas pela orientação do celular; corrija pelos botões se precisar.' : 'curvas registradas pelos botões de virar.';
    el('sensorMessage').textContent = `Registro: ${stepMsg}; ${turnMsg} A precisão é aproximada.`;
  }
  function onMotion(event) {
    if (!data.recording) return;
    const a = event.acceleration;
    const g = event.accelerationIncludingGravity;
    let magnitude = null;
    if (a && a.x !== null && a.y !== null && a.z !== null) magnitude = Math.hypot(a.x, a.y, a.z);
    else if (g && g.x !== null && g.y !== null && g.z !== null) magnitude = Math.abs(Math.hypot(g.x, g.y, g.z) - 9.81);
    if (magnitude === null) return;
    const now = Date.now();
    const threshold = a && a.x !== null ? 1.35 : 1.05;
    if (magnitude > threshold && !wasAbove && now - lastPeak > 340) {
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
      drawMap();
      return;
    }
    if (!Number.isFinite(event.alpha)) return;
    if (lastAlpha === null) { lastAlpha = event.alpha; return; }
    const delta = shortestDegrees(event.alpha - lastAlpha);
    lastAlpha = event.alpha;
    // Device alpha rotates opposite to compass heading; use relative rotation so the first direction is the map's forward axis.
    data.heading = normalize(data.heading - radians(delta));
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
    el('floorSelect').value = String(viewFloor); save();
    setStatus(`${direction > 0 ? 'Subida' : 'Descida'} registrada: ${floorName(next)}`);
  }
  function correctPosition(x, y) {
    remember(); data.x = x; data.y = y; data.floor = viewFloor;
    data.events.push(currentPoint('correction')); save();
    setStatus('Posição corrigida manualmente');
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
    areaVertices = [];
    renderAreaTools(); drawMap();
    setStatus('Toque no contorno da área para adicionar pontos');
  }
  function cancelArea() {
    areaVertices = null; renderAreaTools(); drawMap();
    if (el('mapHint')) el('mapHint').textContent = 'Toque no mapa para corrigir sua posição';
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
    viewFloor = data.floor; el('floorSelect').value = String(viewFloor); save(); setStatus('Último movimento desfeito');
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
    const scale = zoom; const cx = data.x; const cy = data.y;
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
      if (m.shape === 'area' && Array.isArray(m.vertices) && m.vertices.length >= 3) {
        ctx.beginPath(); m.vertices.forEach((p,i) => { if (i===0) ctx.moveTo(sx(p.x),sy(p.y)); else ctx.lineTo(sx(p.x),sy(p.y)); }); ctx.closePath();
        ctx.save(); ctx.globalAlpha = .22; ctx.fillStyle = m.color; ctx.fill(); ctx.restore();
        ctx.strokeStyle = m.color; ctx.lineWidth = 2; ctx.stroke();
        ctx.fillStyle='#25352f';ctx.font='600 12px system-ui';ctx.textAlign='center';ctx.fillText(m.name.slice(0,24),sx(m.x),sy(m.y));ctx.textAlign='start';
      } else {
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
    if (!data.events.some(p => p.floor === viewFloor) && !data.markers.some(p => p.floor === viewFloor) && !areaVertices) { ctx.fillStyle='#829089';ctx.textAlign='center';ctx.font='14px system-ui';ctx.fillText('Comece um percurso para desenhar o mapa',w/2,h/2+50);ctx.textAlign='start'; }
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
      const del = document.createElement('button'); del.type='button'; del.textContent='Apagar'; del.setAttribute('aria-label',`Apagar ${marker.name}`); del.addEventListener('click', () => { data.markers = data.markers.filter(m => m.id !== marker.id); save(); });
      row.append(swatch, info, del); list.append(row);
    }
  }
  function render() {
    el('floorSelect').value = String(viewFloor);
    el('stepText').textContent = `${data.stepCount} ${data.stepCount === 1 ? 'passo' : 'passos'}`;
    el('startBtn').textContent = data.recording ? 'Pausar percurso' : (data.events.length && data.events[data.events.length - 1].type !== 'finish' ? 'Continuar percurso' : 'Começar percurso');
    for (const id of ['leftBtn','rightBtn','stepBtn','markBtn','areaBtn','floorUpBtn','floorDownBtn','undoBtn','finishBtn']) el(id).disabled = !data.recording;
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
        data.floor = Math.max(0, Math.min(2, Number(data.floor) || 0)); viewFloor = data.floor; undoStack = []; save();
      } catch (_) { window.alert('Não consegui ler esse arquivo como uma cópia válida do Mapa Interno.'); }
      el('importInput').value = '';
    };
    reader.readAsText(file);
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
  el('finishBtn').addEventListener('click', () => { if (!window.confirm('Finalizar este percurso? O traçado continuará salvo.')) return; data.recording = false; data.events.push(currentPoint('finish')); save(); setStatus('Percurso finalizado', false); });
  el('floorSelect').addEventListener('change', e => { if (areaVertices) { e.target.value = String(data.floor); setStatus('Finalize ou cancele o desenho da área antes de trocar de pavimento.'); return; } viewFloor = Number(e.target.value); drawMap(); });
  el('zoomIn').addEventListener('click', () => { zoom = Math.min(MAX_ZOOM, zoom + 8); drawMap(); });
  el('zoomOut').addEventListener('click', () => { zoom = Math.max(MIN_ZOOM, zoom - 8); drawMap(); });
  canvas.addEventListener('click', e => {
    if (!data.recording) { setStatus('Comece um percurso para corrigir a posição.'); return; }
    const r = canvas.getBoundingClientRect(); const x = data.x + (e.clientX - r.left - r.width/2)/zoom; const y = data.y - (e.clientY - r.top - r.height/2)/zoom;
    if (areaVertices) { areaVertices.push({ x: round(x), y: round(y) }); renderAreaTools(); drawMap(); setStatus(`${areaVertices.length} ponto${areaVertices.length===1?'':'s'} no contorno da área`); return; }
    correctPosition(x,y);
  });
  el('markerForm').addEventListener('submit', e => {
    e.preventDefault();
    if (e.submitter && e.submitter.value === 'cancel') { el('markerDialog').close(); return; }
    const name = el('markerName').value; const color = el('markerColor').value;
    el('markerDialog').close(); addMarker(name,color,pendingShape); if (pendingShape === 'area') cancelArea();
  });
  el('exportBtn').addEventListener('click', exportData);
  el('importInput').addEventListener('change', e => { if (e.target.files && e.target.files[0]) importData(e.target.files[0]); });
  el('clearBtn').addEventListener('click', () => { if (!window.confirm('Apagar permanentemente os percursos e pontos salvos neste aparelho? Exporte uma cópia antes se quiser guardar.')) return; localStorage.removeItem(KEY); data = defaultData(); viewFloor = 0; undoStack = []; cancelArea(); save(); setStatus('Dados apagados'); });
  window.addEventListener('resize', resizeCanvas);
  window.addEventListener('orientationchange', () => setTimeout(resizeCanvas, 200));
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredInstall = e; el('installBtn').classList.remove('hidden'); });
  el('installBtn').addEventListener('click', async () => { if (!deferredInstall) return; deferredInstall.prompt(); await deferredInstall.userChoice; deferredInstall = null; el('installBtn').classList.add('hidden'); });
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
  resizeCanvas(); render();
})();
