/* ================================================================
   utils.js  —  公共基础设施
   包含：日志工具、Toast 通知、全局配置（CONFIG）、共享状态（state）
   ================================================================ */

/* ----------------------------------------------------------------
   日志工具
   ---------------------------------------------------------------- */
const LOG_LEVELS = {
  info:    '#7c6df0',
  success: '#4cdb97',
  warn:    '#f0b940',
  error:   '#f05a5a',
  data:    '#5b8af5',
};

export function log(level, tag, ...args) {
  const color = LOG_LEVELS[level] || '#aaa';
  const time  = new Date().toISOString().slice(11, 23);
  console.log(
    `%c[${time}] %c${tag}`,
    'color:#888;font-size:11px',
    `color:${color};font-weight:bold`,
    ...args,
  );
  // 异步写入本地日志（通过 server.js /log 端点）
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
   Toast 通知
   ---------------------------------------------------------------- */
function createToastContainer() {
  let el = document.querySelector('.toast-container');
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast-container';
    document.body.appendChild(el);
  }
  return el;
}

export function showToast(message, type = 'info', duration = 4000) {
  const container = createToastContainer();
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity   = '0';
    toast.style.transform = 'translateX(20px)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

/* ----------------------------------------------------------------
   全局配置
   ---------------------------------------------------------------- */
export const CONFIG = {
  get API_KEY() { return localStorage.getItem('meshy_api_key') || ''; },
  BASE_URL:        'https://api.meshy.ai',
  MAX_IMAGE_SIZE:  5 * 1024 * 1024,   // 压缩目标：5 MB
  MAX_DIMENSION:   2048,               // 图片最大边长（px）
  POLL_INTERVAL:   4000,              // 轮询间隔 ms
  SSE_TIMEOUT:     120000,            // SSE 超时 ms
};

/* ----------------------------------------------------------------
   共享状态
   ---------------------------------------------------------------- */
export const state = {
  imageBase64:    null,
  imageFile:      null,
  taskId:         null,
  taskStatus:     null,
  pollTimer:      null,
  sseSource:      null,
  sseAbortCtrl:   null,
  threeScene:     null,
  threeRenderer:  null,
  threeCamera:    null,
  threeControls:  null,
  threeAnimId:    null,
  wireframeMode:  false,
  modelMeshes:    [],
  meshRefs:       [],
};

/* ----------------------------------------------------------------
   DOM 快捷选择器（$）
   ---------------------------------------------------------------- */
export const $ = id => document.getElementById(id);
