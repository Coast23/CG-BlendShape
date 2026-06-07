/**
 * CG-BlendShape — Three.js + VRM expression editor + webcam face tracking.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';

// ── DOM ────────────────────────────────────────────────────────────────────
const loadingOverlay   = document.getElementById('loading-overlay');
const loadingProgress  = document.getElementById('loading-progress');
const loadingText      = document.getElementById('loading-text');
const canvas3d         = document.getElementById('canvas3d');
const slidersContainer = document.getElementById('sliders-container');
const webcamBtn        = document.getElementById('webcam-btn');
const landmarksBtn     = document.getElementById('landmarks-btn');
const webcamStatus     = document.getElementById('webcam-status');
const webcamVideo      = document.getElementById('webcam-video');
const landmarksCanvas  = document.getElementById('landmarks-canvas');
const resetBtn         = document.getElementById('reset-btn');

// ── Three.js scene ──────────────────────────────────────────────────────────
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.2;
canvas3d.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = null; // transparent → body bg shows through
// fog removed for transparent bg

const camera = new THREE.PerspectiveCamera(35, 2, 0.05, 20);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; controls.dampingFactor = 0.08;
controls.minDistance = 0.5; controls.maxDistance = 4.0;
controls.minPolarAngle = 0.25; controls.maxPolarAngle = 1.35;
controls.update();

const keyLight = new THREE.DirectionalLight(0xffeedd, 4.5);
keyLight.position.set(1.5, 2.5, 2.0);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(1024, 1024);
keyLight.shadow.camera.near = 0.1; keyLight.shadow.camera.far = 10;
keyLight.shadow.camera.left = -2; keyLight.shadow.camera.right  = 2;
keyLight.shadow.camera.top  =  3; keyLight.shadow.camera.bottom = -1;
keyLight.shadow.bias = -0.0002;
scene.add(keyLight);

const fillLight = new THREE.DirectionalLight(0xaaccff, 1.8);
fillLight.position.set(-1.2, 0.6, 1.5); scene.add(fillLight);

const rimLight = new THREE.DirectionalLight(0xffaacc, 2.0);
rimLight.position.set(0, 0.8, -1.5); scene.add(rimLight);

scene.add(new THREE.AmbientLight(0x334466, 1.2));
scene.add(new THREE.HemisphereLight(0x8899cc, 0x334455, 0.6));

// Face mesh topology for 2D canvas overlay
const LM_EDGES = [
  [10,338],[338,297],[297,332],[332,284],[284,251],[251,389],[389,356],
  [356,454],[454,323],[323,361],[361,288],[288,397],[397,365],[365,379],
  [379,378],[378,400],[400,377],[377,152],[152,148],[148,176],[176,149],
  [149,150],[150,136],[136,172],[172,58],[58,132],[132,93],[93,234],
  [234,127],[127,162],[162,21],[21,54],[54,103],[103,67],[67,109],[109,10],
  [33,7],[7,163],[163,144],[144,145],[145,153],[153,154],[154,155],[155,133],
  [33,246],[246,161],[161,160],[160,159],[159,158],[158,157],[157,173],[173,133],
  [362,382],[382,381],[381,380],[380,374],[374,373],[373,390],[390,249],
  [263,466],[466,388],[388,387],[387,386],[386,385],[385,384],[384,398],[398,362],
  [61,146],[146,91],[91,181],[181,84],[84,17],[17,314],[314,405],[405,321],
  [321,375],[375,291],[291,409],[409,270],[270,269],[269,267],[267,0],
  [0,37],[37,39],[39,40],[40,185],[185,61],
  [78,191],[191,80],[80,81],[81,82],[82,13],[13,312],[312,311],[311,310],
  [310,415],[415,308],[308,324],[324,318],[318,402],[402,317],[317,14],
  [14,87],[87,178],[178,88],[88,95],[95,78],
  [70,63],[63,105],[105,66],[66,107],
  [336,296],[296,334],[334,293],[293,300],
  [168,6],[6,197],[197,195],[195,5],[5,4],
];

// ── Resize ──────────────────────────────────────────────────────────────────
function resize() {
  const w = canvas3d.clientWidth, h = canvas3d.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / Math.max(h, 1);
  camera.updateProjectionMatrix();
  if (foilMode) {
    buildClothGeom();
    camera.position.set(CAM_PX, CAM_PY, CAM_PZ);
    controls.target.set(CAM_TX, CAM_TY, CAM_TZ); camera.lookAt(CAM_TX, CAM_TY, CAM_TZ);
    camera.aspect = w / Math.max(h, 1);
    camera.updateProjectionMatrix();
  }
}
window.addEventListener('resize', resize);

// ── State ───────────────────────────────────────────────────────────────────
let vrm = null;
const clock = new THREE.Clock();
const expressionSliders = {};
const expressionEntries = [];
let useWebcam = false;
let showLandmarks = false;
let faceLandmarker = null;
let webcamStream = null;
let lastFaceTime = -1;
let lastMpTimestamp = -1;
let currentLandmarks3D = null;
let foilMode = false;

resize(); // safe to call now — all state variables are initialized

// ── Helpers ─────────────────────────────────────────────────────────────────
function getExpressionNames() {
  if (!vrm?.expressionManager) return [];
  return vrm.expressionManager.expressions.map(e => e.expressionName);
}
function sortExpressionNames(names) {
  return [...names].sort((a,b) => a.length - b.length || a.localeCompare(b));
}
function formatLabel(n) {
  return n.replace(/[_-]/g,' ').replace(/([a-z])([A-Z])/g,'$1 $2')
    .replace(/\b\w/g, c => c.toUpperCase());
}
function setSlider(name, w) {
  const s = expressionSliders[name];
  if (!s) return;
  s.value = String(Math.round(w * 100));
  for (const e of expressionEntries)
    if (e.name === name) e.valueEl.textContent = Math.round(w * 100) + '%';
}

// ── Load VRM (from URL string, reusable) ────────────────────────────────────
async function loadVRM(url) {
  loadingOverlay.style.display = 'flex';
  loadingOverlay.style.opacity = '1';
  loadingOverlay.style.pointerEvents = 'auto';
  loadingText.textContent = 'Loading model...';
  loadingProgress.style.width = '0%';

  // Clean up previous model
  if (vrm) {
    scene.remove(vrm.scene);
    // Dispose geometry/materials
    vrm.scene.traverse(n => {
      if (n.geometry) n.geometry.dispose();
      if (n.material) {
        if (Array.isArray(n.material)) n.material.forEach(m => m.dispose());
        else n.material.dispose();
      }
    });
    vrm = null;
  }
  slidersContainer.innerHTML = '';
  expressionEntries.length = 0;
  for (const k of Object.keys(smoothState)) delete smoothState[k];

  const loader = new GLTFLoader();
  loader.register(p => new VRMLoaderPlugin(p, { autoUpdateHumanBones: true }));

  const gltf = await new Promise((resolve, reject) => {
    loader.load(url, resolve, e => {
      if (e.total > 0) {
        const pct = Math.round((e.loaded / e.total) * 100);
        loadingProgress.style.width = pct + '%';
        loadingText.textContent =
          `Loading model... ${pct}% (${(e.loaded/1024/1024).toFixed(1)} MB)`;
      }
    }, reject);
  });

  vrm = gltf.userData.vrm;
  if (!vrm) throw new Error('No VRM data');

  // Model loaded successfully

  // Face + head-adjacent mesh filtering
  const faceP = new Set();
  for (const expr of vrm.expressionManager.expressions)
    for (const b of expr.binds) if (b.primitives) b.primitives.forEach(p => faceP.add(p));

  const headBone = vrm.humanoid?.getNormalizedBoneNode?.('head');
  const hp = new THREE.Vector3(); if (headBone) headBone.getWorldPosition(hp);

  gltf.scene.traverse(n => {
    if (!n.isMesh && !n.isSkinnedMesh) return;
    if (faceP.has(n)) return;
    const box = new THREE.Box3().setFromObject(n);
    const c = new THREE.Vector3(); box.getCenter(c);
    n.visible = c.distanceTo(hp) < 0.4;
    // hide non-face meshes
  });

  VRMUtils.removeUnnecessaryJoints(gltf.scene);
  if (vrm.meta?.metaVersion === '0') VRMUtils.rotateVRM0(vrm);
  scene.add(vrm.scene);

  // Ensure world matrices are current before reading head bone position
  vrm.scene.updateMatrixWorld();
  if (foilMode) {
    // Reload in 2D: re-point vrmCamera at new head, rebuild cloth, restore view
    const h = vrm?.humanoid?.getNormalizedBoneNode?.('head');
    if (h) { const p = new THREE.Vector3(); h.getWorldPosition(p); vrmCamera.position.set(p.x - 0.02, p.y, p.z + 1.0); vrmCamera.lookAt(p); }
    camera.fov = 50;
    camera.position.set(CAM_PX, CAM_PY, CAM_PZ);
    controls.target.set(CAM_TX, CAM_TY, CAM_TZ); camera.lookAt(CAM_TX, CAM_TY, CAM_TZ);
    camera.aspect = canvas3d.clientWidth / Math.max(1, canvas3d.clientHeight);
    camera.updateProjectionMatrix();
    buildClothGeom();
  } else {
    focusOnHead();
  }

  const names = getExpressionNames();
  createSliders(names);

  loadingOverlay.style.opacity = '0';
  loadingOverlay.style.pointerEvents = 'none';
  setTimeout(() => { loadingOverlay.style.display = 'none'; }, 400);
}

function focusOnHead() {
  const h = vrm?.humanoid?.getNormalizedBoneNode?.('head');
  if (h) {
    const p = new THREE.Vector3(); h.getWorldPosition(p);
    controls.target.copy(p);
    // Head bone is behind the visual face center. Shift target to where the face
    // actually is: right (+X), slightly down (-Y), forward (+Z) from bone.
    const target = new THREE.Vector3(p.x + 0.08, p.y - 0.02, p.z + 0.10);
    controls.target.copy(target);
    camera.position.set(target.x, target.y, target.z + 0.8);
    camera.lookAt(target);
  }
  controls.update();
}

// ── Sliders ─────────────────────────────────────────────────────────────────
function createSliders(names) {
  slidersContainer.innerHTML = '';
  expressionEntries.length = 0;

  const sorted = sortExpressionNames(names);
  if (!sorted.length) {
    slidersContainer.innerHTML = '<p class="slider-empty">No expressions found.</p>';
    return;
  }
  sorted.forEach(name => {
    const row = document.createElement('div'); row.className = 'slider-row';
    const label = document.createElement('span');
    label.textContent = formatLabel(name); label.className = 'slider-label'; label.title = name;
    const s = document.createElement('input');
    s.type = 'range'; s.min = '0'; s.max = '100'; s.value = '0';
    const v = document.createElement('span');
    v.className = 'slider-value'; v.textContent = '0%';
    s.addEventListener('input', () => {
      const w = parseInt(s.value) / 100;
      vrm.expressionManager.setValue(name, w);
      v.textContent = Math.round(w * 100) + '%';
    });
    row.append(label, s, v);
    slidersContainer.appendChild(row);
    expressionSliders[name] = s;
    expressionEntries.push({ name, slider: s, valueEl: v });
  });
}

// ── Reset ───────────────────────────────────────────────────────────────────
resetBtn.addEventListener('click', () => {
  if (!vrm) return;
  for (const e of expressionEntries) { vrm.expressionManager.setValue(e.name, 0); setSlider(e.name, 0); }
});

// ══════════════════════════════════════════════════════════════════════════════
// Webcam + MediaPipe face tracking
// ══════════════════════════════════════════════════════════════════════════════

const BLENDSHAPE_MAP = {
  mouthSmileLeft:'happy', mouthSmileRight:'happy', cheekSquintLeft:'happy', cheekSquintRight:'happy',
  browDownLeft:'angry', browDownRight:'angry', noseSneerLeft:'angry', noseSneerRight:'angry',
  mouthFrownLeft:'sad', mouthFrownRight:'sad', browInnerUp:'sad',
  jawOpen:'surprised', browOuterUpLeft:'surprised', browOuterUpRight:'surprised',
  mouthUpperUpLeft:'surprised', mouthUpperUpRight:'surprised',
  eyeBlinkLeft:'blink', eyeBlinkRight:'blink',
  // mouthPucker / mouthFunnel removed — MediaPipe reports 0.9+ on some
  // neutral faces, making "ou" unusable via tracking. Use the slider instead.
  mouthDimpleLeft:'relaxed', mouthDimpleRight:'relaxed',
  mouthStretchLeft:'relaxed', mouthStretchRight:'relaxed',
  // Note: eyeSquint intentionally NOT mapped — it fires too easily on neutral
  // faces, causing permanent squint. eyeBlink covers deliberate eye closure.
};
const XREF = { joy:'happy', happy:'joy', sorrow:'sad', sad:'sorrow', fun:'relaxed', relaxed:'fun' };

// EMA smoothing state: { expressionName: currentSmoothedValue }
const smoothState = {};

async function setupMediaPipe() {
  if (faceLandmarker) return true;
  webcamStatus.textContent = 'Downloading MediaPipe (may be slow in China)...';
  try {
    const { FaceLandmarker, FilesetResolver } = await import('@mediapipe/tasks-vision');
    const vision = await FilesetResolver.forVisionTasks(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10/wasm',
    );
    faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath:
          'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task',
        delegate: 'GPU',
      },
      outputFaceBlendshapes: true,
      outputFacialTransformationMatrixes: false,
      runningMode: 'VIDEO',
      numFaces: 1,
    });
    webcamStatus.textContent = 'Tracker ready';
    return true;
  } catch (err) {
    console.error('MediaPipe load error:', err);
    webcamStatus.textContent = 'Failed: CDN unreachable. Try VPN/proxy.';
    return false;
  }
}

async function startWebcam() {
  if (!webcamStream) {
    webcamStream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480, facingMode: 'user' },
    });
    webcamVideo.srcObject = webcamStream;
    await webcamVideo.play();
    webcamVideo.style.display = 'block';
    landmarksCanvas.style.display = 'block';
    landmarksCanvas.width = 640; landmarksCanvas.height = 480;
    landmarksBtn.disabled = false;
  }
}

function stopWebcam() {
  if (faceLandmarker) { try { faceLandmarker.close(); } catch {} faceLandmarker = null; }
  if (webcamStream) { webcamStream.getTracks().forEach(t => t.stop()); webcamStream = null; }
  webcamVideo.srcObject = null;
  webcamVideo.style.display = 'none';
  landmarksCanvas.style.display = 'none';
  useWebcam = false; showLandmarks = false;
  currentLandmarks3D = null;
  webcamBtn.textContent = 'Enable'; webcamBtn.classList.remove('active');
  landmarksBtn.classList.remove('active'); landmarksBtn.textContent = 'Dots';
  landmarksBtn.disabled = true;
  webcamStatus.textContent = 'Idle';
  clearLandmarks2D();
}

// ── Per-frame face detection ──────────────────────────────────────────────
const CALIBRATION_FRAMES = 60; // ~2 seconds at 30fps
let calibrationCount = 0;
const calibSums = {}; // { vrmExpressionName: sum } → averaged after calibration

function detectFace() {
  if (!useWebcam || !faceLandmarker || !vrm) return;
  if (webcamVideo.readyState < 2) return;

  const now = performance.now();
  if (now - lastFaceTime < 33) return;
  lastFaceTime = now;

  // Monotonic timestamp
  let ts = Math.floor(webcamVideo.currentTime * 1000);
  if (ts <= lastMpTimestamp) ts = lastMpTimestamp + 1;
  lastMpTimestamp = ts;

  // ── Call MediaPipe ──
  let res;
  try {
    res = faceLandmarker.detectForVideo(webcamVideo, ts);
  } catch (err) {
    console.error('[detectFace] error:', err?.message || err);
    return;
  }

  // ── 2D landmarks overlay ──
  if (res.faceLandmarks?.length) {
    currentLandmarks3D = res.faceLandmarks[0].map(l => ({ x: l.x, y: l.y, z: l.z }));
    if (showLandmarks) drawLandmarks2D();
  } else {
    currentLandmarks3D = null;
  }

  // ── blendshapes → VRM ──
  if (res.faceBlendshapes?.length) {
    // Calibration: collect first N frames as neutral baseline
    if (calibrationCount < CALIBRATION_FRAMES) {
      // Per-frame: max over MP blendshapes that map to the same VRM expression
      const frameMax = {};
      for (const bs of res.faceBlendshapes[0].categories) {
        const tgt = BLENDSHAPE_MAP[bs.categoryName];
        if (!tgt) continue;
        frameMax[tgt] = Math.max(frameMax[tgt] || 0, bs.score);
      }
      // Accumulate per-frame maxes for averaging
      for (const [tgt, score] of Object.entries(frameMax)) {
        calibSums[tgt] = (calibSums[tgt] || 0) + score;
      }
      calibrationCount++;
      if (calibrationCount === CALIBRATION_FRAMES) {
        for (const k of Object.keys(calibSums)) calibSums[k] /= CALIBRATION_FRAMES;
        webcamStatus.textContent = 'Tracking';
      } else {
        webcamStatus.textContent = `Calibrating… ${Math.round(calibrationCount/CALIBRATION_FRAMES*100)}%`;
      }
      return;
    }

    // Per-frame accumulation (use max for many-to-one mappings)
    const accum = {};
    for (const bs of res.faceBlendshapes[0].categories) {
      const tgt = BLENDSHAPE_MAP[bs.categoryName];
      if (!tgt) continue;
      const bl = calibSums[tgt] || 0;
      // Remap: baseline→0, 1.0→1.0, with minimum range of 0.2 to avoid blowup
      const range = Math.max(0.12, 1.0 - bl);
      const rel = Math.max(0, (bs.score - bl) / range);
      accum[tgt] = Math.max(accum[tgt]||0, rel);
      const alt = XREF[tgt];
      if (alt) accum[alt] = Math.max(accum[alt]||0, rel);
    }

    let topName = '', topVal = 0;
    for (const entry of expressionEntries) {
      const key = entry.name.toLowerCase();
      let raw = accum[key] ?? 0;
      if (raw === 0) { const alt = XREF[key]; if (alt && accum[alt]) raw = accum[alt]; }
      raw = Math.min(1, raw);
      // EMA smooth: fast attack, slower release to avoid twitching at neutral
      const prev = smoothState[entry.name] ?? 0;
      const attackFactor  = 0.65;  // rising  → snappy response
      const releaseFactor = 0.25;  // falling → gentle return, suppresses noise
      const factor = raw > prev ? attackFactor : releaseFactor;
      const smoothed = prev + (raw - prev) * factor;
      smoothState[entry.name] = smoothed;

      // Per-expression gain (after baseline subtraction, deviations are smaller)
      const isBlink = entry.name.toLowerCase() === 'blink' || entry.name.toLowerCase().startsWith('blink');
      const gain = isBlink ? 2.8 : 1.8;

      // Dead zone: values under threshold forced to 0 (baseline already subtracted)
      const deadZone = isBlink ? 0.06 : 0.04;
      const clamped = smoothed < deadZone ? 0 : Math.min(1, smoothed * gain);
      vrm.expressionManager.setValue(entry.name, clamped);
      if (entry.slider.value !== String(Math.round(clamped * 100)))
        setSlider(entry.name, clamped);
      if (clamped > topVal) { topVal = clamped; topName = entry.name; }
    }

    webcamStatus.textContent = topVal > 0.05
      ? `Tracking: ${formatLabel(topName)} ${(topVal*100).toFixed(0)}%`
      : 'Tracking — no strong expression detected';
  }
}

// ── 2D landmarks (webcam overlay) ─────────────────────────────────────────
function clearLandmarks2D() {
  const ctx = landmarksCanvas.getContext('2d');
  ctx.clearRect(0, 0, landmarksCanvas.width, landmarksCanvas.height);
}
function drawLandmarks2D() {
  if (!currentLandmarks3D) return;
  const ctx = landmarksCanvas.getContext('2d');
  const w = landmarksCanvas.width, h = landmarksCanvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(255,68,136,0.4)'; ctx.lineWidth = 0.5;
  for (const [i,j] of LM_EDGES) {
    const a = currentLandmarks3D[i], b = currentLandmarks3D[j];
    if (!a||!b) continue;
    ctx.beginPath(); ctx.moveTo(a.x*w, a.y*h); ctx.lineTo(b.x*w, b.y*h); ctx.stroke();
  }
  ctx.fillStyle = 'rgba(255,68,136,0.8)';
  for (const lm of currentLandmarks3D) {
    ctx.beginPath(); ctx.arc(lm.x*w, lm.y*h, 1.2, 0, Math.PI*2); ctx.fill();
  }
}

function toggleLandmarks() {
  showLandmarks = !showLandmarks;
  landmarksBtn.classList.toggle('active', showLandmarks);
  landmarksBtn.textContent = showLandmarks ? 'Dots ON' : 'Dots';
  if (showLandmarks) {
    if (currentLandmarks3D) drawLandmarks2D();
  } else {
    clearLandmarks2D();
  }
}
landmarksBtn.addEventListener('click', toggleLandmarks);

// ── Webcam toggle ─────────────────────────────────────────────────────────
async function toggleWebcam() {
  if (useWebcam) { stopWebcam(); return; }
  webcamBtn.textContent = 'Initializing...'; webcamBtn.disabled = true;

  try {
    if (!(await setupMediaPipe())) {
      webcamBtn.textContent = 'Enable'; webcamBtn.disabled = false; return;
    }
    await startWebcam();
    useWebcam = true;
    lastMpTimestamp = -1;
    calibrationCount = 0;
    for (const k of Object.keys(calibSums)) delete calibSums[k];
    webcamBtn.textContent = 'Disable';
    webcamBtn.classList.add('active');
    webcamBtn.disabled = false;
    webcamStatus.textContent = 'Tracking — move your face';
    lastFaceTime = -1;
  } catch {
    webcamBtn.textContent = 'Enable'; webcamBtn.disabled = false;
  }
}
webcamBtn.addEventListener('click', toggleWebcam);

// ══════════════════════════════════════════════════════════════════════════════
// 2D cloth simulation
// ══════════════════════════════════════════════════════════════════════════════

// DOM
const mode3dBtn = document.getElementById('mode-3d-btn');
const mode2dBtn = document.getElementById('mode-2d-btn');
const clothSection = document.getElementById('cloth-section');
const clothWindSlider = document.getElementById('cloth-wind');
const clothOrbitSlider = document.getElementById('cloth-orbit');
const clothWireBtn = document.getElementById('cloth-wire-btn');
const clothFreecamBtn = document.getElementById('cloth-freecam-btn');
const clothResetBtn = document.getElementById('cloth-reset-btn');

// Camera save/restore
const saved3D = { pos: new THREE.Vector3(), target: new THREE.Vector3() };
const RT_SIZE = 1024;
const rt = new THREE.WebGLRenderTarget(RT_SIZE, RT_SIZE);
rt.texture.colorSpace = THREE.SRGBColorSpace;
const vrmCamera = new THREE.PerspectiveCamera(35, 1, 0.05, 20);
vrmCamera.aspect = 1; // square render target

// Cloth scene
const clothScene = new THREE.Scene();
clothScene.background = null; // transparent → body bg shows through
clothScene.add(new THREE.AmbientLight(0xffffff, 0.6));
const clothSun = new THREE.DirectionalLight(0xffffff, 1.5);
clothSun.position.set(10, 100, 10); clothScene.add(clothSun);
const clothSun2 = new THREE.DirectionalLight(0xffffff, 0.5);
clothSun2.position.set(-10, 50, -10); clothScene.add(clothSun2);

// Foil texture — used as VRM scene background so it composites into the RT
const foilTex = new THREE.TextureLoader().load(import.meta.env.BASE_URL + 'assets/foil.png');
foilTex.colorSpace = THREE.SRGBColorSpace;

// Cloth geometry — built dynamically in initCloth() based on canvas size
const CRX = 40, CRY = 30;
const _cidx = (x, y) => y * (CRX + 1) + x; // module-level for clothDisturb
let clothGeo, clothMat, clothMesh, clothWireGeo, clothWireMat, clothWireMesh;
let cVertCount, cSprings, cPos, cVel, cInit, CW, CH;

function buildClothGeom() {
  // Remove old mesh if exists
  if (clothMesh) { clothScene.remove(clothMesh); clothMesh.geometry.dispose(); }

  // Grid size ~55% of visible area (like the demo's proportions)
  const aspect = canvas3d.clientWidth / Math.max(1, canvas3d.clientHeight);
  // Grid: fixed physical size (consistent physics), camera distance controls screen size
  CW = 6.0; CH = 4.5;

  const cidx = _cidx;
  const cverts = [], cuvs = [], cindices = [];
  for (let y = 0; y <= CRY; y++) for (let x = 0; x <= CRX; x++) {
    cverts.push((x / CRX - 0.5) * CW, 0, (y / CRY - 0.5) * CH);
    cuvs.push(x / CRX, y / CRY);
  }
  for (let y = 0; y < CRY; y++) for (let x = 0; x < CRX; x++) {
    const a = cidx(x, y), b = cidx(x + 1, y), c = cidx(x, y + 1), d = cidx(x + 1, y + 1);
    cindices.push(a, b, c, b, d, c);
  }
  clothGeo = new THREE.BufferGeometry();
  clothGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(cverts), 3));
  clothGeo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(cuvs), 2));
  clothGeo.setIndex(cindices);
  clothGeo.computeVertexNormals();

  clothMat = new THREE.MeshStandardMaterial({ roughness: 0.4, metalness: 0.05, side: THREE.DoubleSide });
  clothMesh = new THREE.Mesh(clothGeo, clothMat);
  clothMesh.position.set(CLOTH_X, CLOTH_Y, 0);
  clothScene.add(clothMesh);

  // Wireframe
  clothWireGeo = clothGeo.clone();
  clothWireMat = new THREE.MeshBasicMaterial({ color: 0x4488ff, wireframe: true, transparent: true, opacity: 0.5, depthTest: true });
  clothWireMesh = new THREE.Mesh(clothWireGeo, clothWireMat);
  clothMesh.add(clothWireMesh);
  clothWireMesh.visible = clothWire;

  // Springs
  cVertCount = (CRX + 1) * (CRY + 1);
  cSprings = Array.from({ length: cVertCount }, () => []);
  for (let y = 0; y <= CRY; y++) for (let x = 0; x <= CRX; x++) {
    const i = cidx(x, y);
    if (x < CRX) { const j = cidx(x + 1, y); cSprings[i].push([i, j]); cSprings[j].push([i, j]); }
    if (y < CRY) { const j = cidx(x, y + 1); cSprings[i].push([i, j]); cSprings[j].push([i, j]); }
  }
  cPos = clothGeo.attributes.position.array;
  cVel = new Float32Array(cPos.length);
  cInit = new Float32Array(cPos);
}

// Cloth physics params
const C_ELASTICITY = 0.005, C_SPRING = 25, C_DAMPING = 0.90;

// Cloth UI state
let clothWind = 0.6, clothWire = true, clothOrbitTgt = 0.15, clothOrbitSpd = 0.15, clothAngle = 0, clothFreeCam = false;
// Camera position discovered via Free Cam
const CLOTH_X = 0, CLOTH_Y = 0, CLOTH_Z = 0;
const CAM_PX = -2.13, CAM_PY = 7.67, CAM_PZ = -3.95;
const CAM_TX = -1.92, CAM_TY = -0.70, CAM_TZ = -1.27;

// Cloth mouse
const clothRay = new THREE.Raycaster(), clothMouse = new THREE.Vector2();
let clothMouseDown = false, clothMoved = false, clothStart = [0, 0];

function clothGetHit(e) {
  const rect = renderer.domElement.getBoundingClientRect();
  clothMouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  clothMouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  clothRay.setFromCamera(clothMouse, camera);
  const hits = clothRay.intersectObject(clothMesh);
  return hits[0] || null;
}
function clothDisturb(hit, str) {
  const p = hit.point, spread = 3;
  const cx = Math.round((p.x / CW + 0.5) * CRX), cz = Math.round((p.z / CH + 0.5) * CRY);
  for (let dz = -spread; dz <= spread; dz++) for (let dx = -spread; dx <= spread; dx++) {
    const nx = cx + dx, nz = cz + dz, d = Math.sqrt(dx * dx + dz * dz);
    if (nx < 0 || nx > CRX || nz < 0 || nz > CRY || d > spread) continue;
    cVel[_cidx(nx, nz) * 3 + 1] -= str * (1 - d / spread) * 0.3;
  }
}
renderer.domElement.addEventListener('pointerdown', e => {
  if (!foilMode) return;
  clothMouseDown = true; clothMoved = false; clothStart = [e.clientX, e.clientY];
});
renderer.domElement.addEventListener('pointermove', e => {
  if (!foilMode || !clothMouseDown) return;
  const dx = e.clientX - clothStart[0], dy = e.clientY - clothStart[1];
  if (!clothMoved && dx * dx + dy * dy > 9) clothMoved = true;
  const h = clothGetHit(e); if (h) clothDisturb(h, clothMoved ? 1.5 : 0);
});
window.addEventListener('pointerup', e => {
  if (!foilMode) return;
  if (clothMouseDown && !clothMoved) { const h = clothGetHit(e); if (h) clothDisturb(h, 4); }
  clothMouseDown = false;
});

function updateCloth(dt) {
  const t = performance.now() * 0.001;
  for (let sub = 0; sub < 3; sub++) {
    for (let v = 0; v < cVertCount; v++) {
      const i = v * 3;
      cVel[i + 1] -= cPos[i + 1] * C_ELASTICITY;
      if (clothWind > 0.001) {
        const seed = (cPos[i] * 13.7 + cPos[i + 2] * 17.3) % 6.283;
        cVel[i + 1] += (Math.sin(cPos[i] * 0.8 - t * 1.5 + cPos[i + 2] * 0.3 + seed) * 0.035
                      + Math.sin(cPos[i] * 0.5 - t * 0.9 - cPos[i + 2] * 0.6 - seed) * 0.022
                      + Math.sin(cPos[i] * 1.3 + t * 0.6 + seed * 0.7) * 0.014) * clothWind;
      }
      for (const [a, b] of cSprings[v]) {
        const ext = cPos[a * 3 + 1] - cPos[b * 3 + 1];
        const f = ext * C_ELASTICITY * C_SPRING;
        cVel[a * 3 + 1] -= f; cVel[b * 3 + 1] += f;
      }
      cPos[i] += cVel[i]; cPos[i + 1] += cVel[i + 1]; cPos[i + 2] += cVel[i + 2];
      cVel[i] *= C_DAMPING; cVel[i + 1] *= C_DAMPING; cVel[i + 2] *= C_DAMPING;
    }
  }
  clothGeo.attributes.position.needsUpdate = true;
  clothGeo.computeVertexNormals();
  if (clothWire) {
    const wp = clothWireGeo.attributes.position.array;
    for (let i = 0; i < wp.length; i++) wp[i] = cPos[i];
    clothWireGeo.attributes.position.needsUpdate = true;
  }
  // Orbit
  clothOrbitSpd += (clothOrbitTgt - clothOrbitSpd) * 0.1;
  clothAngle -= clothOrbitSpd * 0.016; // clockwise
  if (!clothFreeCam) {
    // Rotate camera and target together around Y-axis through cloth center
    const cos = Math.cos(clothAngle), sin = Math.sin(clothAngle);
    // camera position relative to cloth
    const crx = CAM_PX - CLOTH_X, crz = CAM_PZ - CLOTH_Z;
    camera.position.set(
      CLOTH_X + crx * cos - crz * sin,
      CAM_PY,
      CLOTH_Z + crx * sin + crz * cos,
    );
    // target relative to cloth
    const trx = CAM_TX - CLOTH_X, trz = CAM_TZ - CLOTH_Z;
    controls.target.set(
      CLOTH_X + trx * cos - trz * sin,
      CAM_TY,
      CLOTH_Z + trx * sin + trz * cos,
    );
    camera.lookAt(controls.target);
  }
}

// Cloth UI handlers
clothWindSlider.addEventListener('input', () => { clothWind = parseInt(clothWindSlider.value) / 100; });
clothOrbitSlider.addEventListener('input', () => { clothOrbitTgt = parseInt(clothOrbitSlider.value) / 100; });
clothWireBtn.addEventListener('click', function () { clothWire = !clothWire; this.classList.toggle('active', clothWire); clothWireMesh.visible = clothWire; });
clothFreecamBtn.addEventListener('click', function () {
  clothFreeCam = !clothFreeCam; this.classList.toggle('active', clothFreeCam);
  controls.enabled = clothFreeCam;
  if (!clothFreeCam) {
    const cos = Math.cos(clothAngle), sin = Math.sin(clothAngle);
    const crx = CAM_PX - CLOTH_X, crz = CAM_PZ - CLOTH_Z;
    camera.position.set(CLOTH_X + crx * cos - crz * sin, CAM_PY, CLOTH_Z + crx * sin + crz * cos);
    controls.target.set(CAM_TX, CAM_TY, CAM_TZ); camera.lookAt(CAM_TX, CAM_TY, CAM_TZ);
  }
});
clothResetBtn.addEventListener('click', () => { for (let i = 0; i < cPos.length; i++) { cPos[i] = cInit[i]; cVel[i] = 0; } clothGeo.attributes.position.needsUpdate = true; clothGeo.computeVertexNormals(); });

// Mode toggle (3D ↔ 2D)
function enterFoil() {
  if (foilMode) return;
  foilMode = true;
  mode3dBtn.classList.remove('active'); mode2dBtn.classList.add('active');
  clothSection.style.display = 'block';
  saved3D.pos.copy(camera.position); saved3D.target.copy(controls.target);
  const h = vrm?.humanoid?.getNormalizedBoneNode?.('head');
  if (h) { const p = new THREE.Vector3(); h.getWorldPosition(p); vrmCamera.position.set(p.x - 0.02, p.y, p.z + 1.0); vrmCamera.lookAt(p); }
  rt.setSize(RT_SIZE, RT_SIZE);
  scene.background = foilTex;
  buildClothGeom();
  camera.fov = 50;
  camera.position.set(CAM_PX, CAM_PY, CAM_PZ);
  controls.target.set(CAM_TX, CAM_TY, CAM_TZ); camera.lookAt(CAM_TX, CAM_TY, CAM_TZ);
  camera.aspect = canvas3d.clientWidth / Math.max(1, canvas3d.clientHeight); camera.updateProjectionMatrix();
  controls.minDistance = 3; controls.maxDistance = 40;
  controls.enabled = clothFreeCam;
}
function exitFoil() {
  if (!foilMode) return;
  foilMode = false;
  mode2dBtn.classList.remove('active'); mode3dBtn.classList.add('active');
  clothSection.style.display = 'none';
  camera.fov = 35;
  camera.position.copy(saved3D.pos); controls.target.copy(saved3D.target);
  camera.lookAt(saved3D.target);
  camera.aspect = canvas3d.clientWidth / Math.max(1, canvas3d.clientHeight); camera.updateProjectionMatrix();
  scene.background = null; // transparent → body bg shows through
  controls.minDistance = 0.5; controls.maxDistance = 4.0;
  controls.enabled = true;
}
mode2dBtn.addEventListener('click', enterFoil);
mode3dBtn.addEventListener('click', exitFoil);

// ── Loop ────────────────────────────────────────────────────────────────────
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.1);
  detectFace();
  if (vrm) vrm.update(dt);

  if (foilMode) {
    // Render VRM to texture
    renderer.setRenderTarget(rt);
    renderer.render(scene, vrmCamera);
    renderer.setRenderTarget(null);
    clothMat.map = rt.texture;
    // Update cloth + render
    updateCloth(dt);
    controls.update();
    renderer.render(clothScene, camera);
  } else {
    controls.update();
    renderer.render(scene, camera);
  }
}

// ── File import ──────────────────────────────────────────────────────────
const fileInput = document.getElementById('file-input');
fileInput.addEventListener('change', async () => {
  const file = fileInput.files[0];
  if (!file) return;
  const url = URL.createObjectURL(file);
  try {
    await loadVRM(url);
  } catch (err) {
    console.error('Import failed:', err);
    loadingText.textContent = 'Failed: ' + err.message;
  } finally {
    URL.revokeObjectURL(url);
  }
});

// ── Boot ────────────────────────────────────────────────────────────────────
(async () => {
  try { await loadVRM(import.meta.env.BASE_URL + 'AvatarSample_A.vrm'); } catch (err) {
    console.error('Startup:', err);
    loadingText.textContent = 'Failed: ' + err.message;
    loadingText.style.color = '#f87171';
    loadingProgress.style.background = '#f87171';
  }
})();
animate();
