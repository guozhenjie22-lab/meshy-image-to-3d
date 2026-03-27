/* ================================================================
   app.js  —  应用入口
   负责将各功能模块组装起来，完成初始化流程

   模块结构：
     js/utils.js   — 日志、Toast、CONFIG、state、$
     js/ui.js      — 进度 UI、按钮状态管理
     js/api.js     — Meshy API 通信（fetch、SSE、轮询、任务处理）
     js/upload.js  — 图片上传、压缩、下载按钮渲染
     js/viewer.js  — Three.js 场景、模型加载、相机控制
   ================================================================ */

import * as THREE from 'three';

import { state, log, showToast, $ }                        from './js/utils.js';
import { setStatus, addLog,
         setGeneratingState, resetGenerateButton,
         resetProgress }                                    from './js/ui.js';
import { registerTaskCallbacks, createTask,
         connectSSE, startPolling, stopPolling }            from './js/api.js';
import { initUploadUI, renderDownloadButtons }              from './js/upload.js';
import { initThree, loadModelInViewer,
         initLocalFileUI }                                  from './js/viewer.js';
import { initDemoWidget }                                   from './js/demoWidget.js';

/* ================================================================
   任务成功 / 失败 回调（注入到 api.js，避免循环依赖）
   ================================================================ */
function onTaskSucceeded(modelUrls) {
  showToast('🎉 3D 模型生成完成！', 'success', 6000);

  $('placeholderCard').style.display = 'none';
  $('viewerCard').style.display      = 'block';
  $('downloadCard').style.display    = 'block';

  renderDownloadButtons(modelUrls);

  const glbUrl = modelUrls?.glb || modelUrls?.fbx || modelUrls?.obj;
  if (glbUrl) {
    loadModelInViewer(glbUrl);
  } else {
    $('viewerLoading').innerHTML = '<span style="color:var(--text-muted)">暂无可预览的 GLB 模型</span>';
  }

  resetGenerateButton();
}

function onTaskFailed(status) {
  showToast(status === 'FAILED' ? '生成失败，请检查图片或参数后重试' : '任务已过期', 'error');
  resetGenerateButton();
}

/* ================================================================
   生成按钮主流程
   ================================================================ */
function initGenerateButton() {
  const btnGenerate = $('btnGenerate');
  if (!btnGenerate) return;

  btnGenerate.addEventListener('click', async () => {
    if (!state.imageBase64) { showToast('请先上传图片', 'error'); return; }
    if (!localStorage.getItem('meshy_api_key')) {
      showToast('⚠️ API Key 未加载，请刷新页面重试', 'error', 8000);
      return;
    }

    setGeneratingState(true);
    resetProgress();
    $('placeholderCard').style.display = 'block';
    $('viewerCard').style.display      = 'none';
    $('downloadCard').style.display    = 'none';

    try {
      addLog('正在创建任务...');
      const taskId = await createTask();
      state.taskId = taskId;
      $('taskIdLabel').textContent = 'ID: ' + taskId;
      addLog('任务已创建：' + taskId);
      setStatus('PENDING', 0, '任务已创建，等待服务器处理...');

      connectSSE(taskId);
      // 3 秒后开始轮询兜底
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
}

/* ================================================================
   DOMContentLoaded  —  入口
   ================================================================ */
document.addEventListener('DOMContentLoaded', async () => {
  log('info', '[App]', '页面初始化完成，Three.js r' + THREE.REVISION);

  // ── 从服务端自动获取 API Key ──────────────────────────────────
  try {
    const res = await fetch('/api/config');
    if (res.ok) {
      const cfg = await res.json();
      if (cfg.apiKey) {
        localStorage.setItem('meshy_api_key', cfg.apiKey);
        log('info', '[App]', '已从服务端自动加载 API Key');
        // 隐藏 API Key 输入卡片（服务端已托管，无需用户手动填写）
        const apikeyCard = $('apikeyCard');
        if (apikeyCard) apikeyCard.style.display = 'none';
      }
    }
  } catch (e) {
    log('warn', '[App]', '未能从服务端获取 API Key，需手动输入:', e.message);
  }

  // 注入 API 回调（避免循环引用）
  registerTaskCallbacks({ onSucceeded: onTaskSucceeded, onFailed: onTaskFailed });

  // 初始化各模块 UI
  initUploadUI();
  initLocalFileUI();
  initGenerateButton();
  initDemoWidget();

  // 初始显示状态
  $('progressCard').style.display   = 'none';
  $('viewerCard').style.display     = 'none';
  $('downloadCard').style.display   = 'none';
  $('placeholderCard').style.display = 'block';
});
