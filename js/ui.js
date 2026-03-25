/* ================================================================
   ui.js  —  通用 UI 操作
   包含：进度状态更新（setStatus / addLog）、生成按钮状态管理
   ================================================================ */

import { state, $ } from './utils.js';

/* ----------------------------------------------------------------
   进度卡片 UI
   ---------------------------------------------------------------- */
export function setStatus(status, percent, message) {
  const statusBadge  = $('statusBadge');
  const progressBar  = $('progressBar');
  const progressText = $('progressText');
  if (!statusBadge) return;

  statusBadge.textContent = {
    PENDING:     '等待中',
    IN_PROGRESS: '生成中',
    SUCCEEDED:   '已完成',
    FAILED:      '失败',
    EXPIRED:     '已过期',
  }[status] || status;

  statusBadge.className = 'status-badge ' + status.toLowerCase();

  if (typeof percent === 'number' && progressBar) {
    progressBar.style.width = percent + '%';
  }
  if (message && progressText) {
    progressText.textContent = message;
  }
}

export function addLog(text) {
  const progressLog = $('progressLog');
  if (!progressLog) return;
  progressLog.classList.add('has-logs');
  const line = document.createElement('div');
  line.className   = 'log-line';
  line.textContent = `[${new Date().toLocaleTimeString()}] ${text}`;
  progressLog.appendChild(line);
  progressLog.scrollTop = progressLog.scrollHeight;
}

/* ----------------------------------------------------------------
   生成按钮状态
   ---------------------------------------------------------------- */
export function setGeneratingState(loading) {
  const btnGenerate  = $('btnGenerate');
  const progressCard = $('progressCard');
  if (!btnGenerate) return;

  btnGenerate.disabled = loading;
  btnGenerate.classList.toggle('loading', loading);
  const icon = btnGenerate.querySelector('.btn-icon');
  const text = btnGenerate.querySelector('.btn-text');
  if (loading) {
    if (icon) icon.textContent = '⏳';
    if (text) text.textContent = '生成中，请稍候...';
    if (progressCard) progressCard.style.display = 'block';
  }
}

export function resetGenerateButton() {
  const btnGenerate = $('btnGenerate');
  if (!btnGenerate) return;
  btnGenerate.disabled = false;
  btnGenerate.classList.remove('loading');
  const icon = btnGenerate.querySelector('.btn-icon');
  const text = btnGenerate.querySelector('.btn-text');
  if (icon) icon.textContent = '✨';
  if (text) text.textContent = '开始生成 3D 模型';
}

export function resetProgress() {
  const progressBar  = $('progressBar');
  const progressText = $('progressText');
  const progressLog  = $('progressLog');
  const statusBadge  = $('statusBadge');
  const taskIdLabel  = $('taskIdLabel');

  if (progressBar)  progressBar.style.width  = '0%';
  if (progressText) progressText.textContent = '正在初始化任务...';
  if (progressLog)  { progressLog.innerHTML  = ''; progressLog.classList.remove('has-logs'); }
  if (statusBadge)  { statusBadge.textContent = '等待中'; statusBadge.className = 'status-badge'; }
  if (taskIdLabel)  taskIdLabel.textContent  = '';

  state.taskId     = null;
  state.taskStatus = null;

  // 停止轮询
  if (state.pollTimer) {
    clearInterval(state.pollTimer);
    state.pollTimer = null;
  }
  if (state.sseAbortCtrl) {
    state.sseAbortCtrl.abort();
    state.sseAbortCtrl = null;
  }
}
