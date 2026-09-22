import './articles.js';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import busteUrl    from 'url:../../public/models/model.glb';
import cursorUrl   from 'url:../img/cursor.png';
import cursor2Url  from 'url:../img/cursor2.png';
import oeuvre1Url  from 'url:../img/oeuvre1.png';
import oeuvre2Url  from 'url:../img/oeuvre2.png';
import oeuvre3Url  from 'url:../img/oeuvre3.png';
import oeuvre4Url  from 'url:../img/oeuvre4.png';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass }     from 'three/examples/jsm/postprocessing/RenderPass.js';
import { OutlinePass }    from 'three/examples/jsm/postprocessing/OutlinePass.js';
import { OutputPass }     from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js';
import floorTexUrl     from 'url:../img/wall_b.png';
import wallLeftTexUrl  from 'url:../img/wall_l.png';
import wallRightTexUrl from 'url:../img/wall_r.png';
import ceilTexUrl      from 'url:../img/wall_top.png';

const scene = new THREE.Scene();

// near à 0.1 et non 0.01 : OutlinePass reconstruit la profondeur depuis une depth
// packée RGBA stockée en HalfFloat, soit ~5e-4 d'erreur absolue. Avec un ratio
// near/far de 100 000:1 cette erreur valait 1.8 unité à 6 de distance, le buste
// se jugeait derrière lui-même et son contour passait en hiddenEdgeColor.
// Pas plus haut : la butée élastique laisse la caméra descendre à
// BUSTE_ORBIT_MIN - BUSTE_ORBIT_OVERSHOOT = 1.7 du centre du buste, dont la
// demi-profondeur atteint ~1.3. Il ne reste que ~0.4 de marge avant le clipping.
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
// Cadrage des parois pendant le chargement du .glb uniquement : la pose de
// départ réelle est fixée dans le callback du loader, à partir de maxDim.
camera.position.set(0, 1, 6);

const canvas = document.getElementById('bg-smoke');
const renderer = new THREE.WebGLRenderer({ antialias: true, canvas });
renderer.setSize(window.innerWidth, window.innerHeight);
// Les lumières sont en unités physiques : sans tone mapping, tout ce qui dépasse
// 1.0 est tronqué net et le dégradé sous le néon s'aplatit en blanc pur.
// toneMappingExposure devient le réglage global de luminosité.
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.7    ;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

// ─── POST-PROCESSING ─────────────────────────────────────────────────────────
// Une seule chaîne : RenderPass (source) → OutlinePass (contour du buste seul)
// → OutputPass. OutputPass est indispensable dès qu'on passe par un composer :
// le tone mapping et la conversion sRGB du renderer ne s'appliquent plus
// automatiquement quand le rendu final sort d'un render target.

// Blanc et non noir : l'overlay d'OutlinePass est en AdditiveBlending, un contour
// sombre n'ajouterait rien et resterait invisible.
const OUTLINE = {
  edgeStrength:      3.0,
  edgeGlow:          0.0,
  edgeThickness:     1.5,
  pulsePeriod:       0,        // 0 = pas de clignotement
  visibleEdgeColor:  0xffffff,
  // Même couleur que visibleEdgeColor : filet de sécurité. Le test de profondeur
  // d'OutlinePass reste approximatif à distance, une teinte distincte ferait
  // clignoter le contour au lieu de signaler quoi que ce soit d'utile.
  hiddenEdgeColor:   0xffffff,
};

// Le pixel ratio est repris du renderer par le constructeur — ne pas le forcer,
// ça découplerait la résolution du composer de celle du canvas.
const composer = new EffectComposer(renderer);
composer.setSize(window.innerWidth, window.innerHeight);

composer.addPass(new RenderPass(scene, camera));

const outlinePass = new OutlinePass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  scene,
  camera
);
outlinePass.edgeStrength     = OUTLINE.edgeStrength;
outlinePass.edgeGlow         = OUTLINE.edgeGlow;
outlinePass.edgeThickness    = OUTLINE.edgeThickness;
outlinePass.pulsePeriod      = OUTLINE.pulsePeriod;
outlinePass.visibleEdgeColor.set(OUTLINE.visibleEdgeColor);
outlinePass.hiddenEdgeColor.set(OUTLINE.hiddenEdgeColor);
// Rempli au chargement du .glb : tant qu'il est vide, la passe est neutre.
outlinePass.selectedObjects = [];
composer.addPass(outlinePass);

composer.addPass(new OutputPass());

// ─── ÉCLAIRAGE ────────────────────────────────────────────────────────────────
//
// Une seule source directe : le néon du plafond, en RectAreaLight, seul type de
// Three.js dont l'émetteur a une surface — d'où un reflet spéculaire en barre sur
// le vernis du buste, impossible avec une source ponctuelle.
// Elle ne projette aucune ombre : c'est le rôle du SpotLight qui la double.
// Le remplissage de la pièce ne vient d'aucune lumière d'appoint mais du rebond
// des parois, capté par une CubeCamera (voir captureIndirectLighting).

RectAreaLightUniformsLib.init(); // obligatoire avant toute RectAreaLight

// Repères de réglage. Les cotes suivent la salle définie plus bas (W 24, H 14,
// D 32, centrée sur l'origine) : le plafond est donc à y = +7.
const LIGHT_HELPERS_VISIBLE = false; // arêtes colorées, masquées au chargement — touche G pour les afficher

const NEON = {
  x: 0,
  y: 6.8,   // juste sous le plafond
  z: 0,
  width: 9, // le long de X
  depth: 2.2, // le long de Z
  color: 0xfff4e0, // blanc légèrement chaud, typique d'un tube
  intensity: 30, // en nits — principal levier avec toneMappingExposure
  panelGlow: 3, // éclaircissement de la zone du plafond (voir neonCeilingGlow)

  // ─── ORIENTATION, en degrés ───────────────────────────────────────────────
  // Départ : émission verticale vers le bas, tube couché le long de X.
  // Les trois angles s'appliquent ensuite dans cet ordre, sur les axes du MONDE,
  // de sorte que chacun garde le même sens quels que soient les deux autres.
  yaw: 0,   // rotation du tube dans le plan du plafond, vu de dessus
            //   90 → le tube se couche le long de Z au lieu de X
  tiltX: 0, // bascule avant/arrière — positif incline l'émission vers +Z (caméra)
            //   45 → éclairage rasant sur le visage
  tiltZ: 0, // bascule gauche/droite — positif incline l'émission vers +X
};

// Arêtes de repérage. depthTest désactivé pour rester visibles à travers la
// géométrie, sinon le plafond les masque dès qu'on est dessous.
const lightHelpers = new THREE.Group();
lightHelpers.visible = LIGHT_HELPERS_VISIBLE;
scene.add(lightHelpers);

// Touche G. Les repères sont répartis entre deux groupes : lightHelpers, dans la
// scène, et neonHelperGroup, enfant du néon pour suivre son orientation. La
// bascule doit donc porter sur les deux.
// neonHelperGroup n'existe pas encore ici — la fonction n'est appelée qu'après.
// Espace maintenu : déclaré ici parce que le handler clavier, plus bas, précède
// la section DÉFORMATION DU BUSTE où vit le reste de l'état.
let deformHeld = false;

function toggleLightHelpers(force) {
  const next = force ?? !lightHelpers.visible;
  lightHelpers.visible = next;
  neonHelperGroup.visible = next;
  busteRigHelpers.visible = next;
  return next;
}

function addEdgeBox(w, h, d, color, position) {
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(w, h, d)),
    new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true })
  );
  edges.position.copy(position);
  edges.renderOrder = 999;
  lightHelpers.add(edges);
  return edges;
}

// ─── NÉON (source directe, sans ombre) ───────────────────────────────────────

const neonLight = new THREE.RectAreaLight(NEON.color, NEON.intensity, NEON.width, NEON.depth);
neonLight.position.set(NEON.x, NEON.y, NEON.z);

// Orientation reconstruite à partir des trois angles de NEON. Les rotations
// portent sur les axes du monde, et non sur ceux de la dalle : sans ça, régler
// tiltX changerait le sens de tiltZ, et le réglage deviendrait illisible.
const WORLD_X = new THREE.Vector3(1, 0, 0);
const WORLD_Y = new THREE.Vector3(0, 1, 0);
const WORLD_Z = new THREE.Vector3(0, 0, 1);

function applyNeonOrientation() {
  neonLight.rotation.set(0, 0, 0);
  // -PI/2 sur X : l'émission part vers le bas, la largeur reste sur X et la
  // hauteur du rectangle se couche sur Z.
  neonLight.rotateX(-Math.PI / 2);

  neonLight.rotateOnWorldAxis(WORLD_Y, THREE.MathUtils.degToRad(NEON.yaw));
  neonLight.rotateOnWorldAxis(WORLD_X, -THREE.MathUtils.degToRad(NEON.tiltX));
  neonLight.rotateOnWorldAxis(WORLD_Z, THREE.MathUtils.degToRad(NEON.tiltZ));
}

applyNeonOrientation();
scene.add(neonLight);

// Repères du néon, tous enfants de la lumière pour suivre son orientation —
// indispensable dès que la dalle est inclinée.
// Repère local de la dalle : X = width, Y = depth, émission vers -Z.
//
// Il n'y a pas d'arêtes de faisceau à tracer : une RectAreaLight rayonne sur
// tout l'hémisphère devant sa face. Tout est en magenta, la couleur propre du
// néon — une couleur par éclairage. Sont tracés : l'emprise du rectangle
// émetteur, la normale d'émission, le prisme d'emprise projeté, et le plan de
// coupure au-delà duquel plus rien n'est éclairé.
const NEON_HELPER_COLOR = 0xff00ff;

const neonHelperGroup = new THREE.Group();
neonHelperGroup.visible = LIGHT_HELPERS_VISIBLE;
neonLight.add(neonHelperGroup);

const NEON_HELPER_REACH = 14; // longueur des traits de visée, jusqu'au sol

function addNeonLines(points, color) {
  const line = new THREE.LineSegments(
    new THREE.BufferGeometry().setFromPoints(points),
    new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true })
  );
  line.renderOrder = 999;
  neonHelperGroup.add(line);
  return line;
}

const neonHelper = new THREE.LineSegments(
  new THREE.EdgesGeometry(new THREE.BoxGeometry(NEON.width, NEON.depth, 0.06)),
  new THREE.LineBasicMaterial({ color: NEON_HELPER_COLOR, depthTest: false, transparent: true })
);
neonHelper.renderOrder = 999;
neonHelperGroup.add(neonHelper);

addNeonLines(
  [new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -NEON_HELPER_REACH)],
  NEON_HELPER_COLOR
);

const hw = NEON.width / 2;
const hd = NEON.depth / 2;
const prism = [];
for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
  prism.push(
    new THREE.Vector3(sx * hw, sy * hd, 0),
    new THREE.Vector3(sx * hw, sy * hd, -NEON_HELPER_REACH)
  );
}
addNeonLines(prism, NEON_HELPER_COLOR);

// Plan de coupure, étendu bien au-delà de la dalle pour se lire dans la pièce
const cw = NEON.width * 2.5;
const cd = NEON.depth * 6;
addNeonLines(
  [
    new THREE.Vector3(-cw, -cd, 0), new THREE.Vector3(cw, -cd, 0),
    new THREE.Vector3(cw, -cd, 0), new THREE.Vector3(cw, cd, 0),
    new THREE.Vector3(cw, cd, 0), new THREE.Vector3(-cw, cd, 0),
    new THREE.Vector3(-cw, cd, 0), new THREE.Vector3(-cw, -cd, 0),
  ],
  NEON_HELPER_COLOR
);

// ─── PROJECTEUR D'OMBRE ──────────────────────────────────────────────────────
// Doublé au même endroit que le néon, uniquement pour l'ombre portée du buste.
// Son intensité participe aussi à l'éclairage : la baisser à zéro effacerait
// l'ombre, une ombre n'étant que l'absence de contribution de sa lumière.

const SHADOW_SPOT_INTENSITY = 10000;

const shadowSpot = new THREE.SpotLight(NEON.color, SHADOW_SPOT_INTENSITY, 0, 0.90, 1.9, 3);
shadowSpot.position.set(NEON.x, NEON.y, NEON.z);
shadowSpot.castShadow = true;
shadowSpot.shadow.mapSize.set(2048, 2048);
shadowSpot.shadow.camera.near = 0.5;
shadowSpot.shadow.camera.far = 40;
shadowSpot.shadow.radius = 8; // adoucit le contour, une dalle réelle a une large pénombre
shadowSpot.shadow.bias = -0.0005;
scene.add(shadowSpot);

// Cible repositionnée sur busteAnchor au chargement du .glb
const shadowSpotTarget = new THREE.Object3D();
scene.add(shadowSpotTarget);
shadowSpot.target = shadowSpotTarget;

// Cyan clair : arêtes du cône du spot — la seule limite de faisceau franche de
// tout l'éclairage, réglée par shadowSpot.angle. Le helper est dans le groupe
// lightHelpers, donc masqué avec les autres pendant la capture du rebond.
// SpotLightHelper suit la cible, ce qu'un simple enfant du spot ne ferait pas :
// l'orientation d'un SpotLight vient de son target, pas de sa rotation.
const shadowSpotHelper = new THREE.SpotLightHelper(shadowSpot, 0x66ffff);
lightHelpers.add(shadowSpotHelper);

// La zone lumineuse du plafond n'est pas produite par une lumière : aucune
// source n'a de bord net sur un plan, leur chute est toujours continue.
// Elle est créée par un quad posé contre le plafond — voir neonCeilingGlow,
// dans la section des parois, où les cotes de la salle sont disponibles.

// ─── CAGE DE REMPLISSAGE DU BUSTE ────────────────────────────────────────────
// Six PointLight disposées aux sommets d'un octaèdre autour de la tête, actives
// uniquement hors mode buste. Elles comblent les ombres que le néon zénithal
// creuse sous les arcades, le nez et le menton.
//
// PointLight et non RectAreaLight parce qu'elle possède un paramètre `distance` :
// au-delà, la contribution est exactement nulle, pas seulement faible. Three ne
// sait pas restreindre une lumière à un objet — light.layers n'est testé que
// contre camera.layers — donc la seule coupure disponible est cette portée.
//
// Le budget est serré et doit le rester : la surface la plus proche est le sol,
// à 7 unités sous l'ancre. Portée maximale = radius + distance, à garder sous 7.
// Les murs sont à 12 et 16, ils ne sont jamais concernés.
//
// Six directions plutôt qu'une seule : chaque source est faible et la somme
// couvre tout le pourtour, ce qui donne un remplissage homogène sans redessiner
// un second modelé concurrent de celui du néon.

const BUSTE_FILL = {
  radius: 2.5, // éloignement de chaque source depuis l'ancre
  distance: 4, // portée dure — 2.5 + 4 = 6.5, sous le sol à 7
  color: 0xfff0e0,
  intensity: 8, // par source
  decay: 2,
};

const busteFillRig = new THREE.Group();
scene.add(busteFillRig);

// En mode buste la cage se rétracte : six sources d'égale force annulent tout
// modelé, et c'est le rig qui doit alors sculpter. Chaque direction garde un
// poids propre, appliqué à mesure que le mode s'installe — la source du dessous
// est la plus réduite, un visage éclairé par en dessous ne ressemble à rien.
const BUSTE_FILL_BUSTE_RATIO = 0.3; // force d'ensemble de la cage en mode buste

const busteFillLights = [];

for (const [x, y, z, busteWeight] of [
  [ 1,  0,  0, 0.8],
  [-1,  0,  0, 0.8],
  [ 0,  1,  0, 1.0],
  [ 0, -1,  0, 0.2],
  [ 0,  0,  1, 0.7],
  [ 0,  0, -1, 0.5],
]) {
  const light = new THREE.PointLight(
    BUSTE_FILL.color, 0, BUSTE_FILL.distance, BUSTE_FILL.decay
  );
  light.userData.busteWeight = busteWeight;
  light.position.set(x, y, z).multiplyScalar(BUSTE_FILL.radius);
  busteFillRig.add(light);
  busteFillLights.push(light);

  // Orange : une seule couleur pour toute la cage, qui forme un éclairage unique
  const helper = new THREE.PointLightHelper(light, 0.25, 0xff8800);
  helper.material.depthTest = false;
  helper.material.transparent = true;
  helper.renderOrder = 999;
  lightHelpers.add(helper);
}

// ─── ÉCLAIRAGE DU BUSTE ──────────────────────────────────────────────────────
// Rig propre au mode buste, allumé quand toutes les autres sources s'éteignent.
//
// Trois points, la composition classique pour un portrait :
//   key  — la source principale, en trois-quarts haut, qui sculpte le volume
//   fill — un remplissage large et froid côté opposé, qui ouvre les ombres sans
//          créer de second modelé
//   rim  — un contre-jour derrière la tête, qui détache la silhouette du fond
//
// RectAreaLight partout, et non SpotLight : le buste est en roughness 0, donc
// quasi miroir. Une source ponctuelle n'y produirait qu'un point spéculaire
// minuscule, là où un panneau se reflète en une barre lisible qui donne la
// courbure. Aucune de ces sources ne projette d'ombre, ce qui est sans
// conséquence : la salle est effacée en mode buste, une ombre n'aurait nulle
// part où se poser.
//
// Le rig pivote avec la caméra (voir animate) : les positions ci-dessous sont
// donc relatives au regard, pas au monde. Sans cela, orbiter autour de la tête
// finirait par la présenter du côté non éclairé.
// Repère local : +Z vers la caméra, +X à droite du cadre, +Y vers le haut.

// Les intensités ci-dessous remplacent à elles seules le néon (30 nits sur un
// panneau de 9 × 2.2) et le rebond de la salle, tous deux éteints en mode buste.
// Un panneau proche compense mal une grande source lointaine : à angle solide
// comparable, il faut une luminance du même ordre, pas la fraction d'origine.
// BUSTE_RIG_GAIN reste le levier unique si l'ensemble est à reprendre.
const BUSTE_RIG_GAIN = 1.8;

// Géométrie : key en trois-quarts haut, ~45° d'azimut et ~40° d'élévation —
// l'angle qui creuse l'arcade et pose l'ombre du nez sur une joue. Panneau
// resserré pour que sa chute reste lisible : un panneau large enveloppe et
// reprend la platitude qu'on cherche à corriger. Fill à l'opposé, large et
// presque dans l'axe caméra, il ouvre les ombres sans y écrire un second
// modelé. Rim derrière, du côté opposé au key, pour décoller la nuque du fond.
//
// Rapport key/fill porté à ~8:1 : c'est ce rapport qui fait le contraste, pas
// les valeurs absolues. Le monter creuse, le baisser aplatit.
const BUSTE_RIG = {
  key:  { x:  1.75, y:  2.05, z:  1.75, w: 2.2, h: 1.6, color: 0xfff2e2, intensity: 7.0 * BUSTE_RIG_GAIN },
  fill: { x: -2.40, y: -0.10, z:  1.80, w: 3.6, h: 3.6, color: 0xdfe8ff, intensity: 0.9 * BUSTE_RIG_GAIN },
  rim:  { x: -1.90, y:  2.20, z: -2.20, w: 2.4, h: 1.0, color: 0xffffff, intensity: 5.0 * BUSTE_RIG_GAIN },
};

const busteRig = new THREE.Group();
scene.add(busteRig);

const busteRigHelpers = new THREE.Group();
busteRigHelpers.visible = LIGHT_HELPERS_VISIBLE;
busteRig.add(busteRigHelpers);

// Intensités mémorisées : l'intensité courante est modulée chaque frame par
// busteFocus et ne peut donc plus servir de référence.
const busteRigLights = [];

function addRigLight(cfg, helperColor) {
  const light = new THREE.RectAreaLight(cfg.color, 0, cfg.w, cfg.h);
  light.position.set(cfg.x, cfg.y, cfg.z);

  // Orientation calculée en espace LOCAL, vers l'origine du rig, c'est-à-dire
  // la tête. Object3D.lookAt raisonnerait en espace monde et serait faussé dès
  // que le rig pivote pour suivre la caméra.
  const m = new THREE.Matrix4().lookAt(light.position, new THREE.Vector3(), WORLD_Y);
  light.quaternion.setFromRotationMatrix(m);

  busteRig.add(light);
  busteRigLights.push({ light, base: cfg.intensity });

  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.PlaneGeometry(cfg.w, cfg.h)),
    new THREE.LineBasicMaterial({ color: helperColor, depthTest: false, transparent: true })
  );
  edges.position.copy(light.position);
  edges.quaternion.copy(light.quaternion);
  edges.renderOrder = 999;
  busteRigHelpers.add(edges);
}

addRigLight(BUSTE_RIG.key, 0xff2222); // rouge
addRigLight(BUSTE_RIG.fill, 0x22ff22); // vert
addRigLight(BUSTE_RIG.rim, 0x2288ff); // bleu

// ─── REBOND INDIRECT ─────────────────────────────────────────────────────────
// Three.js n'a pas d'illumination globale : sans ce qui suit, la pièce est noire
// partout où le néon ne frappe pas directement. La CubeCamera, placée au centre
// de la salle, photographie les parois éclairées et le résultat est renvoyé en
// scene.environment. Chaque MeshStandardMaterial reçoit alors une lumière venant
// des murs eux-mêmes, dosée par leur luminosité réelle — soit le rebond.
// Deux passes : la seconde intègre le premier rebond, comme un second rebond.

const pmrem = new THREE.PMREMGenerator(renderer);
const cubeRenderTarget = new THREE.WebGLCubeRenderTarget(256, { type: THREE.HalfFloatType });
const indirectCam = new THREE.CubeCamera(0.5, 120, cubeRenderTarget);
scene.add(indirectCam);

// Cyan : point de capture du rebond
const indirectMarker = addEdgeBox(1, 1, 1, 0x00ffff, indirectCam.position);

let indirectTarget = null;

function captureIndirectLighting(passes = 2) {
  // Les arêtes de repérage et les articles pollueraient la capture : les
  // premières sont un artefact de réglage, les seconds des aplats très clairs
  // qui feraient rebondir une lumière inexistante.
  const helpersWere = lightHelpers.visible;
  const neonHelperWas = neonHelperGroup.visible;
  lightHelpers.visible = false;
  neonHelperGroup.visible = false; // enfant du néon, hors du groupe lightHelpers
  const rigHelpersWere = busteRigHelpers.visible;
  busteRigHelpers.visible = false;

  // La cage de remplissage est éteinte pendant la capture : elle compense les
  // ombres du visage, la tête ne doit pas pour autant devenir une source de
  // rebond pour la pièce.
  const fillWere = busteFillLights.map((l) => l.intensity);
  busteFillLights.forEach((l) => { l.intensity = 0; });
  const wordsWere = wordMeshes.map((m) => m.visible);
  wordMeshes.forEach((m) => { m.visible = false; });

  for (let i = 0; i < passes; i++) {
    indirectCam.update(renderer, scene);
    const next = pmrem.fromCubemap(cubeRenderTarget.texture);
    if (indirectTarget) indirectTarget.dispose(); // la texture seule laisserait fuir la RT
    indirectTarget = next;
    scene.environment = next.texture;
  }

  lightHelpers.visible = helpersWere;
  neonHelperGroup.visible = neonHelperWas;
  busteRigHelpers.visible = rigHelpersWere;
  busteFillLights.forEach((l, i) => { l.intensity = fillWere[i]; });
  wordMeshes.forEach((m, i) => { m.visible = wordsWere[i]; });
}

// Déclenché quand toutes les textures ET le .glb sont chargés : capturer plus
// tôt photographierait une pièce sans ses images.
THREE.DefaultLoadingManager.onLoad = () => {
  indirectCam.position.copy(busteAnchor);
  indirectMarker.position.copy(busteAnchor);
  captureIndirectLighting();
};

// Matériau commun aux parois. MeshStandardMaterial est imposé par RectAreaLight,
// qui n'éclaire que Standard et Physical — et MeshBasicMaterial ignorait de toute
// façon toutes les lumières. La texture devient de l'albédo : elle reste affichée,
// mais multipliée par la lumière reçue.
function makeWallMaterial(map) {
  return new THREE.MeshStandardMaterial({ map, roughness: 0.95, metalness: 0 });
}

// Contrôle libre avec smoothing et orbite automatique près de la tête
//
// Deux jeux d'angles strictement séparés, jamais recopiés l'un dans l'autre :
//   free*  : orientation en vol libre, yaw depuis +Z → (sin y·cos p, sin p, cos y·cos p)
//   orbit* : position sur la sphère,   yaw depuis +X → (cos y·cos p, sin p, sin y·cos p)
// À chaque transition, le jeu d'angles qui prend la main est re-dérivé de l'état
// réel de la caméra (position ou orientation), ce qui exclut tout saut d'angle.
const PITCH_LIMIT = Math.PI / 2 - 0.05; // marge anti-bascule du vecteur up

const cameraControl = {
  // Vue libre (convention +Z)
  freeYaw: 0,
  freePitch: 0,
  targetFreeYaw: 0,
  targetFreePitch: 0,
  rotationSmoothing: 0.12,

  // Orbite (convention +X), partagée par les deux sphères
  orbitYaw: 0,
  orbitPitch: 0,
  targetOrbitYaw: 0,
  targetOrbitPitch: 0,
  orbitSmoothing: 0.08,

  // Zoom/mouvement avant-arrière
  zoomVelocity: 1,
  targetZoomVelocity: 0,
  zoomDamping: 0.85,
  zoomAcceleration: 0.8,

  // Machine à états : 'free' | 'buste' | 'room'
  mode: 'free',
  orbitBlend: 0, // 0→1, montée en puissance de l'attraction magnétique
  timeNearBuste: 0,
  magnetizeDelay: 0.01, // délai avant que la magnétisation ne commence à s'appliquer
  releaseCooldown: 0, // empêche la recapture immédiate après une sortie
  // Fige le rayon d'orbite juste après l'accrochage du buste, le temps que la
  // vue d'ensemble s'installe avant que le zoom ne reprenne la main.
  radiusLock: 0,
  // Magnétisation inversée : pousse la caméra hors de l'orbite du buste jusqu'au
  // mur, pour qu'elle ne stagne pas dans la bande morte qui les sépare.
  ejecting: false,
  ejectBlend: 0,
  // Hystérésis : après une sortie d'orbite, la caméra reste dans la zone qu'elle
  // vient de quitter. Sans ce verrou elle y serait reprise dès la fin du
  // cooldown, et sortir d'une orbite deviendrait impossible.
  captureArmed: false,
  // Sens du déplacement radial par rapport au buste : -1 on s'approche,
  // +1 on s'éloigne, 0 inconnu. Mémorisé pour survivre aux arrêts de scroll.
  radialDir: 0,
  prevDistToBust: null,
  recentering: false, // retour animé vers la position de départ (touche F)
  hoverBlend: 0, // 0 en orbite, 1 en vol libre : dose le flottement d'inactivité
  busteFocus: 0, // 0 → 1 sur toute la magnétisation buste ; pilote les fondus

  // Inertie du drag : l'orientation se prolonge et décélère au relâchement
  dragVelX: 0,
  dragVelY: 0,
  dragInertiaDamping: 0.93, // ~0.5s de course résiduelle
  dragHoldDamping: 0.85, // s'arrêter avant de relâcher tue l'élan

  // Enfoncement du rayon quand le zoom in bute sur BUSTE_ORBIT_MIN
  radiusBounce: 0,

  // Interaction souris
  isMouseDown: false,
  lastX: 0,
  lastY: 0,
};

renderer.domElement.addEventListener('mousedown', (e) => {
  cameraControl.isMouseDown = true;
  cameraControl.lastX = e.clientX;
  cameraControl.lastY = e.clientY;
});

renderer.domElement.addEventListener('mouseup', () => {
  cameraControl.isMouseDown = false;
});

// Applique un déplacement de souris aux angles cibles. Partagé par le drag et
// par son inertie, pour que le prolongement suive exactement la même courbe.
function applyDragDelta(deltaX, deltaY) {
  if (cameraControl.mode === 'free') {
    // Le drag pivote la caméra sur place
    cameraControl.targetFreeYaw += deltaX * 0.002;
    cameraControl.targetFreePitch += deltaY * 0.002;
    cameraControl.targetFreePitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, cameraControl.targetFreePitch));
  } else {
    // Le drag déplace la caméra AUTOUR de l'ancre (yaw inversé pour que l'objet
    // suive la souris au lieu de fuir devant elle)
    cameraControl.targetOrbitYaw += deltaX * 0.004;
    cameraControl.targetOrbitPitch += deltaY * 0.004;
    cameraControl.targetOrbitPitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, cameraControl.targetOrbitPitch));
  }
}

renderer.domElement.addEventListener('mousemove', (e) => {
  if (!cameraControl.isMouseDown) return;

  const deltaX = e.clientX - cameraControl.lastX;
  const deltaY = e.clientY - cameraControl.lastY;
  cameraControl.lastX = e.clientX;
  cameraControl.lastY = e.clientY;

  applyDragDelta(deltaX, deltaY);

  // Mémoriser l'allure du geste, lissée pour qu'une frame erratique ne dicte
  // pas à elle seule le prolongement au relâchement
  cameraControl.dragVelX += (deltaX - cameraControl.dragVelX) * 0.35;
  cameraControl.dragVelY += (deltaY - cameraControl.dragVelY) * 0.35;
});

// ─── HELPERS CAMÉRA ───────────────────────────────────────────────────────────

// Direction unitaire sur une sphère d'orbite (convention +X)
function orbitDirection(yaw, pitch) {
  const c = Math.cos(pitch);
  return new THREE.Vector3(Math.cos(yaw) * c, Math.sin(pitch), Math.sin(yaw) * c);
}

// Dérive les angles d'orbite depuis la position réelle de la caméra
function seedOrbitFromPosition(anchor) {
  const rel = camera.position.clone().sub(anchor);
  const len = rel.length();
  if (len < 1e-4) return;
  cameraControl.orbitYaw = Math.atan2(rel.z, rel.x);
  cameraControl.orbitPitch = Math.asin(Math.max(-1, Math.min(1, rel.y / len)));
  cameraControl.targetOrbitYaw = cameraControl.orbitYaw;
  cameraControl.targetOrbitPitch = cameraControl.orbitPitch;
}

// Dérive les angles de vue libre depuis l'orientation réelle de la caméra.
// Inverse exact de la formule de freeDirection ⇒ aucun saut en sortie d'orbite.
function seedFreeFromCamera() {
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  cameraControl.freeYaw = Math.atan2(dir.x, dir.z);
  cameraControl.freePitch = Math.max(
    -PITCH_LIMIT,
    Math.min(PITCH_LIMIT, Math.asin(Math.max(-1, Math.min(1, dir.y))))
  );
  cameraControl.targetFreeYaw = cameraControl.freeYaw;
  cameraControl.targetFreePitch = cameraControl.freePitch;
}

// Décalage de flottement appliqué en fin de frame, retiré au début de la
// suivante : la machine à états raisonne toujours sur une position non perturbée
const hoverOffset = new THREE.Vector3();
// Pendant du précédent pour la rotation : le flottement s'applique en suffixe
// sur le quaternion de la caméra, il doit donc être défait en début de frame.
const hoverSway = new THREE.Quaternion();

// Pose de départ de la caméra, capturée une fois le modèle chargé
const cameraHome = {
  position: new THREE.Vector3(),
  quaternion: new THREE.Quaternion(),
  orbitRadius: 3.5,
  ready: false,
};

// Relâche l'orbite en cours et repasse en vol libre sans discontinuité
function releaseToFree(cooldown) {
  cameraControl.mode = 'free';
  cameraControl.orbitBlend = 0;
  cameraControl.timeNearBuste = 0;
  cameraControl.releaseCooldown = cooldown;
  cameraControl.captureArmed = false;
  seedFreeFromCamera();
}

// Ramène un angle cible sur le tour le plus proche de l'angle courant.
// orbitYaw s'accumule librement au drag : sans ça, viser atan2 (borné à ±π)
// peut déclencher plusieurs tours de sphère.
function nearestAngle(target, current) {
  return current + Math.atan2(Math.sin(target - current), Math.cos(target - current));
}

// Touche F. En orbite : on y reste, seuls les angles glissent vers le point
// de la sphère qui fait face au buste. En vol libre : retour à la pose de départ.
function recenterCamera() {
  if (!cameraHome.ready) return;

  if (cameraControl.mode !== 'free') {
    const front = cameraHome.position.clone().sub(busteAnchor);
    const len = front.length();
    if (len < 1e-4) return;

    const yaw = Math.atan2(front.z, front.x);
    const pitch = Math.asin(Math.max(-1, Math.min(1, front.y / len)));

    cameraControl.targetOrbitYaw = nearestAngle(yaw, cameraControl.orbitYaw);
    cameraControl.targetOrbitPitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, pitch));
    return;
  }

  cameraControl.orbitBlend = 0;
  cameraControl.timeNearBuste = 0;
  cameraControl.zoomVelocity = 0;
  cameraControl.targetZoomVelocity = 0;
  cameraControl.recentering = true;
  orbitSphereRadius = cameraHome.orbitRadius;
}

// Touche H. Escamote le buste : il disparaît et cesse d'exister pour la
// navigation — plus de magnétisation, plus de rattrapage « trop près ».
// La caméra déjà en orbite est éjectée, pour ne pas tourner autour du vide.
function toggleBuste() {
  busteHidden = !busteHidden;

  if (busteHidden && cameraControl.mode === 'buste') {
    releaseToFree(0.8);
    cameraControl.ejecting = true;
    cameraControl.ejectBlend = 0;
    cameraControl.zoomVelocity = 0;
    cameraControl.targetZoomVelocity = 0;
  }
}

window.addEventListener('keydown', (e) => {
  if (e.repeat) return;

  // Ne pas voler les touches à un champ de saisie
  const el = e.target;
  if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(el.tagName))) return;

  if (e.code === 'KeyF') {
    e.preventDefault();
    recenterCamera();
  } else if (e.code === 'KeyH') {
    e.preventDefault();
    toggleBuste();
  } else if (e.code === 'KeyG') {
    e.preventDefault();
    toggleLightHelpers();
  } else if (e.code === 'Space') {
    // preventDefault obligatoire : Espace fait défiler la page par défaut.
    e.preventDefault();
    deformHeld = true;
  }
});

// Le relâchement ne passe pas par le handler ci-dessus : e.repeat y filtre les
// répétitions, et la garde sur les champs de saisie laisserait la déformation
// bloquée si le focus partait dans un input pendant l'appui.
window.addEventListener('keyup', (e) => {
  if (e.code === 'Space') deformHeld = false;
});

// Filet de sécurité. Changer d'onglet ou de fenêtre pendant l'appui empêche le
// keyup d'arriver : sans ça le buste resterait tordu au retour.
window.addEventListener('blur', () => { deformHeld = false; });

renderer.domElement.addEventListener('wheel', (e) => {
  e.preventDefault();
  const moveDir = e.deltaY > 0 ? -1 : 1;
  cameraControl.targetZoomVelocity = moveDir * 0.3;
}, { passive: false });

// ─── SCÈNE PAROIS ────────────────────────────────────────────────────────────

const textureLoaderRoom = new THREE.TextureLoader();

const floorTex     = textureLoaderRoom.load(floorTexUrl);
const wallLeftTex  = textureLoaderRoom.load(wallLeftTexUrl);
const wallRightTex = textureLoaderRoom.load(wallRightTexUrl);
const ceilTex      = textureLoaderRoom.load(ceilTexUrl);

floorTex.colorSpace     = THREE.SRGBColorSpace;
wallLeftTex.colorSpace  = THREE.SRGBColorSpace;
wallRightTex.colorSpace = THREE.SRGBColorSpace;
ceilTex.colorSpace      = THREE.SRGBColorSpace;

const W = 24; // largeur (axe X) — assez étroit pour que les murs latéraux soient bien visibles
const D = 32; // profondeur (axe Z) — la caméra sera près du bord avant
const H = 14; // hauteur (axe Y)

const room = new THREE.Group();

// Sol
const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(W, D),
  makeWallMaterial(floorTex)
);
floor.rotation.x = -Math.PI / 2;
floor.position.set(0, -H / 2, 0);
room.add(floor);

// Plafond
const ceil = new THREE.Mesh(
  new THREE.PlaneGeometry(W, D),
  makeWallMaterial(ceilTex)
);
ceil.rotation.x = Math.PI / 2;
ceil.position.set(0, H / 2, 0);
room.add(ceil);

// ─── ZONE ÉCLAIRÉE DU PLAFOND ────────────────────────────────────────────────
// Quad plaqué sous le plafond, sur la seule emprise du néon. Il rejoue la MÊME
// texture, recadrée sur la portion qu'il recouvre : l'image reste donc lisible,
// simplement éclaircie. Un aplat émissif l'aurait masquée.
//
// La texture est clonée parce que offset et repeat sont portés par l'objet
// Texture : les modifier sur ceilTex recadrerait aussi le plafond entier.
//
// Émissif plutôt que MeshBasicMaterial : la zone participe alors à la capture
// du rebond et éclaire réellement la pièce par ricochet.
//
// Aligné sur les axes, piloté par NEON.x/z/width/depth seuls. Il ne suit ni yaw
// ni les tilts de la dalle : le recadrage UV n'aurait plus de sens en rotation,
// la texture tournerait par rapport au reste du plafond.
const ceilGlowTex = ceilTex.clone();
ceilGlowTex.needsUpdate = true;
ceilGlowTex.colorSpace = THREE.SRGBColorSpace;
ceilGlowTex.repeat.set(NEON.width / W, NEON.depth / D);
ceilGlowTex.offset.set(
  (NEON.x - NEON.width / 2 + W / 2) / W,
  (NEON.z - NEON.depth / 2 + D / 2) / D
);

const neonCeilingGlow = new THREE.Mesh(
  new THREE.PlaneGeometry(NEON.width, NEON.depth),
  new THREE.MeshStandardMaterial({
    map: ceilGlowTex,
    emissive: 0xc8c8c8,
    emissiveMap: ceilGlowTex,
    emissiveIntensity: NEON.panelGlow,
    roughness: 0.95,
    metalness: 0,
  })
);
neonCeilingGlow.rotation.x = Math.PI / 2; // même orientation que le plafond
neonCeilingGlow.position.set(NEON.x, H / 2 - 0.02, NEON.z); // décollé, évite le z-fighting
room.add(neonCeilingGlow);

// Mur gauche — face intérieure vers +X
const wallLeft = new THREE.Mesh(
  new THREE.PlaneGeometry(D, H),
  makeWallMaterial(wallLeftTex)
);
wallLeft.rotation.y = Math.PI / 2;
wallLeft.position.set(-W / 2, 0, 0);
room.add(wallLeft);

// Mur droit — face intérieure vers -X
const wallRight = new THREE.Mesh(
  new THREE.PlaneGeometry(D, H),
  makeWallMaterial(wallRightTex)
);
wallRight.rotation.y = -Math.PI / 2;
wallRight.position.set(W / 2, 0, 0);
room.add(wallRight);

/* Mur du fond — face intérieure vers +Z
const wallBack = new THREE.Mesh(
  new THREE.PlaneGeometry(W, H),
  makeWallMaterial(wallLeftTex)
);
wallBack.rotation.y = Math.PI;
wallBack.position.set(0, 0, -D / 2);
room.add(wallBack);*/

scene.add(room);

// Les parois reçoivent l'ombre portée du buste. shadowSide en BackSide parce que
// les plans sont simple face et retournés vers l'intérieur : sans lui, la carte
// d'ombre est rendue depuis la face culled et l'ombre n'apparaît pas.
room.traverse((child) => {
  if (child.isMesh) {
    child.receiveShadow = true;
    child.material.shadowSide = THREE.BackSide;
  }
});
// Centre de la salle aligné sur celui du buste. Le décalage en Z de -6 datait
// d'un cadrage initial ; il n'a plus lieu d'être depuis que busteAnchor est le
// centre unique des sphères de magnétisation et d'orbite.
// Réaffirmé depuis busteAnchor au chargement du .glb, pour suivre un éventuel
// BUSTE_ANCHOR_OFFSET.
room.position.set(0, 0, 0);

const mouse2D = new THREE.Vector2(-999, -999);

// ─── CURSEUR PERSONNALISÉ ─────────────────────────────────────────────────────

const cursorStyle = document.createElement('style');
cursorStyle.textContent = `* { cursor: none !important; }`;
document.head.appendChild(cursorStyle);

const cursorEl = document.createElement('div');
cursorEl.style.cssText = `
  position: fixed;
  pointer-events: none;
  mix-blend-mode: difference;
  z-index: 9999;
  transform: translate(-50%, -50%);
`;
const cursorImg = document.createElement('img');
cursorImg.src = cursorUrl;
cursorImg.style.width = '50px';
cursorEl.appendChild(cursorImg);
document.body.appendChild(cursorEl);

function isClickable(element) {
  if (!element) return false;
  const clickableTags = ['A', 'BUTTON', 'INPUT', 'TEXTAREA', 'SELECT'];
  if (clickableTags.includes(element.tagName)) return true;
  if (element.getAttribute('onclick')) return true;
  if (element.getAttribute('role') === 'button') return true;
  // Check parents for clickable elements
  let parent = element.parentElement;
  while (parent) {
    if (clickableTags.includes(parent.tagName) || parent.getAttribute('onclick') || parent.getAttribute('role') === 'button') {
      return true;
    }
    parent = parent.parentElement;
  }
  return false;
}

let isOverClickableElement = false;

window.addEventListener('mousemove', (e) => {
  mouse2D.x =  (e.clientX / window.innerWidth)  * 2 - 1;
  mouse2D.y = -(e.clientY / window.innerHeight) * 2 + 1;
  // maskPass.uniforms['uMouse'].value.set(e.clientX, window.innerHeight - e.clientY);
  cursorEl.style.left = e.clientX + 'px';
  cursorEl.style.top  = e.clientY + 'px';

  const target = document.elementFromPoint(e.clientX, e.clientY);
  isOverClickableElement = isClickable(target);
});

// ─── SCÈNE BUSTE (isolée pour le depth) ───────────────────────────────────────

const sceneBuste = new THREE.Scene();
sceneBuste.add(new THREE.HemisphereLight(0xffffff, 0x8888aa, 1));

const dirLight2 = new THREE.DirectionalLight(0xffffff, 3);
dirLight2.position.set(20, 0, 45);
sceneBuste.add(dirLight2);

const backLight2 = new THREE.DirectionalLight(0xffffff, 3);
backLight2.position.set(-20, 0, -45);
sceneBuste.add(backLight2);

let busteHidden = false; // Escamotage par la touche H
let bustePrincipal = null; // Référence au buste principal
let busteClone = null; // Référence au buste clone
let busteBaseY = 0; // Position Y initiale du buste
let orbitSphereRadius = 4.8; // Rayon de la sphère d'orbite autour du buste (variable avec le zoom)
const BUSTE_ORBIT_MIN = 3.7; // Distance de repos minimale : la caméra revient toujours là
const BUSTE_ORBIT_OVERSHOOT = 2; // Enfoncement élastique toléré sous la butée (jusqu'à 2)
// Doit rester au-dessus du seuil de capture (BUSTE_ORBIT_ENTRY * 1.25 = 6.0),
// pour que le relâchement dépose la caméra hors de sa propre zone de capture.
// Sinon la sortie ne tient plus que par le verrou captureArmed.
const BUSTE_ORBIT_MAX = 6.5; // Au-delà, on relâche vers le vol libre
// Rayon d'entrée commun à la magnétisation et au rattrapage « trop près », pour
// que les deux chemins déposent la caméra à la même distance du buste.
// Découplé de BUSTE_ORBIT_MAX : entrer pile sur le seuil d'éjection ne laissait
// aucune marge de dézoom, et le changement de signe de radialSpeed pendant le
// recentrage suffisait à annuler la capture toute seule.
const BUSTE_ORBIT_ENTRY = 4.8;
// Le mode room n'est pas une sphère mais un mur sphérique épais, centré comme
// les autres sur busteAnchor. La caméra orbite n'importe où dans la bande :
//   face interne : touchée en s'éloignant, elle déclenche d'un seul coup la
//     magnétisation, le recentrage du regard sur le buste et l'entrée en mode
//     room ; franchie vers le buste, elle fait quitter le mode
//   face externe : mur dur, éloignement maximal absolu de la scène
//
// ROOM_ORBIT_MIN doit rester nettement au-dessus de BUSTE_ORBIT_MAX * 1.25
// (= 11.25, la zone de capture du buste la plus large) : c'est dans l'écart
// entre les deux que la capture se réarme après une sortie d'orbite.
const ROOM_ORBIT_MIN = 20;
// Marge d'accrochage : la caméra n'est pas déposée pile sur la face interne mais
// un peu au-delà. Une fois recentrée sur le buste, le zoom in résiduel devient
// un rapprochement ; sans cette réserve il repasse aussitôt la face interne et
// renvoie l'utilisateur en vol libre.
const ROOM_ORBIT_ENTRY_MARGIN = 8;

// Distance visée par l'éjection à la sortie de l'orbite du buste. Doit rester
// dans la bande morte, entre le seuil de capture du buste (6.0) et la face
// interne du mur (ROOM_ORBIT_MIN) : viser le mur y déposait la caméra d'office,
// alors que l'éjection doit seulement dégager la sortie, pas choisir la suite.
const BUSTE_EJECT_TARGET = 12;
const ROOM_ORBIT_MAX = 60;
let roomOrbitRadius = ROOM_ORBIT_MIN;

// Le GLB est recentré sur le centre de sa bounding box, qui ne coïncide pas
// forcément avec le centre visuel de la tête (nuque, épaules, cheveux tirent la
// box d'un côté). Ce décalage corrige l'ancre commune à la capture, à l'orbite
// et au regard : sans lui, la sphère capture plus tôt d'un côté que de l'autre.
const BUSTE_ANCHOR_OFFSET = new THREE.Vector3(0, 0, 0);
const busteAnchor = new THREE.Vector3();

// ─── DÉFORMATION DU BUSTE ────────────────────────────────────────────────────
//
// Torsion hélicoïdale autour de l'axe vertical + anneaux qui remontent le long
// du corps, visibles tant que la touche Espace est maintenue.
// Purement visuelle : le déplacement a lieu dans le vertex shader, la
// géométrie JS n'est pas touchée. Le Raycaster, les Box3, BUSTE_ORBIT_MIN et la
// sphère de capture continuent donc de voir le buste d'origine.
//
// Rien de tout ceci ne touche au matériau : couleurs, roughness et éclairage
// restent exactement ceux du modèle.

const DEFORM = {
  enabled:    true,

  twistTurns: 0.75,  // tours complets de torsion sur toute la hauteur du buste
  twistSpeed: 0.15,  // rotation lente de l'hélice, en tours par seconde
  rings:      16,    // nombre d'anneaux sur la hauteur
  ringAmp:    0.030, // creux/bosse des anneaux, en fraction de la hauteur
  ringSpeed:  0.8,   // remontée des anneaux, en anneaux par seconde
  inflate:    0.012, // gonflement constant le long des normales, même unité

  // Vitesse de fondu à l'appui et au relâchement d'Espace. Un basculement sec
  // ferait sauter la silhouette d'une frame à l'autre.
  ease:       0.10,
};

// Rotation de Rodrigues. Trois produits vectoriels valent mieux qu'une matrice
// ici : l'axe change d'un mesh à l'autre, il faudrait la reconstruire à chaque
// fois. `axis` doit être normalisé.
const DEFORM_GLSL = /* glsl */`
  uniform vec3  uCenter;
  uniform vec3  uAxis;
  uniform float uScale;
  uniform float uTime, uTwist, uTwistSpeed;
  uniform float uRingFreq, uRingAmp, uRingSpeed, uInflate;
  // Dosage global, piloté par la touche Espace. À 0 les trois termes s'annulent
  // et les quatre shaders redeviennent l'identité — pas d'écart résiduel.
  uniform float uAmount;

  vec3 df_rot(vec3 v, vec3 axis, float a) {
    float c = cos(a), s = sin(a);
    return v * c + cross(axis, v) * s + axis * dot(axis, v) * (1.0 - c);
  }
  // Hauteur le long de l'axe, ramenée en unités monde : chaque mesh du GLB porte
  // sa propre échelle de nœud (0.023 à 0.56), un réglage exprimé en unités objet
  // donnerait 24 anneaux sur l'un et 1 sur l'autre.
  float df_height(vec3 p) { return dot(p - uCenter, uAxis) * uScale; }
  float df_angle(float h)  { return (h * uTwist + uTime * uTwistSpeed) * uAmount; }
  float df_offset(float h) {
    return (uInflate + uRingAmp * sin(h * uRingFreq - uTime * uRingSpeed))
           * uAmount / uScale;
  }
`;

// Déplacement du sommet. `normal` est l'attribut brut, disponible dans les quatre
// shaders patchés — y compris ceux d'OutlinePass, qui n'ont pas de objectNormal.
const DEFORM_POSITION = /* glsl */`
  {
    vec3  rel = position - uCenter;
    float h   = df_height(position);
    vec3  n   = normalize(df_rot(normal, uAxis, df_angle(h)));
    transformed = uCenter + df_rot(rel, uAxis, df_angle(h)) + n * df_offset(h);
  }
`;

// Normale de la surface déformée. La torsion tourne la normale du même angle ;
// les anneaux l'inclinent de la pente du profil. Sans ce second terme, les
// anneaux ne se verraient que sur la silhouette, l'ombrage resterait lisse.
const DEFORM_NORMAL = /* glsl */`
  {
    float h  = df_height(position);
    vec3  n  = normalize(df_rot(objectNormal, uAxis, df_angle(h)));
    float dd = uRingAmp * uRingFreq * cos(h * uRingFreq - uTime * uRingSpeed) * uAmount;
    vec3  tg = uAxis - n * dot(uAxis, n);
    objectNormal = normalize(n - tg * dd);
  }
`;

const deformShaders = [];   // pour propager uTime
const deformOverrides = []; // matériaux partagés d'OutlinePass, uniformes par mesh
let deformHeight = 0;       // hauteur du buste, connue seulement après chargement
let deformAmount = 0;       // dosage courant, lissé vers deformHeld

// `frame` porte l'axe et l'origine exprimés dans l'espace objet DU MESH, plus son
// échelle. withNormal est faux pour les shaders de profondeur, qui n'ont pas de
// objectNormal à corriger.
function patchDeform(material, frame, withNormal) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, {
      uCenter:     { value: frame ? frame.center : new THREE.Vector3() },
      uAxis:       { value: frame ? frame.axis   : new THREE.Vector3(0, 1, 0) },
      uScale:      { value: frame ? frame.scale  : 1 },
      uTime:       { value: 0 },
      uTwist:      { value: 0 },
      uTwistSpeed: { value: 0 },
      uRingFreq:   { value: 0 },
      uRingAmp:    { value: 0 },
      uRingSpeed:  { value: 0 },
      uInflate:    { value: 0 },
      uAmount:     { value: 0 }, // au repos : buste d'origine
    });

    // Insertion avant main() et non après `#include <common>` : le vertex shader
    // de prepareMaskMaterial, dans OutlinePass, est écrit à la main et n'inclut
    // pas ce chunk. Un replace sans effet est silencieux, les uniformes
    // manqueraient et la compilation échouerait sur des identifiants inconnus.
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', `${DEFORM_GLSL}\nvoid main() {`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${DEFORM_POSITION}`);

    if (withNormal) {
      shader.vertexShader = shader.vertexShader
        .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>\n${DEFORM_NORMAL}`);
    }

    material.userData.deformShader = shader;
    deformShaders.push(shader);
  };
  material.needsUpdate = true;
}

// Les réglages sont donnés en fraction de la hauteur ; la conversion en unités
// monde n'est possible qu'une fois la bounding box connue.
function pushDeformSettings(shader, height) {
  const TAU = Math.PI * 2;
  shader.uniforms.uTwist.value      = (DEFORM.twistTurns * TAU) / height;
  shader.uniforms.uTwistSpeed.value = DEFORM.twistSpeed * TAU;
  shader.uniforms.uRingFreq.value   = (DEFORM.rings * TAU) / height;
  shader.uniforms.uRingSpeed.value  = DEFORM.ringSpeed * TAU;
  shader.uniforms.uRingAmp.value    = DEFORM.ringAmp * height;
  shader.uniforms.uInflate.value    = DEFORM.inflate * height;
}

// Repère de déformation d'un mesh, exprimé dans SON espace objet. L'axe de la
// torsion doit être commun à tous les meshes, sans quoi chacun se tordrait
// autour du sien et le buste se disloquerait.
function deformFrame(child, axisPointRig) {
  const inv = new THREE.Matrix4().copy(child.matrixWorld).invert();
  const center = axisPointRig.clone().applyMatrix4(inv);
  // Direction et non point : on retire la translation en transformant l'origine
  // séparément, puis on normalise — l'échelle disparaît au passage.
  const axis = new THREE.Vector3(0, 1, 0)
    .applyMatrix4(inv)
    .sub(new THREE.Vector3(0, 0, 0).applyMatrix4(inv))
    .normalize();
  return { center, axis, scale: child.getWorldScale(new THREE.Vector3()).x || 1 };
}

const loader = new GLTFLoader();

loader.load(
  busteUrl,
  (gltf) => {
    bustePrincipal = gltf.scene; // Stocker la référence
    scene.add(gltf.scene);

    // Seul objet contouré. La racine suffit : OutlinePass descend la hiérarchie.
    outlinePass.selectedObjects = [gltf.scene];

    // Bounding box mesurée racine à l'origine : c'est le repère dans lequel la
    // déformation s'exprime, et il doit être connu avant de patcher les shaders.
    gltf.scene.position.set(0, 0, 0);
    gltf.scene.updateMatrixWorld(true);
    const rigBox    = new THREE.Box3().setFromObject(gltf.scene);
    const rigHeight = Math.max(1e-4, rigBox.max.y - rigBox.min.y);
    // L'axe de torsion passe par le centre du buste, pas par l'origine du monde.
    const axisPoint = new THREE.Vector3(
      (rigBox.min.x + rigBox.max.x) / 2, 0, (rigBox.min.z + rigBox.max.z) / 2
    );

    gltf.scene.traverse((child) => {
      if (child.isMesh) {
        child.material = new THREE.MeshStandardMaterial({
          color: child.material.color ?? 0xcccccc,
          roughness: 1,
          metalness: 0,
        });
        // Seul objet à projeter une ombre ; il reçoit aussi la sienne
        child.castShadow = true;
        child.receiveShadow = true;

        if (DEFORM.enabled) {
          const frame = deformFrame(child, axisPoint);
          child.userData.deformFrame = frame;

          patchDeform(child.material, frame, true);

          // castShadow passe par un depthMaterial interne qui ignore
          // onBeforeCompile : sans ce doublon l'ombre resterait celle du buste
          // non déformé. Pas de normale ici, la profondeur n'en a pas besoin.
          const depthMat = new THREE.MeshDepthMaterial({
            depthPacking: THREE.RGBADepthPacking,
          });
          patchDeform(depthMat, frame, false);
          child.customDepthMaterial = depthMat;

          // OutlinePass impose ses propres matériaux en overrideMaterial et ne
          // regarde ni le matériau du mesh ni customDepthMaterial. Non patchés,
          // ils traceraient le contour du buste lisse : une silhouette fantôme
          // flottant autour de l'objet tordu. Ils sont partagés par tous les
          // meshes, d'où le passage du repère juste avant chaque dessin.
          child.onBeforeRender = () => {
            for (let i = 0; i < deformOverrides.length; i++) {
              const sh = deformOverrides[i].userData.deformShader;
              if (!sh) continue;
              sh.uniforms.uCenter.value = frame.center;
              sh.uniforms.uAxis.value   = frame.axis;
              sh.uniforms.uScale.value  = frame.scale;
            }
          };
        }
      }
    });

    if (DEFORM.enabled) {
      // Patchés ici et non à la création d'OutlinePass : la conversion des
      // réglages en unités monde a besoin de rigHeight.
      for (const m of [outlinePass.depthMaterial, outlinePass.prepareMaskMaterial]) {
        patchDeform(m, null, false);
        deformOverrides.push(m);
      }
      deformHeight = rigHeight;
    }

    const box    = new THREE.Box3().setFromObject(gltf.scene);
    const center = box.getCenter(new THREE.Vector3());
    gltf.scene.position.sub(center);

    const size   = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);

    // Ancre commune capture / orbite / regard
    busteAnchor.copy(BUSTE_ANCHOR_OFFSET);

    // La salle suit l'ancre : un même centre pour la scène et pour la navigation
    room.position.copy(busteAnchor);

    // Le projecteur d'ombre vise le buste
    shadowSpotTarget.position.copy(busteAnchor);
    shadowSpotTarget.updateMatrixWorld();
    shadowSpotHelper.update(); // le cône ne se redessine pas tout seul

    // Repères pour régler BUSTE_ANCHOR_OFFSET : une box très asymétrique en Z ou
    // en Y explique une capture qui se déclenche plus tôt d'un côté que de l'autre
    console.log('[buste] taille bbox', size.toArray().map((v) => +v.toFixed(3)));
    console.log('[buste] ancre', busteAnchor.toArray());

    // Le rayon d'orbite n'est plus dérivé de maxDim : il vient uniquement de la
    // déclaration de orbitSphereRadius, seule source de vérité, cohérente avec
    // BUSTE_ORBIT_MIN / MAX. L'ancienne valeur maxDim * 0.8 les dépassait et
    // faisait varier le seuil de capture avant puis après la première orbite.

    camera.position.set(busteAnchor.x, busteAnchor.y + maxDim * 0.2, busteAnchor.z + maxDim * 2);

    // Orienter la caméra vers le buste, puis dériver les angles de vue libre
    // depuis l'orientation obtenue (source de vérité unique)
    camera.lookAt(busteAnchor);
    seedFreeFromCamera();

    // Mémoriser cette pose : la touche F y ramène la caméra
    cameraHome.position.copy(camera.position);
    cameraHome.quaternion.copy(camera.quaternion);
    cameraHome.orbitRadius = orbitSphereRadius;
    cameraHome.ready = true;

    // Salle à position fixe, indépendante de la caméra (position déjà définie initialement)

    busteClone = gltf.scene.clone(true);
    busteClone.position.copy(gltf.scene.position);
    busteClone.traverse((child) => {
      if (child.isMesh) {
        child.material = new THREE.MeshStandardMaterial({
          color: 0xcccccc,
          roughness: 0,
          metalness: 0.1,
        });
      }
    });
    sceneBuste.add(busteClone);

    busteBaseY = gltf.scene.position.y;
  },
  (xhr) => console.log(`Chargement: ${(xhr.loaded / xhr.total * 100).toFixed(0)}%`),
  (error) => console.error('Erreur de chargement:', error)
);

// ─── SCENE ŒUVRES SUR CYLINDRE ──────────────────────────────────────────────────────

const textureLoader = new THREE.TextureLoader();
const sceneUI = new THREE.Scene();

const cylinderRadius = 8;
const workCount      = 4;
const PANEL_H        = 4.0;

const panelMeshes = [];

const works = [
  { src: oeuvre1Url },
  { src: oeuvre2Url },
  { src: oeuvre3Url },
  { src: oeuvre4Url },
].map((w, i) => ({
  ...w,
  angle: (i / workCount) * Math.PI * 2,
}));

// Scène des œuvres flottantes désactivée temporairement. `panelMeshes` reste un
// tableau vide, donc les boucles qui l'itèrent plus bas sont sans effet.
// works.forEach(({ src, angle }) => {
//   textureLoader.load(src, (tex) => {
//     tex.colorSpace = THREE.SRGBColorSpace;
// 
//     const panelW    = PANEL_H * (tex.image.width / tex.image.height);
//     const wavePhase = Math.random() * Math.PI * 2;
// 
//     const geo = new THREE.PlaneGeometry(panelW, PANEL_H, 40, 40);
//     const mat = new THREE.ShaderMaterial({
//       uniforms: {
//         uTexture: { value: tex },
//         uTime:    { value: 0.0 },
//         uOpacity: { value: 0.0 },
//         uPhase:   { value: wavePhase },
//       },
//       vertexShader: `
//         uniform float uTime;
//         uniform float uPhase;
//         varying vec2 vUv;
//         void main() {
//           vUv = uv;
//           vec3 pos = position;
//           float wave =
//             sin(pos.x * 2.0 + uTime * 0.9 + uPhase) * 0.14
//             + sin(pos.y * 1.5 + uTime * 0.7 + uPhase * 1.2) * 0.09
//             + sin(pos.x * 1.0 + pos.y * 1.3 + uTime * 1.1 + uPhase * 0.8) * 0.05;
//           pos.z += wave;
//           gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
//         }
//       `,
//       fragmentShader: `
//         uniform sampler2D uTexture;
//         uniform float uTime;
//         uniform float uOpacity;
//         uniform float uPhase;
//         varying vec2 vUv;
//         void main() {
//           vec2 uv = vUv;
//           uv.x += sin(uv.y * 10.0 + uTime * 1.0 + uPhase) * 0.005;
//           uv.y += sin(uv.x * 8.0  + uTime * 0.8 + uPhase) * 0.004;
//           vec4 col = texture2D(uTexture, uv);
//           gl_FragColor = vec4(col.rgb, col.a * uOpacity);
//         }
//       `,
//       transparent: true,
//       depthTest:   true,
//       depthWrite:  true,
//       side:        THREE.DoubleSide,
//     });
// 
//     const panel = new THREE.Mesh(geo, mat);
//     panel.visible = false;
// 
//     const x = cylinderRadius * Math.cos(angle);
//     const z = cylinderRadius * Math.sin(angle);
//     panel.position.set(x, 1.2, z);
//     panel.rotation.y = Math.PI / 2 - angle;
// 
//     panelMeshes.push(panel);
//     scene.add(panel);
//   });
// });

// ─── NUAGE DE MOTS ────────────────────────────────────────────────────────────

const sceneWords = new THREE.Scene();

const GRAFFITI_COLORS = [
  '#D7261E',
  '#D96C1A',
  '#F2D21B',
  '#6E7B3A',
  '#1F5AA6',
  '#6E3BB8',
  '#8A5A32',
  '#1CA7A6',
];

// Découpe les instructions lettre par lettre et attribue à chacune une couleur
// tirée de la palette des articles. Le keyframe flicker lit --stroke-color.
function colorizeInstructions() {
  document.querySelectorAll('.instructions h1, .instructions2 h1').forEach((heading) => {
    const text = heading.textContent;
    heading.textContent = '';

    for (const char of text) {
      const span = document.createElement('span');
      span.textContent = char;
      // Repris par le ::before qui peint le contour coloré derrière la lettre
      span.dataset.char = char;
      span.style.setProperty(
        '--stroke-color',
        GRAFFITI_COLORS[Math.floor(Math.random() * GRAFFITI_COLORS.length)]
      );
      heading.appendChild(span);
    }
  });
}

colorizeInstructions();

const GRAFFITI_FONT = getComputedStyle(document.documentElement).getPropertyValue('--graffiti-font').trim().replace(/['"]/g, '');

// Atlas lettre par lettre. Chaque caractère occupe sa propre cellule, isolée de
// ses voisines : c'est ce qui permet de les empiler au centre sans qu'elles se
// rognent mutuellement. Deux repères par lettre — sa cellule dans l'atlas (pour
// les UV) et son abscisse naturelle dans le mot (pour la position dépliée).
function makeWordLayout(text, { fontSize, font, skew }) {
  const probe = document.createElement('canvas').getContext('2d');
  probe.font = `${fontSize}px ${font}`;

  // Marge absorbant le cisaillement, pour qu'aucune lettre ne déborde de sa cellule.
  const margin = fontSize * 0.14;
  const pad    = (Math.abs(skew) * fontSize + margin) / (1 - Math.abs(skew));

  const canvasH   = Math.ceil(fontSize * 1.35 + pad * 2);
  const baselineY = pad + fontSize;

  const cells = [];
  let atlasX = 0, naturalX = 0;

  for (const ch of Array.from(text)) {
    const advance = probe.measureText(ch).width;
    const cellW   = advance + pad * 2;
    cells.push({
      ch, advance, cellW,
      atlasX,                                // origine de la cellule dans l'atlas
      drawX:  atlasX + pad,                  // où poser la lettre dans sa cellule
      center: naturalX + advance / 2,        // centre voulu une fois déplié
    });
    atlasX   += cellW;
    naturalX += advance;
  }

  return {
    cells, pad, baselineY, canvasH,
    canvasW:  Math.max(1, Math.ceil(atlasX)),
    naturalW: naturalX,
  };
}

// Épaisseur du cerne noir, en fraction du corps.
const WORD_OUTLINE = 0.07;

function makeWordTexture(layout, { color, fontSize, font, skew, grayscale = false, strikethrough = false }) {
  const cvs = document.createElement('canvas');
  cvs.width  = layout.canvasW;
  cvs.height = layout.canvasH;

  const ctx = cvs.getContext('2d');
  ctx.font        = `${fontSize}px ${font}`;
  ctx.lineJoin    = 'round';
  ctx.lineCap     = 'round';

  for (const cell of layout.cells) {
    ctx.save();
    // Cisaillement pris autour de la ligne de base, pour que la lettre pivote
    // sur ses pieds au lieu de dériver hors de sa cellule.
    ctx.transform(1, 0, skew, 1, -skew * layout.baselineY, 0);

    // Cerne noir posé en premier, donc le plus large : seule sa moitié
    // extérieure survit aux passes suivantes, ce qui donne un filet fin.
    ctx.strokeStyle = '#000000';
    ctx.lineWidth   = fontSize * WORD_OUTLINE;
    ctx.strokeText(cell.ch, cell.drawX, layout.baselineY);

    ctx.strokeStyle = 'rgba(255, 255, 255, 1)';
    ctx.lineWidth   = fontSize * 0.02;
    ctx.strokeText(cell.ch, cell.drawX, layout.baselineY);

    ctx.fillStyle = grayscale ? '#ffffff' : color;
    ctx.fillText(cell.ch, cell.drawX, layout.baselineY);

    if (strikethrough) {
      // Tracée sur la largeur utile de chaque lettre : les segments se rejoignent
      // une fois le mot déplié.
      const lineY = layout.baselineY - fontSize * 0.28;
      ctx.strokeStyle = color;
      ctx.lineWidth   = fontSize * 0.07;
      ctx.beginPath();
      ctx.moveTo(cell.drawX, lineY);
      ctx.lineTo(cell.drawX + cell.advance, lineY);
      ctx.stroke();
    }

    ctx.restore();
  }

  const tex = new THREE.CanvasTexture(cvs);
  tex.needsUpdate = true;
  return tex;
}

// Désordre appliqué aux lettres une fois pliées : inclinaison propre à chacune,
// et léger décentrage. Les deux s'effacent au dépliage.
const WORD_FOLD_OFFSET = 0.07;                         // décentrage, en fraction de worldH
const WORD_FOLD_BIG    = 1.5;                          // corps des lettres agrandies
const WORD_FOLD_SMALL  = 0.5;                          // corps des lettres réduites
const WORD_FOLD_MAX    = 4;                            // lettres superposées au plus

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Une paire de triangles par lettre. `position` porte la mise en page dépliée —
// c'est elle qui définit les bornes du raycast — et `aFold` le vecteur à retirer
// pour ramener chaque lettre au centre.
function createWordGeometry(layout, worldH) {
  const scale = worldH / layout.canvasH;
  const positions = [], uvs = [], folds = [], tilts = [], jitters = [],
        sizes = [], keeps = [], indices = [];

  const n = layout.cells.length;

  // Le signe plié ne montre qu'une poignée de lettres ; les autres n'apparaissent
  // qu'au dépliage. Tirage sans remise, pour un compte exact.
  const keepCount = Math.min(WORD_FOLD_MAX, n);
  const kept = new Set(shuffle(layout.cells.map((_, i) => i)).slice(0, keepCount));

  // Rotations restreintes aux quarts de tour. Les quatre valeurs sont distribuées
  // sans répétition tant qu'il reste des lettres visibles à servir.
  const quarters = shuffle([0, 1, 2, 3]);
  let served = 0;
  const angles = layout.cells.map((_, i) =>
    (kept.has(i) ? quarters[served++ % 4] : Math.floor(Math.random() * 4)) * (Math.PI / 2)
  );

  // Une moitié des lettres réduite, l'autre agrandie. Réparti puis mélangé,
  // pour que le compte soit exact et non seulement probable.
  const bigs = shuffle(layout.cells.map((_, i) =>
    i < Math.floor(n / 2) ? WORD_FOLD_BIG : WORD_FOLD_SMALL
  ));

  layout.cells.forEach((cell, k) => {
    const hw      = (cell.cellW * scale) / 2;
    const hh      = worldH / 2;
    const offsetX = (cell.center - layout.naturalW / 2) * scale;

    const u0 = cell.atlasX / layout.canvasW;
    const u1 = (cell.atlasX + cell.cellW) / layout.canvasW;

    const tilt = angles[k];
    const jx   = (Math.random() - 0.5) * 2 * WORD_FOLD_OFFSET * worldH;
    const jy   = (Math.random() - 0.5) * 2 * WORD_FOLD_OFFSET * worldH;

    positions.push(
      offsetX - hw, -hh, 0,
      offsetX + hw, -hh, 0,
      offsetX - hw,  hh, 0,
      offsetX + hw,  hh, 0,
    );
    uvs.push(u0, 0,  u1, 0,  u0, 1,  u1, 1);
    for (let i = 0; i < 4; i++) {
      folds.push(offsetX);
      tilts.push(tilt);
      jitters.push(jx, jy);
      sizes.push(bigs[k]);
      keeps.push(kept.has(k) ? 1 : 0);
    }

    const b = k * 4;
    indices.push(b, b + 1, b + 2, b + 2, b + 1, b + 3);
  });

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv',       new THREE.Float32BufferAttribute(uvs,       2));
  geo.setAttribute('aFold',    new THREE.Float32BufferAttribute(folds,     1));
  geo.setAttribute('aTilt',    new THREE.Float32BufferAttribute(tilts,     1));
  geo.setAttribute('aJitter',  new THREE.Float32BufferAttribute(jitters,   2));
  geo.setAttribute('aSize',    new THREE.Float32BufferAttribute(sizes,     1));
  geo.setAttribute('aKeep',    new THREE.Float32BufferAttribute(keeps,     1));
  geo.setIndex(indices);

  // La sphère englobante est calculée sur la pose dépliée ; une lettre pliée au
  // corps agrandi peut la déborder et se faire culler sur les mots courts.
  geo.computeBoundingSphere();
  geo.boundingSphere.radius *= Math.max(1, WORD_FOLD_BIG);
  return geo;
}

function createWordSprite(text) {
  const color    = GRAFFITI_COLORS[Math.floor(Math.random() * GRAFFITI_COLORS.length)];
  const font     = GRAFFITI_FONT;
  const fontSize = 100 + Math.floor(Math.random() * 28);
  const skew     = (Math.random() - 0.5) * 0.4;

  const layout      = makeWordLayout(text, { fontSize, font, skew });
  const textureBW   = makeWordTexture(layout, { color, fontSize, font, skew, grayscale: true });
  const textureHover = makeWordTexture(layout, { color, fontSize, font, skew, strikethrough: true });

  const worldH = 0.9 + Math.random() * 0.3;
  // Largeur du mot déplié, pas celle de l'atlas : les cellules sont paddées et
  // gonfleraient l'encombrement servant aux tests de chevauchement.
  const worldW = worldH * ((layout.naturalW + layout.pad * 2) / layout.canvasH);

  // Plan strictement plat : le mesh est billboardé vers la caméra chaque frame.
  const geo = createWordGeometry(layout, worldH);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uMap:       { value: textureBW },
      uOpacity:   { value: 1.0 },
      uUnfold:    { value: 0.0 },
    },
    vertexShader: `
      attribute float aFold;
      attribute float aTilt;
      attribute vec2  aJitter;
      attribute float aSize;
      attribute float aKeep;
      uniform float uUnfold;
      varying vec2 vUv;
      varying float vShow;
      void main() {
        vUv = uv;

        // Lettres écartées du signe : invisibles pliées, elles se révèlent au
        // rythme du dépliage.
        vShow = max(aKeep, uUnfold);

        // Coin ramené dans le repère de sa propre lettre : c'est autour de ce
        // centre que l'inclinaison du pliage s'applique.
        vec2 local = vec2(position.x - aFold, position.y);

        // uUnfold = 0 : lettres empilées, inclinées, décentrées et de deux
        // corps différents — un signe.
        // uUnfold = 1 : tout s'annule et le mot retrouve sa mise en page.
        float f = 1.0 - uUnfold;
        float a = aTilt * f;
        float c = cos(a), s = sin(a);
        vec2 p = mat2(c, s, -s, c) * (local * mix(1.0, aSize, f)) + aJitter * f;
        p.x += aFold * uUnfold;

        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, position.z, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D uMap;
      uniform float uOpacity;
      varying vec2 vUv;
      varying float vShow;
      void main() {
        vec4 col = texture2D(uMap, vUv);
        // vShow entre aussi dans le rejet : sans quoi une lettre encore
        // invisible écrirait quand même sa profondeur et masquerait le signe.
        if (col.a < 0.1 || vShow < 0.01) discard;
        gl_FragColor = vec4(col.rgb, col.a * uOpacity * vShow);
      }
    `,
    transparent: true,
    depthTest:   true,
    depthWrite:  true,
    side:        THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.userData.textureBW    = textureBW;
  mesh.userData.textureHover = textureHover;
  mesh.userData.worldW       = worldW;
  mesh.userData.worldH       = worldH;
  return mesh;
}

// Position cible quand un article est détaché (à droite du mur sphérique)
const DETACHED_POS = { x: 4, z: 0 };
const wordMeshes = [];

// Rayon du mur sphérique. Élargi par rapport à l'ancien cylindre : à écartement
// plus large, une sphère trop petite ne peut plus loger tous les articles.
const WORD_SPHERE_MIN = 2.4;
const WORD_SPHERE_MAX = 5.4;

// Marge de respiration entre deux articles voisins, en multiple de leur demi-taille.
const WORD_SPACING = 2.1;

// Étendue verticale du mur. Bornée par rayon à l'échantillonnage : une sphère
// étroite ne peut pas offrir la même hauteur qu'une large.
const WORD_HEIGHT = 8.5;

// Distance minimale entre deux articles, en unités monde. Sert de cible au
// choix du meilleur candidat : la recherche s'arrête dès qu'elle est atteinte.
const WORD_MIN_DISTANCE = 2.0;

// Tirages examinés pour chaque article avant de retenir le meilleur.
const WORD_PLACE_TRIES = 600;

// Quart arrière du mur (±45° autour du dos du buste) : zone interdite, aucun
// article ne s'y pose.
const WORD_BACK_THETA = -Math.PI / 2;
const WORD_BACK_HALF  = Math.PI / 4;

// Part maximale des articles tolérée d'un même côté. La caméra de départ est en
// +z et regarde le buste : sa droite est +x, sa gauche -x, donc le côté se lit
// sur le signe de cos(theta).
const WORD_SIDE_MAX_RATIO = 0.6;

function buildWordCloud() {
  const words = Array.from(
    document.querySelectorAll('.article p')
  ).map(p => p.textContent.trim()).filter(Boolean);

  const placed = [];

  // Quota par côté : ni la gauche ni la droite ne dépasse 60% du total.
  const sideMax   = Math.max(1, Math.ceil(words.length * WORD_SIDE_MAX_RATIO));
  const sideCount = { left: 0, right: 0 };

  words.forEach((word) => {
    const wordRadius = WORD_SPHERE_MIN + Math.random() * (WORD_SPHERE_MAX - WORD_SPHERE_MIN);
    const sprite = createWordSprite(word);
    const hw = sprite.userData.worldW / 2;
    const hh = sprite.userData.worldH / 2;

    // Écart angulaire le plus court entre deux azimuts.
    const dAngle = (a, b) => {
      const d = Math.abs(a - b) % (Math.PI * 2);
      return d > Math.PI ? Math.PI * 2 - d : d;
    };

    // Bande verticale réellement offerte par ce rayon, pôles exclus. Tirer dans
    // cette bande plutôt que rogner après coup : un écrêtage entassait sur la
    // borne tous les tirages qui la dépassaient.
    const band = Math.min(WORD_HEIGHT, wordRadius * 0.85 * 2);

    // On ne retient pas le premier emplacement acceptable mais celui, parmi tous
    // les tirages, qui s'éloigne le plus de ses voisins. Le premier venu laissait
    // passer des articles collés dès que la sphère se remplissait ; ce choix par
    // le meilleur candidat étale la répartition au lieu de la subir.
    let best = null;

    for (let attempt = 0; attempt < WORD_PLACE_TRIES; attempt++) {
      const theta = Math.random() * Math.PI * 2;
      const y     = (Math.random() - 0.5) * band;
      const phi   = Math.asin(y / wordRadius);

      // Devant : dégager le champ de vision sur le buste.
      if (dAngle(theta, Math.PI / 2) < Math.PI / 3 && y > -0.5 && y < 2.5) continue;

      // Derrière : zone interdite.
      if (dAngle(theta, WORD_BACK_THETA) < WORD_BACK_HALF) continue;

      // Côté saturé : rejeter pour tenir la répartition 40/60.
      const side = Math.cos(theta) >= 0 ? 'right' : 'left';
      if (sideCount[side] >= sideMax) continue;

      const ring = wordRadius * Math.cos(phi);
      const pos  = { x: ring * Math.cos(theta), y, z: ring * Math.sin(theta) };

      // Distance au plus proche voisin déjà posé, et chevauchement des
      // encombrements mesuré sur le parallèle — l'arc rétrécit vers les pôles.
      let nearest = Infinity, overlaps = false;
      for (const p of placed) {
        nearest = Math.min(nearest, Math.hypot(pos.x - p.pos.x, pos.y - p.pos.y, pos.z - p.pos.z));
        const arc = dAngle(theta, p.theta) * Math.min(ring, p.ring);
        if (arc < (hw + p.hw) * WORD_SPACING &&
            Math.abs(y - p.y) < (hh + p.hh) * WORD_SPACING) overlaps = true;
      }

      if (!best || nearest > best.nearest) best = { theta, phi, y, side, ring, pos, nearest };

      // Assez bon : inutile de continuer à chercher mieux.
      if (nearest >= WORD_MIN_DISTANCE && !overlaps) break;
    }

    // Filet : tous les tirages rejetés par les zones ou le quota de côté.
    if (!best) {
      const theta = Math.PI / 2 + Math.PI;
      const ring  = wordRadius;
      best = { theta, phi: 0, y: 0, side: Math.cos(theta) >= 0 ? 'right' : 'left',
               ring, pos: { x: ring * Math.cos(theta), y: 0, z: ring * Math.sin(theta) } };
    }

    const { theta, phi, y, side } = best;
    sideCount[side]++;

    // Le centre du mur sphérique est busteAnchor ; la position monde est
    // recalculée chaque frame dans la boucle, l'ancre pouvant arriver après.
    sprite.userData.word        = word;
    sprite.userData.baseY       = y;
    sprite.userData.floatSpeed  = 0.9;
    sprite.userData.floatAmpY   = 0.04 + Math.random() * 0.04;
    sprite.userData.floatOffset = Math.random() * Math.PI * 2;
    sprite.userData.sphere      = { r: wordRadius, theta, phi };
    sprite.userData.origPos     = { ...best.pos };

    placed.push({ theta, y, hw, hh, ring: best.ring, pos: best.pos });
    scene.add(sprite);
    wordMeshes.push(sprite);
  });
}

document.fonts.load(`100px ${GRAFFITI_FONT}`).then(() => buildWordCloud()).catch(() => buildWordCloud());

// ─── RESIZE ───────────────────────────────────────────────────────────────────

let wordsClickable = true;

window.addEventListener('click', () => {
  if (hoveredWord && wordsClickable) {
    window.dispatchEvent(new CustomEvent('word-click', { detail: { word: hoveredWord.userData.word } }));
  }
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight); // propage à toutes les passes
});

// ─── ANIMATE ──────────────────────────────────────────────────────────────────

const raycaster = new THREE.Raycaster();
let hoveredWord = null;
let detachedWord = null; // Mot actuellement détaché (reste détaché jusqu'au prochain hover)

// Non-hovered articles opacity
let nonHoveredOpacity = 1;
let targetNonHoveredOpacity = 1;

// Room opacity for smooth fade
let roomOpacity = 1;
let targetRoomOpacity = 1;

const startTime = performance.now();

function animate() {
  requestAnimationFrame(animate);

  // Retirer le flottement de la frame précédente avant tout calcul de caméra.
  // La rotation doit être défaite comme la translation : en vol libre le slerp
  // d'orientation réécrit tout le quaternion et masque l'oubli, mais en orbite
  // il n'en corrige qu'une fraction — le flottement s'y remultiplierait alors
  // sur lui-même d'une frame à l'autre, et l'accumulation écarterait la caméra
  // du buste avant que la magnétisation ne parvienne à la ramener.
  camera.position.sub(hoverOffset);
  hoverOffset.set(0, 0, 0);
  camera.quaternion.multiply(hoverSway.invert());
  hoverSway.identity();

  // ─── INERTIE DU DRAG ──────────────────────────────────────────────────────
  // Au relâchement, la rotation se prolonge en décélérant. Pendant le geste,
  // mousemove réalimente la vélocité à chaque frame ; s'immobiliser sans
  // relâcher la laisse retomber, donc aucun élan ne part d'un doigt à l'arrêt.
  if (cameraControl.isMouseDown) {
    cameraControl.dragVelX *= cameraControl.dragHoldDamping;
    cameraControl.dragVelY *= cameraControl.dragHoldDamping;
  } else if (Math.abs(cameraControl.dragVelX) > 0.02 || Math.abs(cameraControl.dragVelY) > 0.02) {
    applyDragDelta(cameraControl.dragVelX, cameraControl.dragVelY);
    cameraControl.dragVelX *= cameraControl.dragInertiaDamping;
    cameraControl.dragVelY *= cameraControl.dragInertiaDamping;
  } else {
    cameraControl.dragVelX = 0;
    cameraControl.dragVelY = 0;
  }

  // ─── ZOOM AVEC SMOOTHING ─────────────────────────────────────────────────
  const currentDirection = new THREE.Vector3();
  camera.getWorldDirection(currentDirection);

  // Interpoler la vélocité de zoom vers la cible avec easing
  cameraControl.zoomVelocity += (cameraControl.targetZoomVelocity - cameraControl.zoomVelocity) * cameraControl.zoomAcceleration;

  // Amortissement (damping) pour freiner progressivement
  cameraControl.zoomVelocity *= cameraControl.zoomDamping;

  // Ralentir le scroll EN S'APPROCHANT du buste (pas en s'éloignant)
  const distanceToBust = camera.position.distanceTo(busteAnchor);

  // Composante radiale de l'axe de visée : -1 quand la caméra regarde le buste,
  // +1 quand elle lui tourne le dos, 0 de profil. Le scroll déplace la caméra le
  // long de cet axe, donc le signe de zoomVelocity seul ne dit PAS si l'on
  // s'approche : dos tourné, un zoom in éloigne.
  const outward = camera.position.clone().sub(busteAnchor);
  const outwardLen = outward.length();
  const radialFactor = outwardLen > 1e-4 ? currentDirection.dot(outward.divideScalar(outwardLen)) : 0;

  // Vitesse d'éloignement réelle : > 0 on s'éloigne, < 0 on s'approche
  const radialSpeed = cameraControl.zoomVelocity * radialFactor;

  // Ralentissement progressif seulement quand on s'approche
  const ZOOM_BASE_SPEED = 1; // vitesse de croisière, loin du buste
  let speedMultiplier = ZOOM_BASE_SPEED;

  // Buste escamoté par la touche H : le ralentissement est suspendu, il n'a plus
  // d'objet à annoncer. La caméra garde sa vitesse de croisière jusqu'à l'origine.
  if (!busteHidden && radialSpeed < -0.001) {
    // On s'approche: appliquer le ralentissement en fonction de la distance
    const slowdownStart = orbitSphereRadius * 5;
    const slowdownEnd = orbitSphereRadius * 1;

    if (distanceToBust < slowdownStart) {
      // Facteur de 1.0 (vitesse de croisière) à 0.25 (75% de réduction).
      // Appliqué SUR la vitesse de base : la rampe reste continue au seuil.
      const t = Math.max(0, Math.min(1, (distanceToBust - slowdownEnd) / (slowdownStart - slowdownEnd)));
      speedMultiplier = ZOOM_BASE_SPEED * (0.25 + 0.75 * t);
    }
  }
  // Si on s'éloigne, pas de ralentissement

  // Réduire la vélocité cible progressivement si pas d'input
  cameraControl.targetZoomVelocity *= 0.95;

  // ─── ORBITATION : MACHINE À ÉTATS ─────────────────────────────────────────
  // Un seul mode actif à la fois : 'free', 'buste' ou 'room'.
  // Les deux orbites sont centrées sur busteAnchor et cadrent le buste ; celle
  // du buste a un rayon libre, celle de la salle est bornée par le mur.
  const cc = cameraControl;
  const bustPos = busteAnchor;
  const distToBust = camera.position.distanceTo(bustPos);
  const deltaTime = 1 / 60; // Approximation 60fps

  // Sens du déplacement radial. On le mesure sur la distance au buste plutôt
  // que sur le signe de zoomVelocity : le zoom suit l'axe de visée, qui ne
  // pointe pas forcément vers le buste. Le sens n'est mis à jour qu'au-delà
  // d'un seuil, pour rester connu quand la caméra s'immobilise.
  const radialDelta = cc.prevDistToBust === null ? 0 : distToBust - cc.prevDistToBust;
  cc.prevDistToBust = distToBust;
  if (Math.abs(radialDelta) > 0.002) cc.radialDir = Math.sign(radialDelta);

  cc.releaseCooldown = Math.max(0, cc.releaseCooldown - deltaTime);
  cc.radiusLock = Math.max(0, cc.radiusLock - deltaTime);

  // ─── RETOUR À LA POSE DE DÉPART (touche F) ───────────────────────────
  // Prioritaire sur tout le reste : ni capture, ni zoom, ni orientation tant
  // que la caméra n'est pas revenue à son point de départ.
  if (cc.recentering) {
    camera.position.lerp(cameraHome.position, 0.08);
    camera.quaternion.slerp(cameraHome.quaternion, 0.08);

    if (camera.position.distanceTo(cameraHome.position) < 0.01) {
      camera.position.copy(cameraHome.position);
      camera.quaternion.copy(cameraHome.quaternion);
      cc.recentering = false;
      cc.releaseCooldown = 0.6;
      seedFreeFromCamera();
    }
  }

  // ─── CAPTURE ──────────────────────────────────────────────────────────────
  // Buste : magnétisation différée, il faut s'attarder près de la tête.
  // Mur sphérique : pas de délai. C'est une paroi, la toucher en s'éloignant
  // engage le mode immédiatement, sinon la caméra la franchit pendant le délai
  // et le recentrage démarre trop loin.
  // Pendant l'éjection, aucune capture : la caméra traverse forcément la zone du
  // buste en la quittant, et l'y reprendre irait contre le geste de l'utilisateur.
  if (cc.ejecting) {
    cc.timeNearBuste = 0;
  } else if (cc.mode === 'free' && !cc.recentering) {
    const busteCapture = orbitSphereRadius * 1.25;
    const roomShellInner = ROOM_ORBIT_MIN;
    const roomShellOuter = ROOM_ORBIT_MAX;

    // Buste escamoté : sa sphère cesse d'exister pour la navigation
    const inBusteZone = !busteHidden && distToBust < busteCapture;
    const inRoomZone = distToBust >= roomShellInner && distToBust <= roomShellOuter;

    // Réarmement : la caméra doit avoir quitté toutes les zones depuis la
    // dernière sortie d'orbite avant de pouvoir être capturée à nouveau
    if (!inBusteZone && !inRoomZone) cc.captureArmed = true;

    // La seule présence dans la sphère suffit : le compteur se remplit quelle
    // que soit l'orientation de la caméra et le sens de son déplacement. Exiger
    // en plus de se rapprocher (radialDir < 0) rendait la zone aveugle à une
    // caméra immobile ou glissant tangentiellement, alors que la proximité,
    // elle, est bien omnidirectionnelle.
    // Pas de risque de reprise en sortant : c'est captureArmed qui l'empêche,
    // en exigeant d'avoir quitté la zone depuis la dernière sortie d'orbite.
    // Le mur, lui, garde sa condition de sens (voir plus bas) : sans elle il
    // happerait la caméra qui le traverse pour rejoindre le buste.
    // Plafonné à magnetizeDelay : sans borne, un long séjour dans la zone met le
    // compteur en réserve, et la capture se déclenche alors dès que captureArmed
    // se lève — y compris à l'instant où la caméra en sort.
    if (inBusteZone) {
      cc.timeNearBuste = Math.min(cc.magnetizeDelay, cc.timeNearBuste + deltaTime);
    } else {
      cc.timeNearBuste = Math.max(0, cc.timeNearBuste - deltaTime);
    }

    // Rattrapage : la caméra a franchi la zone de capture sans être aimantée
    // (capture désarmée, ou zoom assez rapide pour épuiser le délai avant que
    // la magnétisation n'aboutisse) et se retrouve collée au buste. On l'accroche
    // d'office et l'attraction la fait glisser vers l'extérieur de la sphère.
    // L'orientation n'est pas touchée ici : c'est un déplacement purement radial.
    const tooClose = !busteHidden && distToBust < BUSTE_ORBIT_MIN;

    if ((cc.captureArmed && cc.releaseCooldown <= 0) || tooClose) {
      if (tooClose || cc.timeNearBuste >= cc.magnetizeDelay) {
        cc.mode = 'buste';
        cc.orbitBlend = 0;
        seedOrbitFromPosition(bustPos);
        // Rayon d'entrée unique, quel que soit le chemin : magnétisation normale
        // et rattrapage déposent la caméra à la même distance du buste.
        orbitSphereRadius = BUSTE_ORBIT_ENTRY;
        // Rayon figé le temps que la vue d'ensemble s'installe
        cc.radiusLock = 0.3;
        cc.zoomVelocity = 0;
        cc.targetZoomVelocity = 0;
        // L'inertie du drag vient d'être semée à zéro par seedOrbitFromPosition,
        // mais dragVel continuerait de repousser targetOrbitYaw/Pitch pendant
        // l'accrochage : la caméra dériverait latéralement sur la sphère au lieu
        // de se contenter de la correction d'orientation.
        cc.dragVelX = 0;
        cc.dragVelY = 0;
      } else if (inRoomZone && cc.radialDir > 0) {
        // Contact avec la face interne en s'éloignant : accrochage immédiat.
        cc.mode = 'room';
        cc.orbitBlend = 0;
        // Rayon = distance courante, mais jamais sous la marge d'accrochage :
        // la caméra glisse doucement vers l'extérieur du mur au lieu de rester
        // collée à sa face interne.
        roomOrbitRadius = Math.min(
          ROOM_ORBIT_MAX,
          Math.max(distToBust, ROOM_ORBIT_MIN + ROOM_ORBIT_ENTRY_MARGIN)
        );
        // Purger l'élan du scroll qui a amené la caméra ici : sinon il continue
        // de pousser le rayon vers la face externe pendant l'accrochage.
        cc.zoomVelocity = 0;
        cc.targetZoomVelocity = 0;
        cc.dragVelX = 0;
        cc.dragVelY = 0;
        seedOrbitFromPosition(bustPos);
      }
    }
  }

  // ─── ZOOM : rayon en orbite, translation en vol libre ─────────────────────
  // Le rayon suit la vitesse RADIALE, pas zoomVelocity brut : sinon, capturée
  // en tournant le dos au buste, la caméra voit son rayon diminuer alors qu'elle
  // s'éloigne réellement — et le mur la relâchait aussitôt par sa face interne.
  const radiusDelta = radialSpeed * 0.5;

  if (cc.mode === 'buste' && cc.radiusLock > 0) {
    // Fenêtre de grâce après l'accrochage : le rayon reste sur BUSTE_ORBIT_ENTRY
    // et le zoom est neutralisé à chaque frame, pour que l'élan de scroll qui a
    // amené la caméra ici ne l'emporte pas aussitôt sur la magnétisation.
    orbitSphereRadius = BUSTE_ORBIT_ENTRY;
    cc.zoomVelocity = 0;
    cc.targetZoomVelocity = 0;
  } else if (cc.mode === 'buste') {
    orbitSphereRadius += radiusDelta;
    if (orbitSphereRadius > BUSTE_ORBIT_MAX) {
      // Dézoom au-delà du max : porte de sortie vers le vol libre, suivie d'une
      // éjection qui traverse la bande morte jusqu'au mur sphérique.
      orbitSphereRadius = BUSTE_ORBIT_MAX;
      releaseToFree(0.8);
      cc.ejecting = true;
      cc.ejectBlend = 0;
      cc.zoomVelocity = 0;
      cc.targetZoomVelocity = 0;
    } else if (orbitSphereRadius < BUSTE_ORBIT_MIN) {
      // Butée élastique. Le rayon de repos reste bloqué à BUSTE_ORBIT_MIN ;
      // la course excédentaire enfonce seulement le décalage de rebond, avec
      // une résistance qui croît avec l'enfoncement. Continuer à scroller ne
      // fait donc qu'asymptoter vers BUSTE_ORBIT_MIN - BUSTE_ORBIT_OVERSHOOT,
      // et dès que le scroll cesse le ressort ramène la caméra à la butée.
      const excess = BUSTE_ORBIT_MIN - orbitSphereRadius;
      orbitSphereRadius = BUSTE_ORBIT_MIN;

      const remaining = Math.max(0, (BUSTE_ORBIT_OVERSHOOT + cc.radiusBounce) / BUSTE_ORBIT_OVERSHOOT);
      cc.radiusBounce = Math.max(-BUSTE_ORBIT_OVERSHOOT, cc.radiusBounce - excess * remaining);
    }
  } else if (cc.mode === 'room') {
    roomOrbitRadius += radiusDelta;

    if (roomOrbitRadius < ROOM_ORBIT_MIN) {
      // Face interne franchie : seule porte de sortie du mur. On exige en plus
      // que la caméra aille effectivement vers le buste, et que l'orbite soit
      // installée (sinon le scroll qui l'a amenée ici la relâche aussitôt).
      roomOrbitRadius = ROOM_ORBIT_MIN;
      if (cc.orbitBlend > 0.5 && cc.radialDir < 0) releaseToFree(0.8);
    } else {
      // Face externe : mur dur, on ne la dépasse pas
      roomOrbitRadius = Math.min(ROOM_ORBIT_MAX, roomOrbitRadius);
    }
  }

  if (cc.mode === 'free' && !cc.recentering && Math.abs(cc.zoomVelocity) > 0.001) {
    camera.position.addScaledVector(currentDirection, cc.zoomVelocity * speedMultiplier);
  }

  // ─── ÉJECTION : MAGNÉTISATION INVERSÉE ────────────────────────────────────
  // Symétrique de l'attraction : même montée en courbe en S, même lerp de
  // position, mais vers l'extérieur. Elle dégage la caméra de la sortie d'orbite
  // et la dépose au milieu de la bande morte, sans la pousser jusqu'au mur : la
  // suite reste au choix de l'utilisateur. Purement radiale, l'orientation n'est
  // pas touchée.
  if (cc.ejecting) {
    const userTookOver = Math.abs(cc.targetZoomVelocity) > 0.05;

    const arrived = Math.abs(distToBust - BUSTE_EJECT_TARGET) < 0.05;

    if (cc.mode !== 'free' || cc.recentering || userTookOver || arrived) {
      cc.ejecting = false;
      cc.ejectBlend = 0;
    } else {
      cc.ejectBlend = Math.min(1, cc.ejectBlend + deltaTime * 0.65);
      const push = cc.ejectBlend * cc.ejectBlend * (3 - 2 * cc.ejectBlend);

      const outDir = camera.position.clone().sub(bustPos);
      const outLen = outDir.length();
      if (outLen > 1e-4) {
        const targetPos = bustPos
          .clone()
          .addScaledVector(outDir.divideScalar(outLen), BUSTE_EJECT_TARGET);
        camera.position.lerp(targetPos, 0.008 + 0.06 * push);
      }
    }
  }

  // ─── RETOUR DEPUIS LA BUTÉE DU ZOOM IN ────────────────────────────────────
  // Glissement exponentiel vers zéro, sans oscillation. Le ressort amorti
  // précédent produisait un va-et-vient ; ici la caméra se déroule vers la
  // butée en décélérant, comme le rattrapage qui lerpe sa position.
  cc.radiusBounce += -cc.radiusBounce * 0.055;
  if (Math.abs(cc.radiusBounce) < 0.0005) cc.radiusBounce = 0;

  // ─── POSITION EN ORBITE (attraction magnétique progressive) ───────────────
  const inOrbit = cc.mode !== 'free';
  let orbitPull = 0; // force d'attraction lissée, réutilisée par l'orientation

  if (inOrbit) {
    // Montée en ~1.6s au lieu de 0.4s
    cc.orbitBlend = Math.min(1, cc.orbitBlend + deltaTime * 0.65);

    // Courbe en S : l'aimant démarre imperceptiblement, puis s'affirme.
    // Sans elle, la traction est déjà nette à la première frame de capture.
    orbitPull = cc.orbitBlend * cc.orbitBlend * (3 - 2 * cc.orbitBlend);

    cc.orbitYaw += (cc.targetOrbitYaw - cc.orbitYaw) * cc.orbitSmoothing;
    cc.orbitPitch += (cc.targetOrbitPitch - cc.orbitPitch) * cc.orbitSmoothing;
    cc.orbitPitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, cc.orbitPitch));

    const radius = cc.mode === 'buste'
      ? orbitSphereRadius + cc.radiusBounce
      : roomOrbitRadius;
    const targetPos = bustPos
      .clone()
      .add(orbitDirection(cc.orbitYaw, cc.orbitPitch).multiplyScalar(radius));

    // Effleurement à l'accroche, prise ferme une fois installée
    camera.position.lerp(targetPos, 0.008 + 0.06 * orbitPull);
  }

  // ─── FACE EXTERNE DU MUR : ÉLOIGNEMENT MAXIMAL ────────────────────────────
  // Filet de sécurité tous modes confondus : si la capture room n'a pas eu lieu
  // (désarmée, ou traversée à contresens), le vol libre pourrait sinon franchir
  // le mur et s'échapper indéfiniment.
  const distFromAnchor = camera.position.distanceTo(bustPos);
  if (distFromAnchor > ROOM_ORBIT_MAX) {
    camera.position
      .sub(bustPos)
      .multiplyScalar(ROOM_ORBIT_MAX / distFromAnchor)
      .add(bustPos);
    cc.zoomVelocity = 0;
    cc.targetZoomVelocity = 0;
  }

  // ─── PROGRESSION DE LA MAGNÉTISATION BUSTE ────────────────────────────────
  // Une seule valeur pour tous les fondus liés au buste, afin qu'ils partent
  // ensemble. Elle couvre les deux temps de la magnétisation :
  //   0 → 0.5 : approche, le compteur timeNearBuste se remplit (avant capture)
  //   0.5 → 1 : orbite accrochée, l'attraction monte en puissance
  const magnetizeProgress = cc.mode === 'buste'
    ? 0.5 + 0.5 * orbitPull
    : 0.5 * Math.min(1, cc.timeNearBuste / cc.magnetizeDelay);

  cc.busteFocus += (magnetizeProgress - cc.busteFocus) * 0.08;

  // ─── RELAIS D'ÉCLAIRAGE EN MODE BUSTE ─────────────────────────────────────
  // Les sources de la salle s'éteignent, le rig du buste s'allume, au même
  // rythme : la somme reste constante, il n'y a ni creux ni surbrillance
  // pendant la bascule. Seule la cage de remplissage traverse la transition.
  const lightFade = 1 - cc.busteFocus;
  neonLight.intensity = NEON.intensity * lightFade;
  shadowSpot.intensity = SHADOW_SPOT_INTENSITY * lightFade;
  busteFillRig.position.copy(busteAnchor);
  // La cage ne s'éteint pas avec la salle — elle est centrée sur le buste et sa
  // portée dure (6.5) n'atteint aucune paroi — mais elle se rétracte et se
  // déséquilibre à mesure que le mode buste s'installe, pour laisser le rig
  // sculpter au lieu de noyer le visage sous un remplissage uniforme.
  for (const light of busteFillLights) {
    const w = 1 - cc.busteFocus * (1 - light.userData.busteWeight);
    light.intensity = BUSTE_FILL.intensity * w *
      (1 - cc.busteFocus * (1 - BUSTE_FILL_BUSTE_RATIO));
  }
  scene.environmentIntensity = lightFade;

  // Le rig suit l'azimut de la caméra, sinon orbiter finirait par présenter la
  // tête de son côté non éclairé. Seul le lacet est repris : reprendre aussi le
  // tangage ferait basculer la lumière sous le menton en vue plongeante.
  busteRig.position.copy(busteAnchor);
  busteRig.rotation.y = Math.atan2(
    camera.position.x - busteAnchor.x,
    camera.position.z - busteAnchor.z
  );

  for (const rig of busteRigLights) {
    rig.light.intensity = rig.base * cc.busteFocus;
  }

  // Le rebond est coupé net dès l'entrée en mode buste : environmentIntensity
  // seul laissait un résidu. Piloté par le mode plutôt que par un seuil sur le
  // fondu, pour que la bascule ait lieu une fois par transition — elle déclenche
  // une recompilation de shader, un seuil la ferait osciller.
  if (cc.mode === 'buste') {
    if (scene.environment !== null) scene.environment = null;
  } else if (scene.environment === null && indirectTarget) {
    scene.environment = indirectTarget.texture;
  }

  // ─── OPACITÉ DE LA ROOM (fade pendant l'orbite du buste) ──────────────────
  targetRoomOpacity = 1 - cc.busteFocus;
  roomOpacity += (targetRoomOpacity - roomOpacity) * 0.08;

  room.traverse((child) => {
    if (child.isMesh && child.material) {
      child.material.transparent = true;
      child.material.opacity = roomOpacity;
    }
  });

  // ─── ORIENTATION ──────────────────────────────────────────────────────────
  cc.freeYaw += (cc.targetFreeYaw - cc.freeYaw) * cc.rotationSmoothing;
  cc.freePitch += (cc.targetFreePitch - cc.freePitch) * cc.rotationSmoothing;

  let lookTarget;
  if (inOrbit) {
    // Les deux orbites cadrent le buste. Le mur sphérique visait auparavant
    // roomCenter, ce qui décentrait la tête à l'arrivée dans le mode.
    lookTarget = bustPos;
  } else {
    const cosPitch = Math.cos(cc.freePitch);
    lookTarget = camera.position.clone().add(
      new THREE.Vector3(
        Math.sin(cc.freeYaw) * cosPitch,
        Math.sin(cc.freePitch),
        Math.cos(cc.freeYaw) * cosPitch
      )
    );
  }

  // Matrix4.lookAt renvoie directement la matrice d'orientation de l'objet
  // (et non une view matrix) : aucune inversion à appliquer ici.
  const lookMatrix = new THREE.Matrix4().lookAt(camera.position, lookTarget, camera.up);
  const lookQuat = new THREE.Quaternion().setFromRotationMatrix(lookMatrix);

  // Vol libre : suivi immédiat (freeYaw/freePitch sont déjà lissés).
  // Orbite : slerp pour rendre le recentrage vers l'ancre progressif.
  // Pendant le retour F, l'orientation est pilotée plus haut.
  if (!cc.recentering) {
    // Le recentrage du regard suit la même montée que l'attraction : la caméra
    // ne pivote pas vers le buste plus vite qu'elle n'est attirée vers lui.
    camera.quaternion.slerp(lookQuat, inOrbit ? 0.015 + 0.075 * orbitPull : 1);
  }

  // ─── FLOTTEMENT D'INACTIVITÉ (vol libre uniquement) ───────────────────────
  // Le dosage passe par hoverBlend pour que l'effet s'éteigne progressivement
  // à l'accroche d'une orbite, ou pendant le retour à la pose de départ.
  const hoverTarget = cc.mode === 'free' && !cc.recentering ? 1 : 0;
  // Extinction bien plus rapide que l'allumage : le tangage/roulis du flottement
  // se superposerait sinon pendant une seconde à la correction d'orientation de
  // la magnétisation, et se lit alors comme un mouvement parasite.
  cc.hoverBlend += (hoverTarget - cc.hoverBlend) * (hoverTarget > cc.hoverBlend ? 0.04 : 0.12);

  if (cc.hoverBlend > 0.001) {
    const hoverT = performance.now() / 1000;

    // Amplitude proportionnelle à la distance au buste : le flottement se lit
    // pareil de près comme de loin
    // Proportionnelle à la distance pour se lire pareil de près, mais plafonnée :
    // sans borne, à 60 unités du buste le décalage atteint 1.2 unité, et son
    // retrait à l'accrochage du mur produit une secousse latérale bien visible.
    const hoverAmp = Math.min(Math.max(0.5, distToBust), 10) * 0.02 * cc.hoverBlend;

    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);

    // Fréquences volontairement non harmoniques : la dérive ne se répète pas
    hoverOffset
      .copy(right)
      .multiplyScalar(Math.sin(hoverT * 0.47) * hoverAmp)
      .addScaledVector(up, Math.sin(hoverT * 0.31 + 1.7) * hoverAmp * 0.7);

    camera.position.add(hoverOffset);

    // C'est la rotation qui rend le bobbing perceptible : la translation seule
    // ne produit qu'une parallaxe négligeable.
    // Mémorisé pour être retiré au début de la frame suivante, comme hoverOffset.
    hoverSway.setFromEuler(
      new THREE.Euler(
        Math.sin(hoverT * 0.37 + 0.8) * 0.02 * cc.hoverBlend, // tangage
        Math.sin(hoverT * 0.23) * 0.06 * cc.hoverBlend,       // lacet
        Math.sin(hoverT * 0.29 + 2.4) * 0.03 * cc.hoverBlend, // roulis
        'XYZ'
      )
    );
    camera.quaternion.multiply(hoverSway);
  }

  const t = (performance.now() - startTime) / 1000;

  // Les shaders n'existent qu'après leur première compilation, qui a lieu au
  // premier rendu du mesh : les réglages sont donc poussés ici et non au
  // chargement. Six shaders, six affectations chacun — le coût est nul.
  if (DEFORM.enabled && deformHeight > 0) {
    deformAmount += ((deformHeld ? 1 : 0) - deformAmount) * DEFORM.ease;
    // Accrochage aux bornes : une exponentielle n'atteint jamais sa cible, le
    // buste resterait indéfiniment à un cheveu de sa forme d'origine.
    if (deformAmount < 1e-4) deformAmount = 0;
    else if (deformAmount > 1 - 1e-4) deformAmount = 1;

    for (let i = 0; i < deformShaders.length; i++) {
      deformShaders[i].uniforms.uTime.value   = t;
      deformShaders[i].uniforms.uAmount.value = deformAmount;
      pushDeformSettings(deformShaders[i], deformHeight);
    }
  }

  // Smooth non-hovered opacity transition
  nonHoveredOpacity += (targetNonHoveredOpacity - nonHoveredOpacity) * 0.1;

  wordMeshes.forEach((obj) => {
    const { baseY, floatSpeed, floatAmpY, floatOffset, origPos } = obj.userData;
    if (baseY === undefined) return;

    // Position sur le mur sphérique, centré sur le buste.
    obj.position.x = busteAnchor.x + origPos.x;
    obj.position.z = busteAnchor.z + origPos.z;
    obj.position.y = busteAnchor.y + baseY + Math.sin(t * floatSpeed + floatOffset) * floatAmpY;

    // Billboard : toujours de face, quelle que soit la position de la caméra.
    obj.quaternion.copy(camera.quaternion);
  });

  let hit = null;
  if (wordsClickable) {
    raycaster.setFromCamera(mouse2D, camera);
    hit = raycaster.intersectObjects(wordMeshes)[0]?.object ?? null;
  }
  if (hit !== hoveredWord) {
    if (hoveredWord) {
      hoveredWord.material.uniforms.uMap.value = hoveredWord.userData.textureBW;
      targetNonHoveredOpacity = 1;
    }
    if (hit) {
      hit.material.uniforms.uMap.value = hit.userData.textureHover;
      targetNonHoveredOpacity = 0.2;
      detachedWord = hit; // Marquer le nouveau mot comme détaché
    }
    hoveredWord = hit;
  }

  // Update cursor based on hovered word or clickable element
  if (hoveredWord || isOverClickableElement) {
    cursorImg.src = cursor2Url;
  } else {
    cursorImg.src = cursorUrl;
  }

  // Make bust float slightly
  if (bustePrincipal) {
    bustePrincipal.position.y = busteBaseY + Math.sin(t * 0.5) * 0.1;
  }
  if (busteClone) {
    busteClone.position.y = busteBaseY + Math.sin(t * 0.5) * 0.1;
  }

  // Escamotage par la touche H. Appliqué ici plutôt que dans toggleBuste, pour
  // valoir aussi si la touche est pressée avant la fin du chargement du .glb.
  if (bustePrincipal) bustePrincipal.visible = !busteHidden;
  if (busteClone) busteClone.visible = !busteHidden;

  // Modifier l'opacité du buste lors du hover d'un article
  const targetBusteOpacity = hoveredWord ? 0 : 1.0;

  const applyBusteMaterial = (child) => {
    if (!child.isMesh || !child.material) return;
    child.material.opacity = targetBusteOpacity;
    child.material.transparent = true;
    child.material.depthWrite = !hoveredWord; // Désactiver depth write lors du hover
  };

  if (bustePrincipal) bustePrincipal.traverse(applyBusteMaterial);
  if (busteClone) busteClone.traverse(applyBusteMaterial);

  const camDist = camera.position.length();

  // Œuvres flottantes désactivées temporairement.
  // const panelFadeStart = 9;
  // const panelFadeEnd   = 13;
  // const panelOpacity   = Math.max(0, Math.min(1, (camDist - panelFadeStart) / (panelFadeEnd - panelFadeStart)));
  // panelMeshes.forEach(mesh => {
  //   mesh.visible = panelOpacity > 0;
  //   mesh.material.uniforms.uOpacity.value = panelOpacity;
  //   mesh.material.uniforms.uTime.value    = t;
  // });

  const wordFadeStart = 6.0;
  const wordFadeEnd   = 5.0;
  const distFade      = Math.max(0, Math.min(1, (camDist - wordFadeEnd) / (wordFadeStart - wordFadeEnd)));

  // Les articles s'effacent dès le début de la magnétisation, pas seulement
  // une fois la caméra assez près : le plus contraignant des deux l'emporte.
  // La touche H les escamote avec le buste, d'un coup et sans fondu.
  const wordOpacity = busteHidden ? 0 : Math.min(distFade, 1 - cameraControl.busteFocus);
  wordsClickable = !busteHidden && camDist > 5.5 && cameraControl.busteFocus < 0.15;
  wordMeshes.forEach(mesh => {
    mesh.visible = wordOpacity > 0;
    if (mesh.material?.uniforms) {
      let opacity = wordOpacity;
      if (hoveredWord && mesh !== hoveredWord) {
        opacity *= nonHoveredOpacity;
      }
      mesh.material.uniforms.uOpacity.value = opacity;

      // Dépliage : seul le mot survolé s'ouvre, les autres restent compressés.
      const target = mesh === hoveredWord ? 1 : 0;
      const cur    = mesh.userData.unfoldT ?? 0;
      mesh.userData.unfoldT = cur + (target - cur) * 0.12;
      mesh.material.uniforms.uUnfold.value = mesh.userData.unfoldT;
    }
  });

  // Tout (salle, buste, mots) vit dans `scene`, une seule passe suffit.
  // Le contour disparaît avec le buste : sinon OutlinePass le dessine quand même,
  // il ne teste pas `visible` sur les objets sélectionnés.
  outlinePass.selectedObjects = (bustePrincipal && !busteHidden) ? [bustePrincipal] : [];

  composer.render();
}

animate();