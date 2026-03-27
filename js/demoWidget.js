/* ================================================================
   demoWidget.js — 右下角 3D 示例悬浮小窗
   加载服务器上的 /public/models/demo.glb 并用 Three.js 渲染
   ================================================================ */

import * as THREE        from 'three';
import { GLTFLoader }    from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const MODEL_URL = '/public/models/demo.glb';

export function initDemoWidget() {
  const toggle   = document.getElementById('demoWidgetToggle');
  const panel    = document.getElementById('demoWidgetPanel');
  const closeBtn = document.getElementById('demoWidgetClose');
  const canvas   = document.getElementById('demoCanvas');
  const loading  = document.getElementById('demoWidgetLoading');
  const loadPct  = document.getElementById('demoLoadPct');
  const dot      = panel?.querySelector('.demo-widget-dot');

  if (!toggle || !panel || !canvas) return;

  let initiated = false;
  let renderer, scene, camera, controls, animId;

  // ── 开关面板 ─────────────────────────────────────────────
  toggle.addEventListener('click', () => {
    const isOpen = panel.classList.toggle('open');
    if (isOpen && !initiated) {
      initiated = true;
      initThree();
    } else if (isOpen) {
      startLoop();
    } else {
      stopLoop();
    }
  });

  closeBtn.addEventListener('click', () => {
    panel.classList.remove('open');
    stopLoop();
  });

  // ── Three.js 初始化 ───────────────────────────────────────
  function initThree() {
    const wrap = canvas.parentElement;

    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace   = THREE.SRGBColorSpace;
    renderer.toneMapping        = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    renderer.shadowMap.enabled  = true;

    scene  = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(45, wrap.clientWidth / wrap.clientHeight, 0.01, 500);
    camera.position.set(0, 1, 3);

    // 灯光
    scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(3, 5, 4);
    key.castShadow = true;
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xa78bfa, 0.35);
    fill.position.set(-3, 2, -3);
    scene.add(fill);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping   = true;
    controls.dampingFactor   = 0.07;
    controls.autoRotate      = true;
    controls.autoRotateSpeed = 1.2;
    controls.minDistance     = 0.5;
    controls.maxDistance     = 20;

    // 容器尺寸响应
    new ResizeObserver(() => {
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }).observe(wrap);
    renderer.setSize(wrap.clientWidth, wrap.clientHeight, false);

    // 加载模型
    if (dot) dot.classList.add('loading');
    new GLTFLoader().load(
      MODEL_URL,
      gltf => {
        const model = gltf.scene;
        const box    = new THREE.Box3().setFromObject(model);
        const size   = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z);
        const scale  = 2.0 / maxDim;
        model.scale.setScalar(scale);
        model.position.sub(center.multiplyScalar(scale));
        model.traverse(c => { if (c.isMesh) c.castShadow = true; });
        scene.add(model);

        camera.position.set(0, size.y * scale * 0.3, maxDim * scale * 1.8);
        controls.target.set(0, 0, 0);
        controls.update();

        loading.classList.add('hidden');
        if (dot) dot.classList.remove('loading');
      },
      xhr => {
        const pct = xhr.total ? Math.round(xhr.loaded / xhr.total * 100) : 0;
        if (loadPct) loadPct.textContent = `加载中 ${pct}%`;
      },
      err => {
        if (loadPct) loadPct.textContent = '加载失败';
        console.error('[DemoWidget]', err);
      }
    );

    startLoop();
  }

  function startLoop() {
    if (animId || !renderer) return;
    (function tick() {
      animId = requestAnimationFrame(tick);
      controls?.update();
      renderer.render(scene, camera);
    })();
  }

  function stopLoop() {
    if (animId) { cancelAnimationFrame(animId); animId = null; }
  }
}
