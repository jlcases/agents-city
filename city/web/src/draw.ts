/**
 * Drawing the city.
 *
 * Three rules hold this together as a city rather than an isometric bar chart:
 *   1. Three tones per volume — light roof, mid left face, dark right. Without
 *      that, a single-colour cube is a smudge.
 *   2. A shadow on the ground. It is what sets the house down; without it the
 *      house floats.
 *   3. Lit windows where there is activity. A city with no lights is dead.
 *
 * The fallback path is all Graphics — no atlas, no image editor — so changing
 * how a house looks is changing ten lines.
 */
import { Container, Graphics, Sprite, Text, TextStyle, Texture } from 'pixi.js';

export const TW = 62,
  TH = 31; // the isometric tile
export const PISO = 9;
/**
 * Distance between plots, in tiles. Above one so the houses have air around
 * them: at exactly one tile a district reads as a single mass, and the point of
 * drawing parcels instead of repos is that you can tell them apart.
 *
 * Exported because three things have to agree on it — the tiles, the fence, and
 * where the houses stand. They used to each carry their own 1.3.
 */
export const PASO = 1.95;

export const iso = (cx: number, cy: number) => ({
  x: ((cx - cy) * TW) / 2,
  y: ((cx + cy) * TH) / 2,
});

/** Lighten or darken a whole colour. All three faces come from here. */
export function tono(c: number, k: number): number {
  const r = (c >> 16) & 255,
    g = (c >> 8) & 255,
    b = c & 255;
  const f = (v: number) =>
    Math.max(0, Math.min(255, Math.round(k > 0 ? v + (255 - v) * k : v * (1 + k))));
  return (f(r) << 16) | (f(g) << 8) | f(b);
}

export interface DatosCasa {
  pisos: number;
  andamios: number;
  andamio_viejo: number;
  grieta: number;
  actividad30: number;
  unidad: string;
  /** The agent's kind, when the Hall has told the map: it picks the family. */
  clase?: string;
}

/* ── Baked sprites ──────────────────────────────────────────────────────────
 * The buildings are isometric PNGs baked from Kenney's 3D models (CC0) under one
 * light and one angle. They were baked in light grey so the colour comes from
 * each district's tint: one model serves every district instead of baking the
 * same building once per colour.
 */
export interface Medida {
  alto: number;
  ancho: number;
  ancla: number;
  pxUnidad: number;
}
let TEX: Record<string, Texture> = {};
let MED: Record<string, Medida> = {};
let ORDENADOS: string[] = []; // commercial towers, shortest first: the code family
let BAJOS: string[] = []; // low-detail blocks: the knowledge/coordinator family

export async function cargaSprites(): Promise<boolean> {
  try {
    MED = await (await fetch('/sprites/medidas.json')).json();
    // Two building families from the same baked kit. The commercial towers are
    // what a code agent's parcel wears; the low-detail blocks — lower, wider,
    // reading as archive and civic rather than office — dress the agents whose
    // work is not pull requests. The kit had both baked all along; the map
    // only ever used one.
    ORDENADOS = Object.keys(MED)
      .filter((k) => k.startsWith('building'))
      .sort((a, b) => MED[a].alto - MED[b].alto);
    BAJOS = Object.keys(MED)
      .filter((k) => k.startsWith('low-detail-building'))
      .sort((a, b) => MED[a].alto - MED[b].alto);
    // A bare Image instead of Pixi's asset manager: with Assets.load the load
    // hung without throwing, and a blank page with no exception is the hardest
    // thing there is to diagnose.
    await Promise.all(
      [...ORDENADOS, ...BAJOS].map(async (k) => {
        const img = new Image();
        img.src = `/sprites/${k}.png`;
        await img.decode();
        TEX[k] = Texture.from(img);
      }),
    );
    return Object.keys(TEX).length > 0;
  } catch {
    // With no sprites the city is drawn with polygons: worse, but drawn.
    return false;
  }
}

/**
 * How tall a house should look, in tiles, for the capital it holds.
 *
 * Continuous on purpose. The first version picked one of four baked models by
 * band, which meant a house showed one or two heights across a whole replay:
 * floors landed and nothing moved, and then a house jumped. Growth you cannot
 * see is the one thing this map cannot afford.
 *
 * Logarithmic because capital is: the difference between 1 and 8 landings is
 * worth more than the one between 900 and 907, and a linear scale would leave
 * every small house invisible next to the monolith of the oldest repo.
 */
export function alturaDe(pisos: number): number {
  // Capped, and not for looks: an uncapped log still reached seven tiles on the
  // oldest repo, and a building that tall covers the district behind it and its
  // own banner. A map you cannot read does not describe anything.
  return pisos <= 0 ? 0 : Math.min(ALTO_MAX, 0.55 + Math.log2(pisos + 1) * 0.36);
}
export const ALTO_MAX = 4.2;
/** One height unit, in pixels: what a tile-high building measures on screen. */
export const ALTO_TILE = TW * 0.92;

/**
 * Which baked building this parcel gets: the one closest to the height its
 * capital asks for, and stable for the parcel's name.
 *
 * By target height and not by band, so the stretch that follows is always small.
 * The band version had to squash or stretch a model by up to two and a half to
 * reach the right height, and a Kenney tower at 2.4× vertical does not read as a
 * building any more.
 *
 * Ties are broken by hashing the id, over the three nearest models, so two
 * parcels of the same size are not the same silhouette — and the same parcel is
 * always the same one, which matters more: a house that changed shape between
 * two loads would break the one thing a map has to do.
 */
function elModelo(id: string, pisos: number, clase?: string): string | null {
  // The family is the agent's kind, made visible: knowledge and coordinator
  // parcels wear the low blocks. An unknown kind — or a map that was never
  // told any — keeps today's towers.
  const familia =
    (clase === 'knowledge' || clase === 'coordinator') && BAJOS.length ? BAJOS : ORDENADOS;
  if (!familia.length) return null;
  const objetivo = alturaDe(pisos);
  const cerca = [...familia]
    .sort((a, b) => Math.abs(MED[a].alto - objetivo) - Math.abs(MED[b].alto - objetivo))
    .slice(0, 3);
  let n = 0;
  for (let j = 0; j < id.length; j++) n = (n * 31 + id.charCodeAt(j)) | 0;
  return cerca[Math.abs(n) % cerca.length];
}

/**
 * A drawn house. `sp`, `medida` and `escala` are only there on the sprite path,
 * and they are what lets the house be grown later without being rebuilt; the
 * polygon fallback has to be redrawn, and says so by leaving them out.
 */
export interface Casa {
  g: Container;
  alto: number;
  plantas: number;
  sp?: Sprite;
  medida?: Medida;
  escala?: number;
}

/**
 * The model a parcel should be wearing at this size, or null when it is already
 * wearing it.
 *
 * A building is not chosen once and kept: it is chosen for the height the parcel
 * asks for *now*. The first version picked it when the house appeared — with one
 * floor — and never revisited it, so a house grew until the stretch hit its limit
 * and then stopped, however much landed afterwards. On screen that is a city that
 * does not grow, punctuated by jumps whenever something else forced a redraw.
 */
export function reviste(c: Casa, id: string, pisos: number, clase?: string): boolean {
  if (!c.sp || !c.medida) return false;
  const f = factorDe(pisos, c.medida);
  // Only when the current model is being stretched or squashed out of shape.
  if (f > 0.82 && f < 1.22) return false;
  const nombre = elModelo(id, pisos, clase);
  if (!nombre || !TEX[nombre] || MED[nombre] === c.medida) return false;

  const m = MED[nombre];
  const altoAhora = c.medida.alto * (c.sp.scale.y / (c.escala ?? 1)); // in tiles
  c.sp.texture = TEX[nombre];
  c.sp.anchor.set(0.5, m.ancla);
  c.medida = m;
  c.escala = (TW / m.pxUnidad) * 0.92;
  // Keep the height it has RIGHT NOW: the silhouette changes, the size does not
  // jump. Whatever tween is running then carries it to the new target.
  c.sp.scale.set(c.escala, c.escala * Math.max(0.5, altoAhora / m.alto));
  return true;
}

/** Una casa: sombra, cuerpo a tres tonos, tejado con teja, ventanas y extras. */
export function casa(col: number, d: DatosCasa, id = ''): Casa {
  const modelo = elModelo(id, d.pisos, d.clase);
  if (modelo && TEX[modelo]) return casaSprite(col, d, modelo);
  return casaPoligonos(col, d);
}

/** With a sprite: the baked building, tinted with its district's colour. */
function casaSprite(col: number, d: DatosCasa, modelo: string): Casa {
  const g = new Container();
  const m = MED[modelo];
  const sp = new Sprite(TEX[modelo]);
  sp.anchor.set(0.5, m.ancla);
  const escala = (TW / m.pxUnidad) * 0.92;
  // The model gives the silhouette; the stretch gives the exact height. Both are
  // needed: without the stretch growth is invisible, and without the model every
  // building would be the same one squashed or stretched absurdly.
  const estirado = factorDe(d.pisos, m);
  sp.scale.set(escala, escala * estirado);
  sp.position.set(0, TH / 2);
  // Tint multiplies, so a dark colour switches the building off: it is lightened
  // first, so the district reads and the volume survives.
  sp.tint = tono(col, 0.34);
  const alto = m.alto * estirado * m.pxUnidad * escala;

  g.addChild(
    new Graphics()
      .ellipse(0, TH * 0.55, TW * 0.34, TH * 0.3)
      .fill({ color: 0x000000, alpha: 0.34 }),
  );
  g.addChild(sp);

  // A warm glow if the parcel moved this month: a city with lights reads as
  // alive, and without them it looks abandoned.
  if (d.actividad30 > 0) {
    const luz = new Graphics()
      .ellipse(0, TH / 2 - alto * 0.45, TW * 0.3, alto * 0.42)
      .fill({ color: 0xffd98a, alpha: Math.min(0.16, 0.03 + Math.log2(d.actividad30 + 1) * 0.02) });
    luz.blendMode = 'add';
    g.addChild(luz);
  }

  extras(g, col, d, alto, TW * 0.3);
  // `sp` and `m` come out so a house can be grown without being rebuilt: tearing
  // the sprite down every time a floor lands made the city blink.
  return { g, alto, plantas: Math.round(m.alto * estirado), sp, medida: m, escala };
}

function casaPoligonos(col: number, d: DatosCasa): Casa {
  const g = new Container();
  const plantas = Math.max(1, Math.min(24, Math.round(alturaDe(d.pisos) * 2.1)));
  const alto = plantas * PISO;
  const w = TW * 0.27,
    h = TH * 0.27;

  // Sombra: lo que hace que la casa se apoye en el suelo en vez de flotar.
  g.addChild(
    new Graphics()
      .ellipse(w * 0.35, TH * 0.52, w * 1.5, h * 1.5)
      .fill({ color: 0x000000, alpha: 0.28 }),
  );

  const cuerpo = new Graphics();
  // cara izquierda (media) y derecha (oscura)
  cuerpo
    .poly([0, TH / 2, -w, TH / 2 - h, -w, TH / 2 - h - alto, 0, TH / 2 - alto])
    .fill({ color: tono(col, -0.28) });
  cuerpo
    .poly([0, TH / 2, w, TH / 2 - h, w, TH / 2 - h - alto, 0, TH / 2 - alto])
    .fill({ color: tono(col, -0.52) });
  g.addChild(cuerpo);

  // Windows: one row per storey, lit according to the last month's activity.
  const encendidas = Math.min(plantas, Math.ceil(Math.log2(d.actividad30 + 1) / 1.6));
  const luz = new Graphics();
  for (let i = 0; i < plantas; i++) {
    const y = TH / 2 - h * 0.5 - i * PISO - PISO * 0.55;
    const on = i < encendidas;
    const cl = on ? 0xffd98a : tono(col, -0.72);
    luz.rect(-w * 0.62, y, w * 0.3, PISO * 0.34).fill({ color: cl, alpha: on ? 0.95 : 0.7 });
    luz
      .rect(w * 0.32, y + h * 0.5, w * 0.3, PISO * 0.34)
      .fill({ color: cl, alpha: on ? 0.8 : 0.55 });
  }
  g.addChild(luz);

  // A pitched roof, with two tile lines.
  const cum = TH / 2 - 2 * h - alto;
  const tejado = new Graphics()
    .poly([0, TH / 2 - alto, -w, TH / 2 - h - alto, 0, cum, w, TH / 2 - h - alto])
    .fill({ color: tono(col, 0.22) });
  tejado.moveTo(-w * 0.5, TH / 2 - h * 0.5 - alto).lineTo(0, cum + h * 0.5);
  tejado.moveTo(w * 0.5, TH / 2 - h * 0.5 - alto).lineTo(0, cum + h * 0.5);
  tejado.stroke({ color: tono(col, -0.35), width: 0.8, alpha: 0.5 });
  g.addChild(tejado);

  extras(g, col, d, alto, w);
  return { g, alto, plantas };
}

/** Dust at the foot of a house that just grew. Returns the motes to animate. */
export function polvo(g: Container): Graphics[] {
  const motas: Graphics[] = [];
  for (let i = 0; i < 4; i++) {
    const p = new Graphics().circle(0, 0, 1.6 + i * 0.5).fill({ color: 0xd9cdb4, alpha: 0.5 });
    p.position.set((i - 1.5) * 5, TH * 0.5);
    g.addChild(p);
    motas.push(p);
  }
  return motas;
}

/**
 * Grow a house that is already on the map, to the height its new capital asks
 * for. Returns false when it cannot (the polygon fallback, which has to be
 * redrawn) so the caller knows to rebuild instead.
 *
 * This exists because the replay used to destroy and recreate every house that
 * gained a floor, once per day. Same sprite, new object: the city flickered and
 * nothing appeared to grow.
 */
export function estira(c: Casa, pisos: number): boolean {
  if (!c.sp || !c.medida || !c.escala) return false;
  c.sp.scale.set(c.escala, c.escala * factorDe(pisos, c.medida));
  return true;
}

/** How much the baked model has to be stretched to stand at its proper height. */
export function factorDe(pisos: number, m: Medida): number {
  // Narrow on purpose: the model is chosen for its height, so this only trims.
  return Math.max(0.72, Math.min(1.5, alturaDe(pisos) / m.alto));
}

/**
 * What goes on top of a house, sprite or polygons alike. It lives apart because
 * it is the same in both cases, and because it is the part carrying the news:
 * the house says how much capital there is, this says what is happening to it.
 */
function extras(g: Container, col: number, d: DatosCasa, alto: number, w: number) {
  const h = TH * 0.26;
  const niveles = Math.max(1, Math.round(alto / PISO));

  // Scaffolding: an open position. Amber when it has been stuck for more than
  // two weeks. In the lab, always: that is a site open on purpose.
  if (d.andamios > 0 || d.unidad === 'lab') {
    const inm = d.andamio_viejo > 0 && d.unidad !== 'lab';
    const a = new Graphics();
    for (let i = 0; i <= niveles; i++)
      a.moveTo(-w - 3, TH / 2 - i * PISO).lineTo(w + 3, TH / 2 - h - i * PISO);
    a.moveTo(-w - 3, TH / 2).lineTo(-w - 3, TH / 2 - alto);
    a.moveTo(w + 3, TH / 2 - h).lineTo(w + 3, TH / 2 - h - alto);
    a.stroke({ color: inm ? 0xc79a4e : 0xcbb999, width: 0.9, alpha: inm ? 0.8 : 0.35 });
    g.addChild(a);
  }

  // A crane: a genuinely big site, five open positions or more.
  if (d.andamios >= 5) g.addChild(grua(alto + 26));

  // A crack: CI is red.
  if (d.grieta) {
    g.addChild(
      new Graphics()
        .moveTo(0, TH / 2 - 2)
        .lineTo(w * 0.4, TH / 2 - alto * 0.45)
        .lineTo(w * 0.15, TH / 2 - alto * 0.72)
        .stroke({ color: 0xe2604f, width: 1.3, alpha: 0.95 }),
    );
  }

  // Pallets: commits with no PR, waiting for somebody to lay them.
  if (d.pisos === 0 && d.actividad30 > 0) g.addChild(ladrillos(col));
}

function grua(altura: number) {
  const c = new Container();
  const met = 0xb9a37a;
  const g = new Graphics();
  g.moveTo(-2, TH / 2).lineTo(-2, TH / 2 - altura);
  g.moveTo(2, TH / 2).lineTo(2, TH / 2 - altura);
  for (let y = 0; y < altura; y += 7) g.moveTo(-2, TH / 2 - y).lineTo(2, TH / 2 - y - 7);
  g.moveTo(-16, TH / 2 - altura + 4).lineTo(26, TH / 2 - altura + 4); // pluma
  g.moveTo(18, TH / 2 - altura + 4).lineTo(18, TH / 2 - altura + 16); // cable
  g.stroke({ color: met, width: 1, alpha: 0.75 });
  c.addChild(g);
  c.addChild(new Graphics().rect(16, TH / 2 - altura + 16, 4, 3).fill({ color: met, alpha: 0.8 }));
  return c;
}

function ladrillos(col: number) {
  const g = new Graphics();
  for (let i = 0; i < 4; i++) {
    g.rect(-TW * 0.42 - (i % 2) * 5, TH * 0.5 + Math.floor(i / 2) * 3, 4, 2.4).fill({
      color: tono(col, -0.2),
      alpha: 0.75,
    });
  }
  return g;
}

/** A tree, so an empty plot reads as a plot and not as a hole. */
export function arbol() {
  const c = new Container();
  c.addChild(new Graphics().ellipse(0, TH * 0.5, 5, 2.2).fill({ color: 0x000000, alpha: 0.22 }));
  c.addChild(new Graphics().rect(-0.9, TH * 0.5 - 6, 1.8, 6).fill({ color: 0x5d4b34 }));
  c.addChild(
    new Graphics()
      .poly([0, TH * 0.5 - 19, -6, TH * 0.5 - 5, 6, TH * 0.5 - 5])
      .fill({ color: 0x3f6b4a })
      .poly([0, TH * 0.5 - 24, -4.5, TH * 0.5 - 12, 4.5, TH * 0.5 - 12])
      .fill({ color: 0x4a7d55 }),
  );
  return c;
}

/** The district floor: chequered isometric tiles, a fence and a banner. */
export function suelo(cols: number, filas: number, col: number, lab: boolean) {
  const g = new Container();

  // The ground, one plot per parcel, chequered so the grid reads.
  const piso = new Graphics();
  for (let x = -1; x < cols + 1; x++) {
    for (let y = -1; y < filas + 1; y++) {
      const p = iso(x * PASO, y * PASO);
      const claro = (x + y) % 2 === 0;
      piso
        .poly([p.x, p.y, p.x + TW / 2, p.y + TH / 2, p.x, p.y + TH, p.x - TW / 2, p.y + TH / 2])
        .fill({ color: col, alpha: claro ? 0.085 : 0.055 });
    }
  }
  g.addChild(piso);
  g.addChild(calles(cols, filas));
  g.addChild(farolas(cols, filas));

  // Perimeter fence: dashed in the lab, which is an open site on purpose.
  const k = PASO;
  const a = iso(-1.5 * k, -1.5 * k),
    b = iso((cols + 0.5) * k, -1.5 * k);
  const c = iso((cols + 0.5) * k, (filas + 0.5) * k),
    d = iso(-1.5 * k, (filas + 0.5) * k);
  g.addChild(
    new Graphics()
      .poly([a.x, a.y + TH / 2, b.x, b.y + TH / 2, c.x, c.y + TH / 2, d.x, d.y + TH / 2])
      .stroke({ color: col, width: 1.2, alpha: lab ? 0.55 : 0.35 }),
  );
  return g;
}

/**
 * Streets: one avenue down the side of the district and one road between every
 * row of plots.
 *
 * Taken from how software cities are laid out in the literature — EvoStreets
 * puts the hierarchy in the streets — but here they carry no data on purpose.
 * They are what turns a chequerboard into somewhere: without them the eye reads
 * a grid of objects, with them it reads blocks, and blocks are how anybody has
 * ever navigated a city.
 */
function calles(cols: number, filas: number) {
  const g = new Graphics();
  const ASFALTO = 0x1b2532,
    LINEA = 0xc8b48a;
  const ancho = 0.42; // half-width of a road, in tiles

  /** A band between two points of the plot grid, drawn as an isometric quad. */
  const banda = (x0: number, y0: number, x1: number, y1: number, w: number) => {
    const p = [iso(x0 - w, y0 - w), iso(x1 + w, y1 - w), iso(x1 + w, y1 + w), iso(x0 - w, y0 + w)];
    g.poly([
      p[0].x,
      p[0].y + TH / 2,
      p[1].x,
      p[1].y + TH / 2,
      p[2].x,
      p[2].y + TH / 2,
      p[3].x,
      p[3].y + TH / 2,
    ]);
  };

  // Roads between rows, and the avenue along the near edge.
  for (let f = 0; f < filas; f++) {
    const y = (f + 0.5) * PASO;
    banda(-0.9 * PASO, y, (cols - 0.1) * PASO, y, ancho);
  }
  banda(-0.95 * PASO, -0.9 * PASO, -0.95 * PASO, (filas - 0.1) * PASO, ancho);
  g.fill({ color: ASFALTO, alpha: 0.92 });

  // The dashes down the middle of each road. Short, faint: at the zoom where the
  // whole city fits they should read as texture, not as markings.
  for (let f = 0; f < filas; f++) {
    const y = (f + 0.5) * PASO;
    for (let x = -0.7; x < cols - 0.2; x += 0.5) {
      const a = iso(x * PASO, y),
        b = iso((x + 0.22) * PASO, y);
      g.moveTo(a.x, a.y + TH / 2).lineTo(b.x, b.y + TH / 2);
    }
  }
  g.stroke({ color: LINEA, width: 0.9, alpha: 0.3 });
  return g;
}

/**
 * Street lamps, and the pool of light under each one.
 *
 * The one thing that makes a night city read as inhabited rather than as a dark
 * diagram. They carry no data — they are not lit by activity, that is what the
 * windows are for — and there are few of them on purpose: a lamp on every plot
 * would flatten the map into an even glow and take the contrast away from the
 * houses that do have something to say.
 */
function farolas(cols: number, filas: number) {
  const c = new Container();
  const luz = new Graphics();
  const poste = new Graphics();
  for (let f = 0; f < filas; f++) {
    for (let x = -0.5; x < cols; x += 2) {
      const p = iso(x * PASO, (f + 0.5) * PASO);
      const bx = p.x,
        by = p.y + TH / 2;
      luz.ellipse(bx, by, TW * 0.42, TH * 0.42).fill({ color: 0xffd98a, alpha: 0.07 });
      luz.ellipse(bx, by, TW * 0.2, TH * 0.2).fill({ color: 0xffd98a, alpha: 0.06 });
      poste
        .moveTo(bx, by)
        .lineTo(bx, by - 15)
        .stroke({ color: 0x8d99a8, width: 0.9, alpha: 0.75 });
      poste.circle(bx, by - 16, 1.6).fill({ color: 0xffd98a, alpha: 0.95 });
    }
  }
  luz.blendMode = 'add';
  c.addChild(luz, poste);
  return c;
}

/**
 * The ground the whole city stands on, and the avenues between its blocks.
 *
 * Drawn once, under everything, across the full extent of the layout. Without it
 * the blocks float on nothing and the roads inside each one stop at its edge —
 * which is what made this read as eight rugs on a floor rather than as a place.
 */
export function plano(
  anchoCeldas: number,
  altoCeldas: number,
  bloques: { ox: number; oy: number; cols: number; filas: number }[],
) {
  const c = new Container();
  const suelo = new Graphics();
  const w = anchoCeldas + 1,
    h = altoCeldas + 1;

  // The base plane, one flat quad in isometric.
  const e = [
    iso(-2 * PASO, -2 * PASO),
    iso(w * PASO, -2 * PASO),
    iso(w * PASO, h * PASO),
    iso(-2 * PASO, h * PASO),
  ];
  suelo
    .poly([
      e[0].x,
      e[0].y + TH / 2,
      e[1].x,
      e[1].y + TH / 2,
      e[2].x,
      e[2].y + TH / 2,
      e[3].x,
      e[3].y + TH / 2,
    ])
    .fill({ color: 0x0b1119, alpha: 0.92 });

  // The avenues: the gaps the layout leaves between blocks, filled in as road.
  const banda = (x0: number, y0: number, x1: number, y1: number, ancho: number) => {
    const p = [
      iso(x0 - ancho, y0 - ancho),
      iso(x1 + ancho, y1 - ancho),
      iso(x1 + ancho, y1 + ancho),
      iso(x0 - ancho, y0 + ancho),
    ];
    suelo.poly([
      p[0].x,
      p[0].y + TH / 2,
      p[1].x,
      p[1].y + TH / 2,
      p[2].x,
      p[2].y + TH / 2,
      p[3].x,
      p[3].y + TH / 2,
    ]);
  };
  const vistas = new Set<string>();
  for (const b of bloques) {
    const yAv = (b.oy + b.filas + 0.5) * PASO; // behind the block
    const xAv = (b.ox + b.cols + 0.5) * PASO; // to its side
    if (!vistas.has('y' + yAv)) {
      vistas.add('y' + yAv);
      banda(-2 * PASO, yAv, w * PASO, yAv, 0.6);
    }
    if (!vistas.has('x' + xAv)) {
      vistas.add('x' + xAv);
      banda(xAv, -2 * PASO, xAv, h * PASO, 0.6);
    }
  }
  suelo.fill({ color: 0x1b2532, alpha: 0.9 });
  c.addChild(suelo);
  return c;
}

/** The district banner: a mast and cloth carrying the name. */
export function estandarte(nombre: string, dato: string, col: number) {
  const c = new Container();
  const g = new Graphics()
    .moveTo(0, 0)
    .lineTo(0, -46)
    .stroke({ color: 0x8d99a8, width: 1.2, alpha: 0.6 });
  c.addChild(g);
  const txt = new Text({
    text: nombre.toUpperCase(),
    style: new TextStyle({
      fontFamily: 'Chakra Petch, sans-serif',
      fontSize: 12,
      fontWeight: '700',
      letterSpacing: 1.6,
      fill: 0x131a24,
    }),
  });
  txt.position.set(9, -44);
  const tela = new Graphics()
    .poly([2, -47, txt.width + 20, -47, txt.width + 14, -37, txt.width + 20, -27, 2, -27])
    .fill({ color: col, alpha: 0.92 });
  c.addChild(tela, txt);
  const sub = new Text({
    text: dato,
    style: new TextStyle({ fontFamily: 'IBM Plex Mono, monospace', fontSize: 9, fill: 0x8d99a8 }),
  });
  sub.position.set(9, -23);
  c.addChild(sub);
  // The second line is only legible close up. Marked so the zoom can drop it,
  // the same way it drops the trade under a person: a label too small to read is
  // not information, it is noise on top of the map.
  (c as any).__sub = sub;
  return c;
}
