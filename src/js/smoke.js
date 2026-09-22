import * as THREE from "three";
import smokeUrl from '../texture/smoke_08.png';
const tex = new THREE.TextureLoader().load(smokeUrl);

const canvas = document.getElementById('popup-smoke');
const popup = document.getElementById('article-popup');

const smokeScene = new THREE.Scene();

const smokeCamera = new THREE.PerspectiveCamera(75, popup.offsetWidth / popup.offsetHeight, 1, 3000);
smokeCamera.position.z = 1100;
smokeCamera.position.x = 100;
smokeCamera.position.y = -650;

const smokeRenderer = new THREE.WebGLRenderer({ antialias: false, canvas, alpha: true, powerPreference: 'low-power' });
smokeRenderer.setPixelRatio(1);
smokeRenderer.setSize(popup.offsetWidth, popup.offsetHeight);
canvas.style.mixBlendMode = 'multiply';

const light = new THREE.HemisphereLight(0xd6e6ff, 0xa38c08, 1);
smokeScene.add(light);

const smokeGeo = new THREE.PlaneGeometry(300, 300);

const smokeMaterial = new THREE.MeshLambertMaterial({
  map: tex,
  color: 0x334466,
  emissive: 0x111111,
  opacity: 0.1,
  transparent: true,
  depthWrite: false,
  side: THREE.DoubleSide,
});

const smokeParticles = Array.from({ length: 150 }, () => {
  const mesh = new THREE.Mesh(smokeGeo, smokeMaterial.clone());
  mesh.scale.set(2, 2, 2);
  mesh.position.set((Math.random() - 0.5) * 2000, (Math.random() - 0.5) * 700, Math.random() * 600 - 200);
  mesh.rotation.z = Math.random() * Math.PI * 2;
  smokeScene.add(mesh);
  return mesh;
});

let rafId = null, lastTime = 0;
const animateSmoke = (now) => {
  rafId = requestAnimationFrame(animateSmoke);
  const delta = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  smokeParticles.forEach(p => p.rotation.z += delta * 0.12);
  smokeRenderer.render(smokeScene, smokeCamera);
};
const startSmoke = () => !rafId && (lastTime = performance.now(), requestAnimationFrame(animateSmoke));
const stopSmoke = () => rafId && (cancelAnimationFrame(rafId), rafId = null);

const observer = new MutationObserver(() => {
  if (popup.classList.contains('active')) {
    startSmoke();
  } else {
    stopSmoke();
  }
});
observer.observe(popup, { attributes: true, attributeFilter: ['class'] });

if (popup.classList.contains('active')) {
  startSmoke();
}

window.addEventListener('resize', () => {
  smokeCamera.aspect = popup.offsetWidth / popup.offsetHeight;
  smokeCamera.updateProjectionMatrix();
  smokeRenderer.setSize(popup.offsetWidth, popup.offsetHeight);
});