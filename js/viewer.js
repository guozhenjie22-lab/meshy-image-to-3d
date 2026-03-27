/* ================================================================
   viewer.js  —  Three.js 3D 预览器
   包含：场景初始化、模型加载（GLB/OBJ/FBX/URL）、相机控制、本地文件加载
   ================================================================ */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OBJLoader }  from 'three/addons/loaders/OBJLoader.js';
import { FBXLoader }  from 'three/addons/loaders/FBXLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

import { state, log, showToast, $ } from './utils.js';
import { addLog } from './ui.js';

/* ----------------------------------------------------------------
   初始化 Three.js 场景（只执行一次）
   ---------------------------------------------------------------- */
export function initThree() {
  if (state.threeRenderer) return;
  log('info', '[Three]', '初始化 WebGL 渲染器');

  const viewerWrap  = $('viewerWrap');
  const threeCanvas = $('threeCanvas');

  const renderer = new THREE.WebGLRenderer({ canvas: threeCanvas, antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace      = THREE.SRGBColorSpace;
  renderer.toneMapping           = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure   = 1.2;
  renderer.shadowMap.enabled     = true;
  renderer.shadowMap.type        = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0d0e1a);

  // 网格辅助线
  const grid = new THREE.GridHelper(10, 20, 0x2a2d4a, 0x1e2038);
  grid.position.y = -1.5;
  scene.add(grid);

  // 灯光
  scene.add(new THREE.AmbientLight(0xffffff, 0.6));

  const dirLight1 = new THREE.DirectionalLight(0xffffff, 1.5);
  dirLight1.position.set(5, 8, 5);
  dirLight1.castShadow = true;
  scene.add(dirLight1);

  const dirLight2 = new THREE.DirectionalLight(0x8899ff, 0.5);
  dirLight2.position.set(-5, 3, -5);
  scene.add(dirLight2);

  const fillLight = new THREE.PointLight(0x7c6df0, 0.8, 20);
  fillLight.position.set(-3, 2, 3);
  scene.add(fillLight);

  state.threeScene = scene;

  // 相机
  const w = viewerWrap?.clientWidth  || 600;
  const h = viewerWrap?.clientHeight || 450;
  const camera = new THREE.PerspectiveCamera(45, w / h, 0.01, 1000);
  camera.position.set(0, 1.5, 4);
  state.threeCamera = camera;

  // 轨道控制器
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping   = true;
  controls.dampingFactor   = 0.08;
  controls.minDistance     = 0.5;
  controls.maxDistance     = 20;
  controls.enablePan       = true;
  controls.autoRotate      = false;
  controls.autoRotateSpeed = 1.5;
  state.threeControls = controls;
  state.threeRenderer = renderer;

  log('success', '[Three]', `渲染器就绪  画布尺寸: ${w}×${h}  pixelRatio: ${renderer.getPixelRatio()}`);

  // 响应式调整
  const resizeObserver = new ResizeObserver(() => resizeRenderer());
  if (viewerWrap) resizeObserver.observe(viewerWrap);

  // 渲染循环
  (function animate() {
    state.threeAnimId = requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
  })();
}

/* ----------------------------------------------------------------
   响应式画布尺寸
   ---------------------------------------------------------------- */
export function resizeRenderer() {
  if (!state.threeRenderer) return;
  const viewerWrap = $('viewerWrap');
  const w = viewerWrap?.clientWidth;
  const h = viewerWrap?.clientHeight;
  if (!w || !h) return;
  state.threeRenderer.setSize(w, h, false);
  if (state.threeCamera) {
    state.threeCamera.aspect = w / h;
    state.threeCamera.updateProjectionMatrix();
  }
}

/* ----------------------------------------------------------------
   代理 URL（绕过 CORS）
   ---------------------------------------------------------------- */
export function toProxyUrl(rawUrl) {
  try {
    const u = new URL(rawUrl);
    if (u.origin === location.origin) return rawUrl;
    return `/proxy?url=${encodeURIComponent(rawUrl)}`;
  } catch (_) {
    return rawUrl;
  }
}

/* ----------------------------------------------------------------
   自动居中并缩放模型，放置在网格上方
   ---------------------------------------------------------------- */
function fitModel(model) {
  const box    = new THREE.Box3().setFromObject(model);
  const center = box.getCenter(new THREE.Vector3());
  const size   = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);
  const scale  = 3 / (maxDim || 1);

  model.position.sub(center.multiplyScalar(scale));
  model.scale.setScalar(scale);

  const boxAfter = new THREE.Box3().setFromObject(model);
  model.position.y -= boxAfter.min.y;

  return { size, center, scale };
}

/* ----------------------------------------------------------------
   加载远程模型（URL）
   ---------------------------------------------------------------- */
export function loadModelInViewer(rawUrl) {
  const proxyUrl      = toProxyUrl(rawUrl);
  const viewerLoading = $('viewerLoading');

  log('info', '[Three]', '开始加载模型（原始）:', rawUrl);
  if (proxyUrl !== rawUrl) log('info', '[Three]', '通过代理:', proxyUrl.slice(0, 60) + '…');

  initThree();

  // 清除旧模型
  state.modelMeshes.forEach(m => state.threeScene.remove(m));
  state.modelMeshes = [];

  if (viewerLoading) {
    viewerLoading.classList.remove('hidden');
    viewerLoading.innerHTML = '<div class="spinner"></div><span>加载模型中...</span>';
  }

  const loader = new GLTFLoader();
  loader.load(
    proxyUrl,
    gltf => {
      const model = gltf.scene;
      log('info', '[Three]', 'GLTF 解析完成，场景节点数:', gltf.scene.children.length);

      const { size, center, scale } = fitModel(model);

      state.threeScene.add(model);
      state.modelMeshes.push(model);

      state.meshRefs = [];
      model.traverse(child => {
        if (child.isMesh) {
          child.castShadow    = true;
          child.receiveShadow = true;
          state.meshRefs.push(child);
        }
      });

      resetCamera();
      if (viewerLoading) viewerLoading.classList.add('hidden');
      log('success', '[Three]', `模型加载完成  Mesh 数: ${state.meshRefs.length}  缩放比: ${scale.toFixed(3)}  包围盒:`, { size, center });
      addLog('模型加载完成');
      showToast('模型预览已就绪', 'success');
    },
    xhr => {
      const pct = xhr.total ? Math.round(xhr.loaded / xhr.total * 100) : 0;
      if (viewerLoading) viewerLoading.innerHTML = `<div class="spinner"></div><span>下载模型 ${pct}%...</span>`;
    },
    err => {
      log('error', '[Three]', '模型加载失败:', err);
      if (viewerLoading) viewerLoading.innerHTML = `<span style="color:var(--error)">模型加载失败</span>`;
      addLog('模型加载失败：' + (err.message || '未知错误'));
      showToast('模型加载失败，请直接下载文件', 'error');
    },
  );
}

/* ----------------------------------------------------------------
   加载本地 3D 文件（GLB / GLTF / OBJ / FBX）
   ---------------------------------------------------------------- */
export function loadLocalModelFile(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  const supported = ['glb', 'gltf', 'obj', 'fbx'];
  if (!supported.includes(ext)) {
    showToast(`不支持的格式 .${ext}，请选择 GLB / GLTF / OBJ / FBX`, 'error');
    return;
  }

  log('info', '[LocalFile]', `开始加载本地文件: ${file.name}  (${(file.size / 1024).toFixed(1)} KB)`);

  const placeholderCard = $('placeholderCard');
  const viewerCard      = $('viewerCard');
  const viewerLoading   = $('viewerLoading');

  if (placeholderCard) placeholderCard.style.display = 'none';
  if (viewerCard)      viewerCard.style.display      = 'block';

  if (state.threeScene) {
    state.modelMeshes.forEach(m => state.threeScene.remove(m));
    state.modelMeshes = [];
  }
  if (!state.threeScene) initThree();

  if (viewerLoading) {
    viewerLoading.classList.remove('hidden');
    viewerLoading.innerHTML = '<div class="spinner"></div><span>解析模型中...</span>';
  }

  const objectURL = URL.createObjectURL(file);
  const onProgress = xhr => {
    const pct = xhr.total ? Math.round(xhr.loaded / xhr.total * 100) : 0;
    if (viewerLoading) viewerLoading.innerHTML = `<div class="spinner"></div><span>解析模型 ${pct}%...</span>`;
  };
  const onError = err => _onModelError(err, objectURL);
  const onLoaded = model => _onModelLoaded(model, file.name, objectURL);

  if (ext === 'glb' || ext === 'gltf') {
    new GLTFLoader().load(objectURL, gltf => onLoaded(gltf.scene), onProgress, onError);
  } else if (ext === 'obj') {
    new OBJLoader().load(objectURL, onLoaded, onProgress, onError);
  } else if (ext === 'fbx') {
    new FBXLoader().load(objectURL, onLoaded, onProgress, onError);
  }
}

function _onModelLoaded(model, filename, objectURL) {
  const viewerLoading = $('viewerLoading');
  fitModel(model);

  state.threeScene.add(model);
  state.modelMeshes.push(model);

  state.meshRefs = [];
  model.traverse(child => {
    if (child.isMesh) {
      child.castShadow    = true;
      child.receiveShadow = true;
      state.meshRefs.push(child);
    }
  });

  resetCamera();
  if (viewerLoading) viewerLoading.classList.add('hidden');
  URL.revokeObjectURL(objectURL);
  log('success', '[LocalFile]', `本地模型加载完成: ${filename}  Mesh 数: ${state.meshRefs.length}`);
  showToast(`已加载 ${filename}`, 'success');
}

function _onModelError(err, objectURL) {
  const viewerLoading = $('viewerLoading');
  log('error', '[LocalFile]', '本地模型加载失败:', err);
  if (viewerLoading) viewerLoading.innerHTML = `<span style="color:var(--error)">模型加载失败</span>`;
  URL.revokeObjectURL(objectURL);
  showToast('模型加载失败，请检查文件格式', 'error');
}

/* ----------------------------------------------------------------
   重置相机到合适位置
   ---------------------------------------------------------------- */
export function resetCamera() {
  if (!state.threeCamera || !state.threeControls) return;

  let fitTarget = new THREE.Vector3(0, 0, 0);
  let fitRadius = 3;

  if (state.modelMeshes && state.modelMeshes.length > 0) {
    const box    = new THREE.Box3();
    state.modelMeshes.forEach(m => box.expandByObject(m));
    const center = box.getCenter(new THREE.Vector3());
    const size   = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    fitTarget = center;
    const fov  = state.threeCamera.fov * (Math.PI / 180);
    fitRadius  = (maxDim / 2 / Math.tan(fov / 2)) * 1.35;
  }

  const offsetY = fitRadius * 0.25;
  state.threeCamera.position.set(
    fitTarget.x,
    fitTarget.y + offsetY,
    fitTarget.z + fitRadius,
  );
  state.threeCamera.lookAt(fitTarget);
  state.threeControls.target.copy(fitTarget);
  state.threeControls.update();
}

/* ----------------------------------------------------------------
   初始化本地文件拖放 & 调试 URL 预览
   ---------------------------------------------------------------- */
export function initLocalFileUI() {
  const localFileInput = $('localFileInput');
  const localDropZone  = $('localDropZone');
  if (localDropZone && localFileInput) {
    localDropZone.addEventListener('click', () => localFileInput.click());
    localFileInput.addEventListener('change', e => {
      const file = e.target.files[0];
      if (file) loadLocalModelFile(file);
      localFileInput.value = '';
    });
    localDropZone.addEventListener('dragover', e => {
      e.preventDefault();
      localDropZone.classList.add('drag-over');
    });
    localDropZone.addEventListener('dragleave', () => {
      localDropZone.classList.remove('drag-over');
    });
    localDropZone.addEventListener('drop', e => {
      e.preventDefault();
      localDropZone.classList.remove('drag-over');
      const file = e.dataTransfer.files[0];
      if (file) loadLocalModelFile(file);
    });
  }

  // 重置视角按钮
  $('btnResetView')?.addEventListener('click', resetCamera);

  // 重新上传按钮（viewerCard 内）
  const reloadInput = $('reloadLocalInput');
  $('btnReloadLocal')?.addEventListener('click', () => reloadInput?.click());
  reloadInput?.addEventListener('change', e => {
    const file = e.target.files[0];
    if (file) loadLocalModelFile(file);
    reloadInput.value = '';
  });
}
