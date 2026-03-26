/* ================================================================
   api.js  —  Meshy API 通信层
   包含：apiFetch、createTask、SSE 实时进度、轮询、任务状态处理

   回调注册说明：
     调用 registerTaskCallbacks({ onSucceeded, onFailed }) 注入业务回调，
     避免与 app.js 产生循环依赖。
   ================================================================ */

import { CONFIG, state, log } from './utils.js';
import { setStatus, addLog } from './ui.js';

/* ----------------------------------------------------------------
   业务回调（由 app.js 在初始化时注入）
   ---------------------------------------------------------------- */
let _onSucceeded = () => {};
let _onFailed    = () => {};

export function registerTaskCallbacks({ onSucceeded, onFailed }) {
  _onSucceeded = onSucceeded || _onSucceeded;
  _onFailed    = onFailed    || _onFailed;
}

/* ----------------------------------------------------------------
   通用 fetch 封装
   ---------------------------------------------------------------- */
export async function apiFetch(path, options = {}, _silent = false) {
  if (!CONFIG.API_KEY) throw new Error('API Key 未加载，请刷新页面重试');

  const url    = CONFIG.BASE_URL + path;
  const method = options.method || 'GET';

  if (!_silent) {
    log('info', '[API]', `→ ${method} ${url}`);
    if (options.body) {
      try {
        const bodyObj = JSON.parse(options.body);
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
      'Content-Type':  'application/json',
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

/* ----------------------------------------------------------------
   创建任务
   ---------------------------------------------------------------- */
export async function createTask() {
  const artStyle     = document.getElementById('artStyle').value;
  const topology     = document.getElementById('topology').value;
  const polycount    = document.getElementById('targetPolycount').value;
  const enablePBR    = document.getElementById('enablePBR').checked;
  const enableRemesh = document.getElementById('enableRemeshing').checked;

  const body = {
    image_url:     state.imageBase64,
    art_style:     artStyle,
    topology:      topology,
    enable_pbr:    enablePBR,
    should_remesh: enableRemesh,
  };
  if (polycount) body.target_polycount = parseInt(polycount, 10);

  log('info', '[Task]', '创建任务，参数:', {
    art_style:        artStyle,
    topology,
    target_polycount: polycount || '自动',
    enable_pbr:       enablePBR,
    should_remesh:    enableRemesh,
  });

  const data = await apiFetch('/openapi/v1/image-to-3d', {
    method: 'POST',
    body:   JSON.stringify(body),
  });
  log('success', '[Task]', '任务已创建，task_id:', data.result);
  return data.result;
}

/* ----------------------------------------------------------------
   SSE 实时进度
   ---------------------------------------------------------------- */
export function connectSSE(taskId) {
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
    signal:  controller.signal,
  })
    .then(res => {
      if (!res.ok) throw new Error(`SSE HTTP ${res.status}`);
      clearTimeout(timeoutId);
      log('success', '[SSE]', '连接成功，开始读取数据流');
      addLog('SSE 连接已建立，实时接收进度...');

      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer     = '';
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

/* ----------------------------------------------------------------
   轮询
   ---------------------------------------------------------------- */
export function startPolling(taskId) {
  stopPolling();
  log('info', '[Poll]', `启动轮询，间隔 ${CONFIG.POLL_INTERVAL}ms，task_id: ${taskId}`);
  state.pollTimer = setInterval(() => pollOnce(taskId), CONFIG.POLL_INTERVAL);
}

export function stopPolling() {
  if (state.pollTimer) {
    log('info', '[Poll]', '停止轮询');
    clearInterval(state.pollTimer);
    state.pollTimer = null;
  }
}

export async function pollOnce(taskId) {
  try {
    const data = await apiFetch(`/openapi/v1/image-to-3d/${taskId}`, {}, true);
    handleTaskUpdate(data, taskId);
  } catch (err) {
    log('error', '[Poll]', '轮询请求失败:', err);
    addLog('轮询出错：' + err.message);
  }
}

/* ----------------------------------------------------------------
   任务状态处理（SSE / 轮询 共用）
   ---------------------------------------------------------------- */
export function handleTaskUpdate(data) {
  const { status, progress, model_urls, thumbnail_url } = data;

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
    _onSucceeded(model_urls, thumbnail_url);
  } else if (status === 'FAILED' || status === 'EXPIRED') {
    stopPolling();
    if (state.sseAbortCtrl) state.sseAbortCtrl.abort();
    log('error', '[Task]', `任务终止: ${status}`, data);
    addLog(status === 'FAILED' ? '任务失败' : '任务已过期');
    _onFailed(status);
  }
}
