import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js';

let renderer = null;

export async function enterHeadset({ canvases, placement, onEnd }) {
  const canvas = document.getElementById('xr-view');
  if (!renderer) {
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.xr.enabled = true;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight, false);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  const placed = [];
  const camPos = new THREE.Vector3();
  const ahead = new THREE.Vector3();
  const normal = new THREE.Vector3();
  let hitTestSource = null;
  let referenceSpace = null;

  const reticle = new THREE.Mesh(
    new THREE.RingGeometry(0.045, 0.06, 32).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0xe6c27a }),
  );
  reticle.matrixAutoUpdate = false;
  reticle.visible = false;
  scene.add(reticle);

  const controller = renderer.xr.getController(0);
  const onSelect = () => {
    const choice = placement();
    const group = makeMarker(choice, canvases);
    if (reticle.visible) {
      const pose = new THREE.Matrix4().copy(reticle.matrix);
      group.position.setFromMatrixPosition(pose);
      normal.set(0, 1, 0).transformDirection(pose);
      group.position.addScaledVector(normal, 0.02);
    } else {
      const cam = renderer.xr.getCamera(camera);
      cam.getWorldPosition(camPos);
      cam.getWorldDirection(ahead);
      group.position.copy(camPos).addScaledVector(ahead, 1.4);
    }
    scene.add(group);
    placed.push(group);
  };
  controller.addEventListener('select', onSelect);
  scene.add(controller);

  const session = await requestSession();
  renderer.xr.setReferenceSpaceType('local');
  await renderer.xr.setSession(session);

  const viewerSpace = await session.requestReferenceSpace('viewer');
  try {
    hitTestSource = await session.requestHitTestSource({ space: viewerSpace });
  } catch {
    hitTestSource = null;
  }

  session.addEventListener('end', () => {
    controller.removeEventListener('select', onSelect);
    if (hitTestSource) hitTestSource.cancel();
    hitTestSource = null;
    renderer.setAnimationLoop(null);
    scene.clear();
    onEnd();
  });

  renderer.setAnimationLoop((time, frame) => {
    referenceSpace = renderer.xr.getReferenceSpace();
    if (frame && hitTestSource && referenceSpace) {
      const hits = frame.getHitTestResults(hitTestSource);
      if (hits.length) {
        const pose = hits[0].getPose(referenceSpace);
        if (pose) {
          reticle.visible = true;
          reticle.matrix.fromArray(pose.transform.matrix);
        }
      } else {
        reticle.visible = false;
      }
    }
    const cam = renderer.xr.getCamera(camera);
    cam.getWorldPosition(camPos);
    for (const group of placed) {
      group.lookAt(camPos.x, group.position.y, camPos.z);
    }
    renderer.render(scene, camera);
  });

  return {
    end() {
      return session.end();
    },
  };
}

async function requestSession() {
  const overlay = document.getElementById('overlay');
  try {
    return await navigator.xr.requestSession('immersive-ar', {
      optionalFeatures: ['hit-test', 'dom-overlay', 'local-floor'],
      domOverlay: { root: overlay },
    });
  } catch {
    return navigator.xr.requestSession('immersive-ar', {
      optionalFeatures: ['hit-test', 'local-floor'],
    });
  }
}

function makeMarker(choice, canvases) {
  const group = new THREE.Group();
  const stamp = canvases.get(choice.spriteId) || canvases.get('technology');
  const iconMaterial = new THREE.MeshBasicMaterial({
    color: stamp ? 0xffffff : 0xd7b15e,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  if (stamp) {
    const map = new THREE.CanvasTexture(stamp);
    map.colorSpace = THREE.SRGBColorSpace;
    iconMaterial.map = map;
  }
  const icon = new THREE.Mesh(new THREE.PlaneGeometry(0.24, 0.24), iconMaterial);
  icon.position.y = 0.2;
  group.add(icon);

  const plate = new THREE.Mesh(
    new THREE.PlaneGeometry(0.32, 0.08),
    new THREE.MeshBasicMaterial({
      map: nameTexture(choice.name || 'Filed'),
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  plate.position.y = 0.02;
  group.add(plate);
  return group;
}

function nameTexture(name) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'rgba(16, 11, 9, 0.9)';
  ctx.fillRect(0, 0, 512, 128);
  ctx.strokeStyle = '#e6c27a';
  ctx.lineWidth = 8;
  ctx.strokeRect(8, 8, 496, 112);
  ctx.fillStyle = '#f6ecdf';
  ctx.font = '600 48px Palatino, Georgia, serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  let size = 48;
  while (size > 22 && ctx.measureText(name).width > 460) {
    size -= 2;
    ctx.font = `600 ${size}px Palatino, Georgia, serif`;
  }
  ctx.fillText(name, 256, 64);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
