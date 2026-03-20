/* ================================================================
   Meshy Image-to-3D  —  app.js
   ================================================================ */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/* ================================================================
   日志工具（全链路调试，打开 DevTools Console 查看）
   ================================================================ */
const LOG_LEVELS = { info: '#7c6df0', success: '#4cdb97', warn: '#f0b940', error: '#f05a5a', data: '#5b8af5' };
function log(level, tag, ...args) {
  const color = LOG_LEVELS[level] || '#aaa';
  const time  = new Date().toISOString().slice(11, 23);
  console.log(
    `%c[${time}] %c${tag}`,
    'color:#888;font-size:11px',
    `color:${color};font-weight:bold`,
    ...args,
  );
  // 异步写入本地日志文件（通过 server.js /log 端点）
  try {
    const parts = args.map(a => {
      if (typeof a === 'string') return a;
      try { return JSON.stringify(a); } catch (_) { return String(a); }
    });
    const line = `[${new Date().toISOString()}] [${level.toUpperCase()}] ${tag} ${parts.join(' ')}`;
    fetch('/log', { method: 'POST', body: line }).catch(() => {});
  } catch (_) {}
}

/* ----------------------------------------------------------------
   配置区
   ---------------------------------------------------------------- */
const CONFIG = {
  get API_KEY() { return localStorage.getItem('meshy_api_key') || ''; },
  BASE_URL: 'https://api.meshy.ai',
  MAX_IMAGE_SIZE: 5 * 1024 * 1024,      // 压缩目标：5MB
  MAX_DIMENSION: 2048,                   // 图片最大边长
  POLL_INTERVAL: 4000,                   // 轮询间隔 ms
  SSE_TIMEOUT: 120000,                   // SSE 超时 ms
};

/* ================================================================
   状态管理
   ================================================================ */
const state = {
  imageBase64: null,
  imageFile: null,
  taskId: null,
  taskStatus: null,
  pollTimer: null,
  sseSource: null,
  threeScene: null,
  threeRenderer: null,
  threeCamera: null,
  threeControls: null,
  threeAnimId: null,
  wireframeMode: false,
  modelMeshes: [],
};

/* ================================================================
   DOM 引用
   ================================================================ */
const $ = id => document.getElementById(id);
const uploadZone    = $('uploadZone');
const fileInput     = $('fileInput');
const previewArea   = $('previewArea');
const previewImg    = $('previewImg');
const btnRemove     = $('btnRemove');
const btnGenerate   = $('btnGenerate');
const progressCard  = $('progressCard');
const statusBadge   = $('statusBadge');
const taskIdLabel   = $('taskIdLabel');
const progressBar   = $('progressBar');
const progressText  = $('progressText');
const progressLog   = $('progressLog');
const viewerCard    = $('viewerCard');
const viewerWrap    = $('viewerWrap');
const viewerLoading = $('viewerLoading');
const threeCanvas   = $('threeCanvas');
const downloadCard  = $('downloadCard');
const downloadGrid  = $('downloadGrid');
const placeholderCard = $('placeholderCard');
const btnResetView  = $('btnResetView');

/* ================================================================
   Toast 通知
   ================================================================ */
function createToastContainer() {
  let el = document.querySelector('.toast-container');
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast-container';
    document.body.appendChild(el);
  }
  return el;
}

function showToast(message, type = 'info', duration = 4000) {
  const container = createToastContainer();
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(20px)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

/* ================================================================
   图片处理：FileReader + Canvas 压缩
   ================================================================ */
function compressImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('读取文件失败'));
    reader.onload = e => {
      const img = new Image();
      img.onerror = () => reject(new Error('图片解析失败'));
      img.onload = () => {
        let { width, height } = img;
        // 缩放到最大边不超过 MAX_DIMENSION
        if (width > CONFIG.MAX_DIMENSION || height > CONFIG.MAX_DIMENSION) {
          const ratio = Math.min(CONFIG.MAX_DIMENSION / width, CONFIG.MAX_DIMENSION / height);
          width  = Math.round(width  * ratio);
          height = Math.round(height * ratio);
        }
        const canvas = document.createElement('canvas');
        canvas.width  = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        // 逐步降低质量直到满足大小限制
        let quality = 0.92;
        let base64  = canvas.toDataURL('image/jpeg', quality);
        while (base64.length > CONFIG.MAX_IMAGE_SIZE * 1.37 && quality > 0.4) {
          quality -= 0.08;
          base64 = canvas.toDataURL('image/jpeg', quality);
        }
        resolve(base64);
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

function handleImageFile(file) {
  if (!file || !file.type.startsWith('image/')) {
    log('error', '[Upload]', '无效文件类型:', file?.type);
    showToast('请选择有效的图片文件 (JPG / PNG / WEBP)', 'error');
    return;
  }
  log('info', '[Upload]', `开始处理文件: ${file.name}  大小: ${(file.size/1024).toFixed(1)} KB  类型: ${file.type}`);
  state.imageFile = file;
  compressImage(file)
    .then(base64 => {
      const kb = Math.round(base64.length * 0.75 / 1024);
      log('success', '[Upload]', `压缩完成 → base64 约 ${kb} KB`);
      state.imageBase64 = base64;
      previewImg.src = base64;
      uploadZone.style.display = 'none';
      previewArea.style.display = 'block';
      btnGenerate.disabled = false;
      showToast('图片已加载，可以开始生成', 'success');
    })
    .catch(err => {
      log('error', '[Upload]', '压缩失败:', err);
      showToast('图片处理失败：' + err.message, 'error');
    });
}

/* ----------------------------------------------------------------
   上传区域事件
   ---------------------------------------------------------------- */
uploadZone.addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', e => {
  if (e.target.files[0]) handleImageFile(e.target.files[0]);
  fileInput.value = '';
});

uploadZone.addEventListener('dragover', e => {
  e.preventDefault();
  uploadZone.classList.add('drag-over');
});
uploadZone.addEventListener('dragleave', () => {
  uploadZone.classList.remove('drag-over');
});
uploadZone.addEventListener('drop', e => {
  e.preventDefault();
  uploadZone.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) handleImageFile(file);
});

btnRemove.addEventListener('click', () => {
  state.imageBase64 = null;
  state.imageFile   = null;
  previewImg.src    = '';
  previewArea.style.display = 'none';
  uploadZone.style.display  = 'block';
  btnGenerate.disabled      = true;
});

/* ================================================================
   API 工具函数
   ================================================================ */
async function apiFetch(path, options = {}, _silent = false) {
  if (!CONFIG.API_KEY) {
    throw new Error('请先设置 Meshy API Key');
  }
  const url = CONFIG.BASE_URL + path;
  const method = options.method || 'GET';
  if (!_silent) {
    log('info', '[API]', `→ ${method} ${url}`);
    if (options.body) {
      try {
        const bodyObj = JSON.parse(options.body);
        // 截断 base64 避免刷屏
        const preview = { ...bodyObj };
        if (preview.image_url && preview.image_url.length > 80) {
          preview.image_url = preview.image_url.slice(0, 60) + '…[base64 truncated]';
        }
        log('data', '[API]', 'Request body:', preview);
      } catch (_) {}
    }
  }
  const res = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${CONFIG.API_KEY}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  if (!_silent) log('info', '[API]', `← ${res.status} ${res.statusText}  (${method} ${path})`);
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const body = await res.json();

      log('error', '[API]', '响应错误体:', body);
      msg = body.message || body.error || msg;
    } catch (_) {}
    throw new Error(msg);
  }
  const json = await res.json();
  if (!_silent) log('data', '[API]', '响应数据:', json);
  return json;
}

/* ================================================================
   进度 UI 更新
   ================================================================ */
function setStatus(status, percent, message) {
  // Badge
  statusBadge.textContent = {
    PENDING:     '等待中',
    IN_PROGRESS: '生成中',
    SUCCEEDED:   '已完成',
    FAILED:      '失败',
    EXPIRED:     '已过期',
  }[status] || status;
  statusBadge.className = 'status-badge ' + status.toLowerCase().replace('_progress', '_progress');

  // 进度条
  if (typeof percent === 'number') {
    progressBar.style.width = percent + '%';
  }
  if (message) {
    progressText.textContent = message;
  }
}

function addLog(text) {
  progressLog.classList.add('has-logs');
  const line = document.createElement('div');
  line.className = 'log-line';
  line.textContent = `[${new Date().toLocaleTimeString()}] ${text}`;
  progressLog.appendChild(line);
  progressLog.scrollTop = progressLog.scrollHeight;
}

/* ================================================================
   创建任务
   ================================================================ */
async function createTask() {
  const artStyle    = $('artStyle').value;
  const topology    = $('topology').value;
  const polycount   = $('targetPolycount').value;
  const enablePBR   = $('enablePBR').checked;
  const enableRemesh = $('enableRemeshing').checked;

  const body = {
    image_url: state.imageBase64,
    art_style: artStyle,
    topology: topology,
    enable_pbr: enablePBR,
    should_remesh: enableRemesh,
  };
  if (polycount) body.target_polycount = parseInt(polycount, 10);

  log('info', '[Task]', '创建任务，参数:', { art_style: artStyle, topology, target_polycount: polycount || '自动', enable_pbr: enablePBR, should_remesh: enableRemesh });

  const data = await apiFetch('/openapi/v1/image-to-3d', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  log('success', '[Task]', '任务已创建，task_id:', data.result);
  return data.result; // task_id
}

/* ================================================================
   SSE 实时进度
   ================================================================ */
function connectSSE(taskId) {
  if (state.sseSource) {
    state.sseSource.close();
    state.sseSource = null;
  }

  const url = `${CONFIG.BASE_URL}/openapi/v1/image-to-3d/${taskId}/stream`;
  log('info', '[SSE]', '尝试连接:', url);
  const controller = new AbortController();
  state.sseAbortCtrl = controller;

  const timeoutId = setTimeout(() => {
    log('warn', '[SSE]', `连接超时（${CONFIG.SSE_TIMEOUT}ms），切换为轮询`);
    controller.abort();
    addLog('SSE 连接超时，切换为轮询模式');
    startPolling(taskId);
  }, CONFIG.SSE_TIMEOUT);

  fetch(url, {
    headers: { 'Authorization': `Bearer ${CONFIG.API_KEY}` },
    signal: controller.signal,
  })
    .then(res => {
      if (!res.ok) throw new Error(`SSE HTTP ${res.status}`);
      clearTimeout(timeoutId);
      log('success', '[SSE]', '连接成功，开始读取数据流');
      addLog('SSE 连接已建立，实时接收进度...');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let eventCount = 0;

      function pump() {
        reader.read().then(({ done, value }) => {
          if (done) {
            log('info', '[SSE]', `流结束，共收到 ${eventCount} 个事件`);
            addLog('SSE 流已结束');
            pollOnce(taskId);
            return;
          }
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop();

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith(':')) {
              if (trimmed.startsWith(':')) log('info', '[SSE]', '收到心跳');
              continue;
            }
            if (trimmed.startsWith('data:')) {
              const json = trimmed.slice(5).trim();
              if (json === '[DONE]') {
                log('info', '[SSE]', '收到 [DONE]，流结束');
                pollOnce(taskId);
                return;
              }
              try {
                const evt = JSON.parse(json);
                eventCount++;
                log('data', '[SSE]', `事件 #${eventCount}  status=${evt.status}  progress=${evt.progress ?? '-'}%`);
                handleTaskUpdate(evt, taskId);
                if (evt.status === 'SUCCEEDED' || evt.status === 'FAILED' || evt.status === 'EXPIRED') {
                  log('info', '[SSE]', '终止状态，停止读取');
                  return;
                }
              } catch (parseErr) {
                log('warn', '[SSE]', 'JSON 解析失败:', json, parseErr);
              }
            }
          }
          pump();
        }).catch(err => {
          if (err.name !== 'AbortError') {
            log('error', '[SSE]', '读取流异常:', err);
            addLog('SSE 读取异常，切换为轮询');
            startPolling(taskId);
          } else {
            log('info', '[SSE]', '连接已主动中断（AbortController）');
          }
        });
      }
      pump();
    })
    .catch(err => {
      clearTimeout(timeoutId);
      if (err.name !== 'AbortError') {
        log('warn', '[SSE]', '连接失败，降级为轮询:', err.message);
        addLog('SSE 不可用，使用轮询模式');
        startPolling(taskId);
      }
    });
}

/* ================================================================
   任务状态轮询
   ================================================================ */
function startPolling(taskId) {
  stopPolling();
  log('info', '[Poll]', `启动轮询，间隔 ${CONFIG.POLL_INTERVAL}ms，task_id: ${taskId}`);
  state.pollTimer = setInterval(() => pollOnce(taskId), CONFIG.POLL_INTERVAL);
}

function stopPolling() {
  if (state.pollTimer) {
    log('info', '[Poll]', '停止轮询');
    clearInterval(state.pollTimer);
    state.pollTimer = null;
  }
}

async function pollOnce(taskId) {
  try {
    const data = await apiFetch(`/openapi/v1/image-to-3d/${taskId}`, {}, true);
    handleTaskUpdate(data, taskId);
  } catch (err) {
    log('error', '[Poll]', '轮询请求失败:', err);
    addLog('轮询出错：' + err.message);
  }
}

/* ================================================================
   任务状态处理（SSE / 轮询 共用）
   ================================================================ */
function handleTaskUpdate(data, taskId) {
  const { status, progress, model_urls, thumbnail_url } = data;

  // 只在状态或进度变化时打日志，避免轮询刷屏
  const prevStatus = state.taskStatus;
  const pct = typeof progress === 'number' ? progress : 0;
  if (status !== prevStatus || (status === 'IN_PROGRESS' && pct % 10 === 0)) {
    const level = status === 'SUCCEEDED' ? 'success' : status === 'FAILED' ? 'error' : 'info';
    log(level, '[Task]', `状态: ${prevStatus || '—'} → ${status}  进度: ${pct}%`);
  }

  state.taskStatus = status;

  const statusMessages = {
    PENDING:     '任务已进入队列，等待处理...',
    IN_PROGRESS: `正在生成 3D 模型... ${pct}%`,
    SUCCEEDED:   '3D 模型生成成功！',
    FAILED:      '生成失败，请重试',
    EXPIRED:     '任务已过期',
  };

  setStatus(status, pct, statusMessages[status] || '处理中...');

  if (status === 'SUCCEEDED') {
    stopPolling();
    if (state.sseAbortCtrl) state.sseAbortCtrl.abort();
    log('success', '[Task]', '生成成功，model_urls:', model_urls);
    addLog('生成成功！加载模型...');
    onTaskSucceeded(model_urls, thumbnail_url);
  } else if (status === 'FAILED' || status === 'EXPIRED') {
    stopPolling();
    if (state.sseAbortCtrl) state.sseAbortCtrl.abort();
    log('error', '[Task]', `任务终止: ${status}`, data);
    addLog(status === 'FAILED' ? '任务失败' : '任务已过期');
    onTaskFailed(status);
  }
}

/* ================================================================
   任务成功后处理
   ================================================================ */
function onTaskSucceeded(modelUrls, thumbnailUrl) {
  showToast('🎉 3D 模型生成完成！', 'success', 6000);

  // 显示预览区
  placeholderCard.style.display = 'none';
  viewerCard.style.display      = 'block';
  downloadCard.style.display    = 'block';

  // 渲染下载按钮
  renderDownloadButtons(modelUrls);

  // 加载 GLB 预览
  const glbUrl = modelUrls?.glb || modelUrls?.fbx || modelUrls?.obj;
  if (glbUrl) {
    loadModelInViewer(glbUrl);
  } else {
    viewerLoading.innerHTML = '<span style="color:var(--text-muted)">暂无可预览的 GLB 模型</span>';
  }

  // 重置生成按钮
  resetGenerateButton();
}

function onTaskFailed(status) {
  showToast(status === 'FAILED' ? '生成失败，请检查图片或参数后重试' : '任务已过期', 'error');
  resetGenerateButton();
}

/* ================================================================
   下载按钮渲染
   ================================================================ */
function renderDownloadButtons(modelUrls) {
  if (!modelUrls) return;
  downloadGrid.innerHTML = '';

  const formatInfo = {
    glb:  { label: 'GLB',  icon: '📦' },
    fbx:  { label: 'FBX',  icon: '🧱' },
    obj:  { label: 'OBJ',  icon: '🗂️' },
    usdz: { label: 'USDZ', icon: '🍎' },
    mtl:  { label: 'MTL',  icon: '🎨' },
  };

  Object.entries(modelUrls).forEach(([fmt, url]) => {
    if (!url) return;
    const info = formatInfo[fmt] || { label: fmt.toUpperCase(), icon: '📄' };
    const a = document.createElement('a');
    a.className = 'download-btn';
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener';
    a.download = `meshy-model.${fmt}`;
    a.innerHTML = `
      <span>${info.icon}</span>
      <span>${info.label} 文件</span>
      <span class="format-badge">${info.label}</span>
    `;
    downloadGrid.appendChild(a);
  });

  // ── 模型 URL 展示区 ────────────────────────────────────────────
  // 移除旧的 URL 展示区（重复调用时刷新）
  const oldUrlPanel = document.getElementById('modelUrlPanel');
  if (oldUrlPanel) oldUrlPanel.remove();

  const panel = document.createElement('div');
  panel.id = 'modelUrlPanel';
  panel.className = 'model-url-panel';
  panel.innerHTML = '<p class="model-url-title">🔗 模型原始 URL</p>';

  Object.entries(modelUrls).forEach(([fmt, rawUrl]) => {
    if (!rawUrl) return;
    const info = formatInfo[fmt] || { label: fmt.toUpperCase(), icon: '📄' };
    const row = document.createElement('div');
    row.className = 'model-url-row';
    row.innerHTML = `
      <span class="model-url-fmt">${info.icon} ${info.label}</span>
      <input class="model-url-input" type="text" value="${rawUrl}" readonly title="${rawUrl}" />
      <button class="model-url-copy" data-url="${rawUrl}" title="复制">复制</button>
    `;
    panel.appendChild(row);
  });

  // 复制按钮事件
  panel.querySelectorAll('.model-url-copy').forEach(btn => {
    btn.addEventListener('click', () => {
      navigator.clipboard.writeText(btn.dataset.url).then(() => {
        btn.textContent = '已复制';
        btn.classList.add('copied');
        setTimeout(() => { btn.textContent = '复制'; btn.classList.remove('copied'); }, 2000);
      });
    });
  });

  // 插入到 downloadCard 内（下载按钮下方）
  downloadCard.appendChild(panel);
}

/* ================================================================
   Three.js 初始化 & 模型加载
   ================================================================ */
function initThree() {
  if (state.threeRenderer) return;
  log('info', '[Three]', '初始化 WebGL 渲染器');

  const renderer = new THREE.WebGLRenderer({
    canvas: threeCanvas,
    antialias: true,
    alpha: false,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping       = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;
  renderer.shadowMap.enabled   = true;
  renderer.shadowMap.type      = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0d0e1a);

  // 网格辅助线
  const grid = new THREE.GridHelper(10, 20, 0x2a2d4a, 0x1e2038);
  grid.position.y = -1.5;
  scene.add(grid);

  // 环境光 + 方向光
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
  scene.add(ambientLight);

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
  const w = viewerWrap.clientWidth  || 600;
  const h = viewerWrap.clientHeight || 450;
  log('success', '[Three]', `渲染器就绪  画布尺寸: ${w}×${h}  pixelRatio: ${renderer.getPixelRatio()}`);
  const camera = new THREE.PerspectiveCamera(45, w / h, 0.01, 1000);
  camera.position.set(0, 1.5, 4);
  state.threeCamera = camera;

  // 轨道控制器
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping    = true;
  controls.dampingFactor    = 0.08;
  controls.minDistance      = 0.5;
  controls.maxDistance      = 20;
  controls.enablePan        = true;
  controls.autoRotate       = false;
  controls.autoRotateSpeed  = 1.5;
  state.threeControls = controls;

  // 响应式调整
  const resizeObserver = new ResizeObserver(() => resizeRenderer());
  resizeObserver.observe(viewerWrap);

  // 渲染循环
  function animate() {
    state.threeAnimId = requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
  }
  animate();
}

function resizeRenderer() {
  if (!state.threeRenderer) return;
  const w = viewerWrap.clientWidth;
  const h = viewerWrap.clientHeight;
  if (!w || !h) return;
  state.threeRenderer.setSize(w, h, false);
  if (state.threeCamera) {
    state.threeCamera.aspect = w / h;
    state.threeCamera.updateProjectionMatrix();
  }
}

/**
 * 将外部模型 URL 转为本地代理路径，绕过 assets.meshy.ai 的 CORS 限制。
 * 仅当 URL 不是同源时才走代理。
 */
function toProxyUrl(rawUrl) {
  try {
    const u = new URL(rawUrl);
    if (u.origin === location.origin) return rawUrl; // 同源，直接用
    return `/proxy?url=${encodeURIComponent(rawUrl)}`;
  } catch (_) {
    return rawUrl;
  }
}

function loadModelInViewer(rawUrl) {
  const proxyUrl = toProxyUrl(rawUrl);
  log('info', '[Three]', '开始加载模型（原始）:', rawUrl);
  if (proxyUrl !== rawUrl) log('info', '[Three]', '通过代理:', proxyUrl.slice(0, 60) + '…');
  const url = proxyUrl;
  initThree();

  // 清除旧模型
  state.modelMeshes.forEach(m => state.threeScene.remove(m));
  state.modelMeshes = [];



  viewerLoading.classList.remove('hidden');
  viewerLoading.innerHTML = '<div class="spinner"></div><span>加载模型中...</span>';

  const loader = new GLTFLoader();
  loader.load(
    url,
    gltf => {
      const model = gltf.scene;
      log('info', '[Three]', 'GLTF 解析完成，场景节点数:', gltf.scene.children.length);

      // 自动居中 & 缩放
      const box    = new THREE.Box3().setFromObject(model);
      const center = box.getCenter(new THREE.Vector3());
      const size   = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z);
      const scale  = 3 / (maxDim || 1);

      model.position.sub(center.multiplyScalar(scale));
      model.scale.setScalar(scale);

      // 放置在网格上方
      const boxAfter = new THREE.Box3().setFromObject(model);
      model.position.y -= boxAfter.min.y;

      state.threeScene.add(model);
      state.modelMeshes.push(model);

      // 收集 Mesh 引用
      state.meshRefs = [];
      model.traverse(child => {
        if (child.isMesh) {
          child.castShadow    = true;
          child.receiveShadow = true;
          state.meshRefs.push(child);
        }
      });

      // 重置相机到合适位置
      resetCamera();
      viewerLoading.classList.add('hidden');
      log('success', '[Three]', `模型加载完成  Mesh 数: ${state.meshRefs.length}  缩放比: ${scale.toFixed(3)}  包围盒:`, { size, center });
      addLog('模型加载完成');
      showToast('模型预览已就绪', 'success');
    },
    xhr => {
      const pct = xhr.total ? Math.round(xhr.loaded / xhr.total * 100) : 0;
      if (pct === 0 || pct === 100) log('info', '[Three]', `模型下载 ${pct === 0 ? '开始' : '完成'}  (${(xhr.loaded/1024).toFixed(0)} KB)`);
      viewerLoading.innerHTML = `<div class="spinner"></div><span>下载模型 ${pct}%...</span>`;
    },
    err => {
      log('error', '[Three]', '模型加载失败:', err);
      viewerLoading.innerHTML = `<span style="color:var(--error)">模型加载失败</span>`;
      addLog('模型加载失败：' + (err.message || '未知错误'));
      showToast('模型加载失败，请直接下载文件', 'error');
    }
  );
}

function resetCamera() {
  if (!state.threeCamera || !state.threeControls) return;
  state.threeCamera.position.set(0, 1.5, 4);
  state.threeCamera.lookAt(0, 0, 0);
  state.threeControls.target.set(0, 0, 0);
  state.threeControls.update();
}

/* ----------------------------------------------------------------
   视图控制按钮
   ---------------------------------------------------------------- */
btnResetView.addEventListener('click', resetCamera);


/* ================================================================
   生成按钮 & 主流程
   ================================================================ */
btnGenerate.addEventListener('click', async () => {
  if (!state.imageBase64) {
    showToast('请先上传图片', 'error');
    return;
  }
  if (!CONFIG.API_KEY) {
    showToast('⚠️ 请先设置 Meshy API Key', 'error', 8000);
    document.getElementById('apikeyInput')?.focus();
    return;
  }

  // UI 进入加载态
  setGeneratingState(true);
  resetProgress();
  placeholderCard.style.display = 'block';
  viewerCard.style.display      = 'none';
  downloadCard.style.display    = 'none';

  try {
    addLog('正在创建任务...');
    const taskId = await createTask();
    state.taskId = taskId;
    taskIdLabel.textContent = 'ID: ' + taskId;
    addLog('任务已创建：' + taskId);
    setStatus('PENDING', 0, '任务已创建，等待服务器处理...');

    // 优先尝试 SSE，自动降级到轮询
    connectSSE(taskId);
    // 同时开始轮询作为保险（SSE 成功后 stopPolling 会取消）
    setTimeout(() => {
      if (state.taskStatus !== 'SUCCEEDED' && state.taskStatus !== 'FAILED') {
        startPolling(taskId);
      }
    }, 3000);

  } catch (err) {
    showToast('任务创建失败：' + err.message, 'error');
    addLog('错误：' + err.message);
    resetGenerateButton();
  }
});

function setGeneratingState(loading) {
  btnGenerate.disabled = loading;
  btnGenerate.classList.toggle('loading', loading);
  const icon = btnGenerate.querySelector('.btn-icon');
  const text = btnGenerate.querySelector('.btn-text');
  if (loading) {
    icon.textContent = '⏳';
    text.textContent = '生成中，请稍候...';
    progressCard.style.display = 'block';
  }
}

function resetGenerateButton() {
  btnGenerate.disabled = false;
  btnGenerate.classList.remove('loading');
  const icon = btnGenerate.querySelector('.btn-icon');
  const text = btnGenerate.querySelector('.btn-text');
  icon.textContent = '✨';
  text.textContent = '开始生成 3D 模型';
}

function resetProgress() {
  progressBar.style.width  = '0%';
  progressText.textContent = '正在初始化任务...';
  progressLog.innerHTML    = '';
  progressLog.classList.remove('has-logs');
  statusBadge.textContent  = '等待中';
  statusBadge.className    = 'status-badge';
  taskIdLabel.textContent  = '';
  state.taskId     = null;
  state.taskStatus = null;
  stopPolling();
  if (state.sseAbortCtrl) { state.sseAbortCtrl.abort(); state.sseAbortCtrl = null; }
}

/* ================================================================
   加载本地 3D 文件（GLB / GLTF / OBJ / FBX）
   ================================================================ */
function loadLocalModelFile(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  const supported = ['glb', 'gltf', 'obj', 'fbx'];
  if (!supported.includes(ext)) {
    showToast(`不支持的格式 .${ext}，请选择 GLB / GLTF / OBJ / FBX`, 'error');
    return;
  }

  log('info', '[LocalFile]', `开始加载本地文件: ${file.name}  (${(file.size / 1024).toFixed(1)} KB)`);
  placeholderCard.style.display = 'none';
  viewerCard.style.display      = 'block';

  // 清除旧模型
  if (state.threeScene) {
    state.modelMeshes.forEach(m => state.threeScene.remove(m));
    state.modelMeshes = [];
  }

  // 确保 Three.js 场景已初始化
  if (!state.threeScene) initThree();

  viewerLoading.classList.remove('hidden');
  viewerLoading.innerHTML = '<div class="spinner"></div><span>解析模型中...</span>';

  const objectURL = URL.createObjectURL(file);

  if (ext === 'glb' || ext === 'gltf') {
    const loader = new GLTFLoader();
    loader.load(
      objectURL,
      gltf => _onModelLoaded(gltf.scene, file.name, objectURL),
      xhr => {
        const pct = xhr.total ? Math.round(xhr.loaded / xhr.total * 100) : 0;
        viewerLoading.innerHTML = `<div class="spinner"></div><span>解析模型 ${pct}%...</span>`;
      },
      err => _onModelError(err, objectURL),
    );
  } else if (ext === 'obj') {
    const loader = new OBJLoader();
    loader.load(
      objectURL,
      obj => _onModelLoaded(obj, file.name, objectURL),
      xhr => {
        const pct = xhr.total ? Math.round(xhr.loaded / xhr.total * 100) : 0;
        viewerLoading.innerHTML = `<div class="spinner"></div><span>解析模型 ${pct}%...</span>`;
      },
      err => _onModelError(err, objectURL),
    );
  } else if (ext === 'fbx') {
    const loader = new FBXLoader();
    loader.load(
      objectURL,
      fbx => _onModelLoaded(fbx, file.name, objectURL),
      xhr => {
        const pct = xhr.total ? Math.round(xhr.loaded / xhr.total * 100) : 0;
        viewerLoading.innerHTML = `<div class="spinner"></div><span>解析模型 ${pct}%...</span>`;
      },
      err => _onModelError(err, objectURL),
    );
  }
}

function _onModelLoaded(model, filename, objectURL) {
  const box    = new THREE.Box3().setFromObject(model);
  const center = box.getCenter(new THREE.Vector3());
  const size   = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);
  const scale  = 3 / (maxDim || 1);

  model.position.sub(center.multiplyScalar(scale));
  model.scale.setScalar(scale);

  const boxAfter = new THREE.Box3().setFromObject(model);
  model.position.y -= boxAfter.min.y;

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
  viewerLoading.classList.add('hidden');
  URL.revokeObjectURL(objectURL);
  log('success', '[LocalFile]', `本地模型加载完成: ${filename}  Mesh 数: ${state.meshRefs.length}`);
  showToast(`已加载 ${filename}`, 'success');
}

function _onModelError(err, objectURL) {
  log('error', '[LocalFile]', '本地模型加载失败:', err);
  viewerLoading.innerHTML = `<span style="color:var(--error)">模型加载失败</span>`;
  URL.revokeObjectURL(objectURL);
  showToast('模型加载失败，请检查文件格式', 'error');
}

/* ================================================================
   API Key UI 初始化
   ================================================================ */
function initApiKeyUI() {
  const input      = document.getElementById('apikeyInput');
  const saveBtn    = document.getElementById('btnApikeySave');
  const toggleBtn  = document.getElementById('btnApikeyToggle');
  const statusEl   = document.getElementById('apikeyStatus');
  if (!input) return;

  function updateStatus() {
    const key = localStorage.getItem('meshy_api_key') || '';
    if (key) {
      input.value   = key;
      statusEl.textContent  = '已设置';
      statusEl.className    = 'apikey-status apikey-ok';
    } else {
      statusEl.textContent  = '未设置';
      statusEl.className    = 'apikey-status apikey-missing';
    }
  }

  updateStatus();

  saveBtn.addEventListener('click', () => {
    const val = input.value.trim();
    if (!val) {
      localStorage.removeItem('meshy_api_key');
      updateStatus();
      showToast('已清除 API Key', 'info');
    } else if (!val.startsWith('msy_')) {
      showToast('Key 格式不正确，应以 msy_ 开头', 'error');
    } else {
      localStorage.setItem('meshy_api_key', val);
      updateStatus();
      showToast('API Key 已保存', 'success');
    }
  });

  input.addEventListener('keydown', e => { if (e.key === 'Enter') saveBtn.click(); });

  toggleBtn.addEventListener('click', () => {
    const isHidden = input.type === 'password';
    input.type = isHidden ? 'text' : 'password';
    toggleBtn.title = isHidden ? '隐藏' : '显示/隐藏';
  });
}



/* ================================================================
   初始化
   ================================================================ */
document.addEventListener('DOMContentLoaded', () => {
  log('info', '[App]', '页面初始化完成，Three.js r' + THREE.REVISION);
  initApiKeyUI();

  // 初始状态
  progressCard.style.display  = 'none';
  viewerCard.style.display    = 'none';
  downloadCard.style.display  = 'none';
  placeholderCard.style.display = 'block';

  // 加载本地 3D 文件
  const localFileInput = document.getElementById('localFileInput');
  const localDropZone  = document.getElementById('localDropZone');
  if (localDropZone && localFileInput) {
    // 点击选择文件
    localDropZone.addEventListener('click', () => localFileInput.click());
    localFileInput.addEventListener('change', e => {
      const file = e.target.files[0];
      if (file) loadLocalModelFile(file);
      localFileInput.value = '';
    });
    // 拖放
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

  // 调试：直接输入 URL 预览
  const btnDebugPreview = document.getElementById('btnDebugPreview');
  const debugUrlInput   = document.getElementById('debugUrlInput');
  if (btnDebugPreview) {
    btnDebugPreview.addEventListener('click', () => {
      const raw = debugUrlInput.value.trim();
      if (!raw) { showToast('请输入模型 URL', 'error'); return; }
      log('info', '[Debug]', '手动预览 URL:', raw);
      placeholderCard.style.display = 'none';
      viewerCard.style.display      = 'block';
      loadModelInViewer(raw);
    });
    debugUrlInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') btnDebugPreview.click();
    });
  }
});
