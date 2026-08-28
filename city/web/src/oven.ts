/**
 * The oven: bakes 3D models into isometric sprites.
 *
 * The good CC0 city kits are all 3D, and live 3D reads worse than 2D once there
 * are 150 buildings — always one hiding another. So each model is rendered ONCE,
 * from the same angle with the same light, and what is left are PNGs that Pixi
 * paints as sprites: game art with isometric legibility.
 *
 * Baked in light grey on purpose. The colour comes from Pixi's tint at paint
 * time, so one model serves every district instead of baking one image per
 * district per model.
 *
 * Runs in a headless Chrome; the script outside collects window.__horneado.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const LADO = 512; // room to zoom in without pixelating
const MODELOS: string[] = (window as any).__modelos ?? [];

const rnd = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
rnd.setSize(LADO, LADO);
rnd.setPixelRatio(1);
rnd.shadowMap.enabled = true;
rnd.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(rnd.domElement);

const esc = new THREE.Scene();

// Orthographic camera at the classic isometric angle: 45° of yaw and ~35.26° of
// pitch. That is what makes the sprites line up with the map's grid.
const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
const ang = Math.atan(Math.SQRT1_2); // 35,264°
cam.position.set(10, 10 * Math.tan(ang) * Math.SQRT2, 10);
cam.lookAt(0, 0, 0);

// One fixed light for all of them: if it changes between models, the city ends
// iluminados desde sitios distintos y se nota inmediatamente.
const sol = new THREE.DirectionalLight(0xfff3e0, 2.9);
sol.position.set(9, 14, 5);
sol.castShadow = true;
Object.assign(sol.shadow.camera, { left: -9, right: 9, top: 9, bottom: -9 });
sol.shadow.mapSize.set(1024, 1024);
esc.add(sol);
esc.add(new THREE.HemisphereLight(0xdfe8f5, 0x6b6f78, 1.35));
esc.add(new THREE.AmbientLight(0xffffff, 0.35));

const cargador = new GLTFLoader();
const cargar = (n: string) =>
  new Promise<THREE.Object3D>((ok, mal) =>
    cargador.load(`/glb/${n}.glb`, (g) => ok(g.scene), undefined, mal),
  );

async function cuece() {
  // The four numbers medidas.json carries, plus the image. Declared in full
  // because the collector and Pixi both read every one of them.
  const salida: {
    nombre: string;
    alto: number;
    ancho: number;
    png: string;
    ancla: number;
    pxUnidad: number;
  }[] = [];

  for (const nombre of MODELOS) {
    const obj = await cargar(nombre);

    // To light grey: the colour will come from Pixi's tint.
    obj.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.castShadow = true;
      m.receiveShadow = true;
      const mat = (m.material as THREE.MeshStandardMaterial).clone();
      const l = mat.color.getHSL({ h: 0, s: 0, l: 0 }).l;
      mat.color.setHSL(0, 0, 0.55 + l * 0.4); // conserva el contraste interno
      mat.roughness = 0.72;
      mat.metalness = 0.04;
      m.material = mat;
    });

    // Centred on its base and fitted in frame, with the same margin for
    // todos: si cada uno se encaja a su medida, en el mapa salen a escalas
    // distintas y el city parece de juguetes mezclados.
    const caja = new THREE.Box3().setFromObject(obj);
    const tam = caja.getSize(new THREE.Vector3());
    const centro = caja.getCenter(new THREE.Vector3());
    obj.position.set(-centro.x, -caja.min.y, -centro.z);

    const grupo = new THREE.Group();
    grupo.add(obj);
    esc.add(grupo);

    const radio = 3.4; // the same for every model
    cam.left = -radio;
    cam.right = radio;
    cam.bottom = -radio * 0.5;
    cam.top = radio * 1.5;
    cam.updateProjectionMatrix();
    // Looking at the ground, not at the centre of the building: that way the y=0
    // plane always lands on the same pixel and the sprite can be anchored to the
    // tile. Point the camera at the middle of each model and every sprite has its
    // base at a different height, so buildings float or sink on the map.
    cam.lookAt(0, 0, 0);

    rnd.render(esc, cam);
    salida.push({
      nombre,
      alto: +tam.y.toFixed(3),
      ancho: +Math.max(tam.x, tam.z).toFixed(3),
      png: rnd.domElement.toDataURL('image/png').split(',')[1],
      // Where the ground sits in the image, and how many pixels one model unit
      // measures: with these two, Pixi places and scales without guessing.
      ancla: +(cam.top / (cam.top - cam.bottom)).toFixed(4),
      pxUnidad: +(LADO / (cam.right - cam.left)).toFixed(3),
    });
    esc.remove(grupo);
  }

  (window as any).__horneado = salida;
  document.title = `baked ${salida.length}`;
}
cuece();
