/* ================================================================
   upload.js  —  图片上传 & 下载按钮渲染
   包含：图片压缩、上传区域事件绑定、下载按钮渲染、模型 URL 面板
   ================================================================ */

import { CONFIG, state, log, showToast, $ } from './utils.js';

/* ----------------------------------------------------------------
   图片压缩（FileReader + Canvas）
   ---------------------------------------------------------------- */
export function compressImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('读取文件失败'));
    reader.onload  = e => {
      const img = new Image();
      img.onerror = () => reject(new Error('图片解析失败'));
      img.onload  = () => {
        let { width, height } = img;
        if (width > CONFIG.MAX_DIMENSION || height > CONFIG.MAX_DIMENSION) {
          const ratio = Math.min(CONFIG.MAX_DIMENSION / width, CONFIG.MAX_DIMENSION / height);
          width  = Math.round(width  * ratio);
          height = Math.round(height * ratio);
        }
        const canvas = document.createElement('canvas');
        canvas.width  = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);

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

/* ----------------------------------------------------------------
   处理选定的图片文件
   ---------------------------------------------------------------- */
export function handleImageFile(file) {
  if (!file || !file.type.startsWith('image/')) {
    log('error', '[Upload]', '无效文件类型:', file?.type);
    showToast('请选择有效的图片文件 (JPG / PNG / WEBP)', 'error');
    return;
  }

  log('info', '[Upload]', `开始处理文件: ${file.name}  大小: ${(file.size / 1024).toFixed(1)} KB  类型: ${file.type}`);
  state.imageFile = file;

  compressImage(file)
    .then(base64 => {
      const kb = Math.round(base64.length * 0.75 / 1024);
      log('success', '[Upload]', `压缩完成 → base64 约 ${kb} KB`);
      state.imageBase64 = base64;

      const previewImg  = $('previewImg');
      const uploadZone  = $('uploadZone');
      const previewArea = $('previewArea');
      const btnGenerate = $('btnGenerate');

      if (previewImg)  previewImg.src              = base64;
      if (uploadZone)  uploadZone.style.display     = 'none';
      if (previewArea) previewArea.style.display    = 'block';
      if (btnGenerate) btnGenerate.disabled         = false;
      showToast('图片已加载，可以开始生成', 'success');
    })
    .catch(err => {
      log('error', '[Upload]', '压缩失败:', err);
      showToast('图片处理失败：' + err.message, 'error');
    });
}

/* ----------------------------------------------------------------
   初始化上传区域事件
   ---------------------------------------------------------------- */
export function initUploadUI() {
  const uploadZone  = $('uploadZone');
  const fileInput   = $('fileInput');
  const previewArea = $('previewArea');
  const btnRemove   = $('btnRemove');
  const btnGenerate = $('btnGenerate');
  if (!uploadZone || !fileInput) return;

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

  btnRemove?.addEventListener('click', () => {
    state.imageBase64 = null;
    state.imageFile   = null;
    const previewImg = $('previewImg');
    if (previewImg)  previewImg.src            = '';
    if (previewArea) previewArea.style.display  = 'none';
    if (uploadZone)  uploadZone.style.display   = 'block';
    if (btnGenerate) btnGenerate.disabled       = true;
  });
}

/* ----------------------------------------------------------------
   渲染下载按钮 & 模型 URL 面板
   ---------------------------------------------------------------- */
export function renderDownloadButtons(modelUrls) {
  if (!modelUrls) return;

  const downloadCard = $('downloadCard');
  const downloadGrid = $('downloadGrid');
  if (!downloadGrid) return;

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
    a.href      = url;
    a.target    = '_blank';
    a.rel       = 'noopener';
    a.download  = `meshy-model.${fmt}`;
    a.innerHTML = `
      <span>${info.icon}</span>
      <span>${info.label} 文件</span>
      <span class="format-badge">${info.label}</span>
    `;
    downloadGrid.appendChild(a);
  });

  // 模型原始 URL 展示区
  const oldUrlPanel = document.getElementById('modelUrlPanel');
  if (oldUrlPanel) oldUrlPanel.remove();

  const panel = document.createElement('div');
  panel.id        = 'modelUrlPanel';
  panel.className = 'model-url-panel';
  panel.innerHTML = '<p class="model-url-title">🔗 模型原始 URL</p>';

  Object.entries(modelUrls).forEach(([fmt, rawUrl]) => {
    if (!rawUrl) return;
    const info = formatInfo[fmt] || { label: fmt.toUpperCase(), icon: '📄' };
    const row  = document.createElement('div');
    row.className = 'model-url-row';
    row.innerHTML = `
      <span class="model-url-fmt">${info.icon} ${info.label}</span>
      <input class="model-url-input" type="text" value="${rawUrl}" readonly title="${rawUrl}" />
      <button class="model-url-copy" data-url="${rawUrl}" title="复制">复制</button>
    `;
    panel.appendChild(row);
  });

  panel.querySelectorAll('.model-url-copy').forEach(btn => {
    btn.addEventListener('click', () => {
      navigator.clipboard.writeText(btn.dataset.url).then(() => {
        btn.textContent = '已复制';
        btn.classList.add('copied');
        setTimeout(() => { btn.textContent = '复制'; btn.classList.remove('copied'); }, 2000);
      });
    });
  });

  if (downloadCard) downloadCard.appendChild(panel);
}
