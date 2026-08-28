/**
 * Agents City.
 *
 * District = business unit. House = parcel, a slice of a repo serving that unit.
 * And the people: the architect draws the plan, the foremen answer for one
 * property of every house, and the workers — the agents — dig.
 *
 * Pixi for the canvas and HTML for the HUD: that way the text reads, selects and
 * is accessible, and the canvas does what it is good at.
 */
import { Application, Container, Graphics, Sprite, Text, TextStyle, Texture } from 'pixi.js';
import {
  TW,
  TH,
  PASO,
  iso,
  casa,
  arbol,
  suelo,
  plano,
  estandarte,
  cargaSprites,
  factorDe,
  polvo,
  alturaDe,
  reviste,
  tono,
} from './draw';
import type { Casa } from './draw';
import { obrero, perito, arquitecto, colorDe, ESCALA_GENTE } from './people';
import { ActivityActors } from './activity-actors';
import {
  ActivityEvent,
  MAP_ACTIVITY_PROTOCOL,
  MapConfigMessage,
  RoadInfo,
  isMapActivityMessage,
  isMapConfigMessage,
  isPresenceEvent,
  isSpeechEvent,
} from './activity';
import { CitySpeech } from './game-speech';
import { Ayuntamiento } from './ayuntamiento';
import { Presencia } from './presencia';
import { Puertas } from './puertas';

// Units and their colours come from the API, which reads them from the database.
// There is no hardcoded list of anybody's business here: every organisation has
// its own, and changing them should not require a deploy.
let COLOR: Record<string, number> = {};
let BARRIOS: { id: string; nom: string; cols: number; nota?: string }[] = [];
const COLOR_POR_DEFECTO = 0xc8b48a;
//: The canvas behind the city, per skin.
//:
//: The map itself stays a night city in both: its buildings, shadows and
//: asphalt are lit for a dark ground, and bleaching them would be a redesign
//: rather than a palette swap. What day mode changes is the margin around the
//: plan — it takes the ground's own colour, so a light Hall frames a deliberate
//: viewport instead of leaving paper around a black island.
/** The ground the city is drawn on, one per skin.
 *
 * `SUELO_CLARO` used to be `0x0b1119` — DARKER than the night floor. Asking the
 * map for daylight made it dimmer, which is how a light mode ships without
 * anybody noticing it was never wired: the Hall dutifully sent `light`, the map
 * dutifully applied it, and the result was a slightly darker night. */
const SUELO = 0x121821;
const SUELO_CLARO = 0xf3f0e8;
/** The colour the ground markings are drawn in: the plaza's ellipse, the block
 * outlines. Warm sand on night, a warm brown on parchment. */
const TRAZO = 0xc8b48a;
const TRAZO_CLARO = 0x8a7247;
let esDeDia = true;

/** The pen the ground is marked with right now. */
export function trazo(): number {
  return esDeDia ? TRAZO_CLARO : TRAZO;
}

/** The Hall's theme message: the map is framed by it and must match its light. */
function esTema(dato: unknown): dato is { type: string; theme: 'light' | 'dark' } {
  const m = dato as { type?: unknown; theme?: unknown } | null;
  return !!m && m.type === 'agents-city-map-theme/1' && (m.theme === 'light' || m.theme === 'dark');
}

function ponTema(cual: 'light' | 'dark'): void {
  esDeDia = cual === 'light';
  const suelo = esDeDia ? SUELO_CLARO : SUELO;
  document.documentElement.dataset.tema = cual;
  document.body.style.background = '#' + suelo.toString(16).padStart(6, '0');
  // The renderer may not exist yet (the message can beat the boot); the body
  // colour above already carries the skin until it does.
  if (appGlobal) appGlobal.renderer.background.color = suelo;
}

interface Parcela {
  id: string;
  repo: string;
  ruta: string;
  unidad: string;
  nombre: string;
  dueno: string | null;
  pisos: number;
  ladrillos: number;
  andamios: number;
  andamio_viejo: number;
  grieta: number;
  actividad30: number;
  /** How many parcels share this parcel's repo. Above one, the counts are the
   *  whole repo's and the fiche says so instead of pretending otherwise. */
  hermanas?: number;
  /** The agent's kind, told by the Hall: picks the building family it wears. */
  clase?: string;
}
interface Persona {
  usuario: string;
  nombre: string;
  rol: string;
  oficio: string;
  agente: string;
}
interface Unidad {
  id: string;
  nombre: string;
  color: string;
  orden: number;
  nota?: string;
  cols: number;
}

let escalaActual = 1;
/** A house on the map: its container, its parcel, and the handle the drawing
 *  returns — which is what lets a house grow instead of being rebuilt. */
type CasaViva = { g: Container; p: Parcela; h?: Casa; dibujado?: number; adorno?: string };
const casas = new Map<string, CasaViva>();
const enObra = new Map<string, { c: Container; parcela: string }>();
const peritos = new Map<string, Container>();
let personas: Persona[] = [];
/** Goals, by user. The invariant of this whole thing, so the map carries them. */
interface Meta {
  usuario: string;
  n: number;
  titulo: string;
  como?: string;
  medida?: string;
  partida?: string;
  meta?: string;
  cuando?: string;
  estado?: string;
}
let objetivos: Meta[] = [];
let capaGente: Container;
/** The banners live above every district, not inside their own. Inside, the
 *  district drawn next covers the one before it: at any zoom where the city fits
 *  on screen, half the names were hidden behind somebody else's tower. */
let capaCarteles: Container;
let plaza = { x: 0, y: 0 };
const enPlaza = new Map<string, Container>();
let mundo: Container;
let appGlobal: Application | null = null;
let activityActors: ActivityActors | null = null;
let gameSpeech: CitySpeech | null = null;
let ayuntamiento: Ayuntamiento | null = null;
let presencia: Presencia | null = null;
let puertas: Puertas | null = null;
let configPendiente: MapConfigMessage | null = null;
/** Where the town hall stands: the camera's committee shot aims here. */
let posAyto = { x: 0, y: 0 };
/** Faces the Hall sent, as textures for figure labels and as URIs for fiches. */
const carasMapa = new Map<string, Texture>();
let avataresURI: Record<string, string> = {};
/** Who walked to the committee, and where they stood before it opened. */
const enSesion = new Map<string, { fig: Container; vuelta: { x: number; y: number } }>();
const queuedSpeech: ActivityEvent[] = [];

/**
 * Every animation on the map runs from one ticker.
 *
 * Not a detail: growth used to be animated by hanging an `onRender` on the house
 * itself, so a second animation on the same house silently replaced the first —
 * and any house whose sprite got rebuilt mid-animation kept the old scale for
 * ever. One list, one owner, and a callback that says when it is done.
 */
const animaciones = new Set<(dt: number) => boolean>();

/**
 * Somebody who asked their system for less motion gets less motion: every tween
 * is run once, to its end state, instead of over time. The map still says
 * everything it says — a house that grew is taller, a notice is in the ticker —
 * it just stops moving to say it. Growth is the whole point of the replay, so
 * this is the one place where honouring the setting has to be deliberate rather
 * than a blanket `animation: none`.
 */
const SIN_MOVIMIENTO =
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

const anima = (f: (dt: number) => boolean) => {
  if (SIN_MOVIMIENTO) {
    f(1e6);
    return;
  } // straight to the end state
  animaciones.add(f);
};

const parentOrigin = new URLSearchParams(location.search).get('parent_origin') || '';

/** The local Hall owns the authenticated activity WebSocket. The map receives
 * only its semantic, already-sanitised events, and only from the parent origin
 * explicitly written into the iframe URL. */
window.addEventListener('message', (message) => {
  if (!parentOrigin || message.source !== window.parent || message.origin !== parentOrigin) {
    return;
  }
  if (isMapConfigMessage(message.data)) {
    if (puertas) aplicaConfig(message.data);
    else configPendiente = message.data;
    return;
  }
  if (esTema(message.data)) {
    ponTema(message.data.theme);
    return;
  }
  if (!isMapActivityMessage(message.data)) return;
  const event = message.data.event;
  if (!isSpeechEvent(event) && !isPresenceEvent(event) && !event.kind.startsWith('committee.')) {
    return;
  }
  showActivity(event);
});

function showActivity(event: ActivityEvent): void {
  if (!gameSpeech || !activityActors) {
    queuedSpeech.push(event);
    if (queuedSpeech.length > 20) queuedSpeech.shift();
    return;
  }
  // The town hall and the lights watch the same feed the bubbles do: a
  // committee event is both something somebody said and something happening to
  // the building, and a lifecycle beat is only ever a light.
  coreografia(event);
  ayuntamiento?.recibe(event);
  presencia?.recibe(event);
  if (isSpeechEvent(event)) gameSpeech.show(event);
}

/**
 * The staging around a committee: the camera flies to the town hall when a
 * session opens, the chair and each member who submits walk over, and when it
 * closes everybody walks home and the camera pulls back to the whole city.
 * All of it defers to the person: a camera you dragged, or a follow switch you
 * turned off, is never overridden.
 */
function coreografia(event: ActivityEvent): void {
  if (!event.kind.startsWith('committee.')) return;
  if (event.kind === 'committee.opened') {
    if (camara.sigue && !camara.tuyo) mira(posAyto.x, posAyto.y - 44, 0.95);
    const chair = activityActors?.resolve(event);
    if (chair && !enSesion.has('seat')) {
      enSesion.set('seat', { fig: chair, vuelta: { x: chair.x, y: chair.y } });
      anda(chair, { x: posAyto.x - 36, y: posAyto.y + 30 });
    }
    return;
  }
  if (event.kind === 'committee.position.submitted' && activityActors) {
    const fig = activityActors.resolve(event);
    if (!enSesion.has(event.actor)) {
      const sitio = enSesion.size;
      enSesion.set(event.actor, { fig, vuelta: { x: fig.x, y: fig.y } });
      // The forecourt: members line up on the paving, facing the door.
      anda(fig, { x: posAyto.x - 96 + sitio * 30, y: posAyto.y + 46 + (sitio % 2) * 11 });
    }
    return;
  }
  if (event.kind === 'committee.closed' || event.kind === 'committee.cancelled') {
    for (const { fig, vuelta } of enSesion.values()) anda(fig, vuelta);
    enSesion.clear();
    if (camara.sigue && !camara.tuyo && appGlobal) encaja(appGlobal, false);
  }
}

/** What the Hall told this map: gates, kinds and faces, applied in place. */
function aplicaConfig(config: MapConfigMessage): void {
  puertas?.configura(config.roads);

  // Kinds: dress each agent's parcel in its family. Only movers are rebuilt.
  for (const agente of config.agents ?? []) {
    const wanted = actorKey(agente.name);
    for (const c of casas.values()) {
      const es =
        actorMatches(c.p.repo, wanted) ||
        actorMatches(c.p.nombre, wanted) ||
        actorMatches(c.p.id, wanted);
      if (es && c.p.clase !== agente.kind) {
        c.p.clase = agente.kind;
        reconstruye(c);
      }
    }
  }

  // Faces: decoded once into textures; figures pick them up as they are made,
  // and the crew already on screen gets chipped as each face finishes decoding.
  avataresURI = { ...avataresURI, ...(config.avatars ?? {}) };
  for (const [nombre, uri] of Object.entries(config.avatars ?? {})) {
    if (!uri.startsWith('data:image/svg+xml;base64,') || carasMapa.has(nombre)) continue;
    const img = new Image();
    img.src = uri;
    img
      .decode()
      .then(() => {
        carasMapa.set(nombre, Texture.from(img));
        for (const [id, o] of enObra) abrochaCara(o.c, id.split('/').at(-1) ?? '');
      })
      .catch(() => {});
  }
}

/**
 * Replace a house in place — same plot, same click — because its data changed
 * shape (its kind arrived), not just its height. The growth path never comes
 * through here; `subeHasta` keeps owning that.
 */
function reconstruye(c: CasaViva): void {
  const padre = c.g.parent;
  if (!padre) return;
  const col = COLOR[c.p.unidad] ?? COLOR_POR_DEFECTO;
  const px = c.g.x,
    py = c.g.y,
    z = padre.getChildIndex(c.g);
  padre.removeChild(c.g);
  const h = casa(col, c.p, c.p.id);
  h.g.position.set(px, py);
  h.g.eventMode = 'static';
  h.g.cursor = 'pointer';
  h.g.on('pointertap', () => ficha(c.p));
  padre.addChildAt(h.g, Math.min(z, padre.children.length));
  c.g = h.g;
  c.h = h;
  c.dibujado = c.p.pisos;
}

/** The agent's face, pinned beside its figure's label once the Hall sent one. */
function abrochaCara(fig: Container, nombre: string): void {
  const tex = carasMapa.get(nombre);
  const cartel = (fig as any).__cartel as Container | undefined;
  if (!tex || !cartel || (cartel as any).__caraChip) return;
  const chip = new Sprite(tex);
  chip.width = 15;
  chip.height = 15;
  const b = cartel.getLocalBounds();
  chip.position.set(b.x - 17, -8);
  cartel.addChild(chip);
  (cartel as any).__caraChip = chip;
}

/** Ask the Hall around this iframe for one of its sections. Standalone maps
 * have no Hall to ask and simply say so. */
function navHall(view: string): boolean {
  if (!parentOrigin || window.parent === window) return false;
  window.parent.postMessage(
    { protocol: MAP_ACTIVITY_PROTOCOL, type: 'map.nav', view },
    parentOrigin,
  );
  return true;
}

async function arranca() {
  const app = new Application();
  appGlobal = app;
  const lienzo = document.querySelector('main') as HTMLElement;
  // Day, unless the Hall has already said otherwise: the boot must agree with
  // the stylesheet's own default, or the canvas flashes the wrong skin.
  await app.init({
    background: esDeDia ? SUELO_CLARO : SUELO,
    antialias: true,
    resizeTo: lienzo,
  });
  lienzo.appendChild(app.canvas);

  mundo = new Container();
  capaGente = new Container();
  capaCarteles = new Container();
  app.stage.addChild(mundo);

  const [datos, conSprites] = await Promise.all([
    fetch('/api/city').then((r) => r.json()) as Promise<{
      parcelas: Parcela[];
      personas: Persona[];
      unidades: Unidad[];
      gasto?: Gasto;
      objetivos?: Meta[];
    }>,
    cargaSprites(),
  ]);
  // The units define the districts: name, colour, order and grid width.
  for (const u of datos.unidades ?? []) COLOR[u.id] = parseInt(hex(u.color), 16);
  BARRIOS = (datos.unidades ?? []).map((u) => ({
    id: u.id,
    nom: u.nombre,
    cols: u.cols,
    nota: u.nota ?? undefined,
  }));
  if (!BARRIOS.length) BARRIOS = [{ id: 'none', nom: 'All repos', cols: 16 }];
  leyenda(datos.unidades ?? []);
  if (!conSprites) console.log('city: no baked sprites, falling back to polygons');
  const parcelas = datos.parcelas ?? [];
  personas = datos.personas ?? [];
  objetivos = (datos as any).objetivos ?? [];

  const porUnidad = new Map<string, Parcela[]>(BARRIOS.map((b) => [b.id, []]));
  for (const p of parcelas) (porUnidad.get(p.unidad) ?? porUnidad.get('none')!).push(p);

  const barrios: Container[] = [];
  for (const b of BARRIOS) {
    const lista = porUnidad.get(b.id)!;
    const col = COLOR[b.id] ?? COLOR_POR_DEFECTO;
    const cols = Math.min(b.cols, Math.max(1, lista.length));
    const filas = Math.ceil(lista.length / cols) || 1;

    const barrio = new Container();
    barrio.addChild(suelo(cols, filas, col, b.id === 'lab'));

    // Houses, and a tree in the gaps the last row leaves.
    const dentro: Container[] = [];
    for (let i = 0; i < cols * filas; i++) {
      const cx = i % cols,
        cy = Math.floor(i / cols);
      const p = lista[i];
      const { x, y } = iso(cx * PASO, cy * PASO);
      if (!p) {
        if ((cx + cy) % 3 === 0) {
          const a = arbol();
          a.position.set(x, y);
          dentro.push(a);
        }
        continue;
      }
      const c = casa(col, p, p.id);
      c.g.position.set(x, y);
      c.g.eventMode = 'static';
      c.g.cursor = 'pointer';
      c.g.on('pointertap', () => ficha(p));
      dentro.push(c.g);
      casas.set(p.id, { g: c.g, p, h: c });
    }
    // What is behind gets painted first: that is the whole trick of isometric.
    dentro.sort((a, b2) => a.y - b2.y).forEach((x) => barrio.addChild(x));

    const cuantas = `${lista.length} ${plural(lista.length, 'parcel')}`;
    const est = estandarte(b.nom, b.nota ? `${cuantas} · ${b.nota}` : cuantas, col);
    const esq = iso(-1.5 * PASO, (filas + 0.5) * PASO);
    // Positioned inside the district, drawn in the layer above: the offset is
    // applied once the district knows where it stands, at the end of the layout.
    (barrio as any).__cartel = { est, dx: esq.x, dy: esq.y + TH };

    // What the layout needs to know about a district: how many plots wide and
    // deep it is. In plots, not pixels — the whole city is packed on one grid.
    (barrio as any).__m = { cols, filas };
    barrios.push(barrio);
    mundo.addChild(barrio);
  }
  mundo.addChild(capaGente);
  // Every figure in this layer opens its person's card. Delegated to the layer
  // rather than wired per figure: figures are created and destroyed constantly
  // as people start and stop, and a listener per figure is a listener to forget.
  capaGente.eventMode = 'static';
  capaGente.on('pointertap', (e: any) => {
    let n: any = e.target;
    while (n && n !== capaGente && !n.__usuario) n = n.parent;
    if (n?.__usuario) fichaPersona(n.__usuario);
  });

  /**
   * Composition: one city on one isometric plane, not eight islands.
   *
   * Every district is a block of plots, and the blocks are packed onto the same
   * grid with avenues between them — so the streets of one district meet the
   * streets of the next, and the whole thing reads as a place you could walk
   * across. Laid out in screen rows before, which is why it looked like eight
   * rugs thrown on a floor: nothing connected to anything.
   *
   * It cannot assume how many districts there are — units come from the data, so
   * there may be one or twenty — and the shared district and the lab go at the
   * back, because the shared one is usually bigger than all the others together.
   */
  const AVENIDA = 2; // plots of road between blocks
  const esFondo = (id: string) => id === 'lab' || id === 'none';
  const orden = barrios
    .map((b, i) => ({ b, id: BARRIOS[i].id, m: (b as any).__m }))
    .sort((x, y) => Number(esFondo(x.id)) - Number(esFondo(y.id)));

  // How wide the city should be, in blocks: roughly square, so it fits a screen
  // rather than running off one edge.
  const porFila = Math.max(1, Math.round(Math.sqrt(orden.length)));
  let ox = 0,
    oy = 0,
    filaAlta = 0,
    anchoCeldas = 0,
    altoCeldas = 0;
  orden.forEach((d, i) => {
    if (i > 0 && i % porFila === 0) {
      oy += filaAlta + AVENIDA;
      ox = 0;
      filaAlta = 0;
    }
    const { x, y } = iso(ox * PASO, oy * PASO);
    d.b.position.set(x, y);
    (d.b as any).__celda = { ox, oy };
    ox += d.m.cols + AVENIDA;
    filaAlta = Math.max(filaAlta, d.m.filas);
    anchoCeldas = Math.max(anchoCeldas, ox);
    altoCeldas = Math.max(altoCeldas, oy + d.m.filas);
  });

  // Painting order is the whole trick of isometric: what is further back goes
  // down first. On one plane that is (ox + oy), and it has to be applied across
  // districts, not just inside them.
  for (const d of [...orden].sort(
    (a, b) =>
      (a.b as any).__celda.ox +
      (a.b as any).__celda.oy -
      ((b.b as any).__celda.ox + (b.b as any).__celda.oy),
  )) {
    mundo.setChildIndex(d.b, mundo.children.length - 1);
  }
  mundo.setChildIndex(capaGente, mundo.children.length - 1);

  // The ground goes in behind everything, now that the extent is known.
  const bloques = orden.map((d) => ({ ...(d.b as any).__celda, cols: d.m.cols, filas: d.m.filas }));
  const base = plano(anchoCeldas, altoCeldas, bloques);
  mundo.addChildAt(base, 0);

  const yFondo = iso(anchoCeldas * PASO * 0.5, altoCeldas * PASO).y;

  // Now that every district has a position, hang its banner in the top layer.
  for (const b of barrios) {
    const c = (b as any).__cartel;
    if (!c) continue;
    c.est.position.set(b.x + c.dx, b.y + c.dy);
    capaCarteles.addChild(c.est);
  }
  mundo.addChild(capaCarteles);

  // The city square: where people who are on the bus with no work started stand.
  // Being connected is not the same as digging, and a map that does not
  // distinguish them is lying.
  // The square sits at the near corner of the city, past the last block: it is
  // the entrance, which is where people who have arrived but not started belong.
  plaza = { x: 0, y: yFondo + 70 };
  const suelo2 = new Graphics()
    .ellipse(0, 6, 128, 44)
    .fill({ color: trazo(), alpha: esDeDia ? 0.08 : 0.05 })
    .ellipse(0, 6, 128, 44)
    .stroke({ color: trazo(), alpha: esDeDia ? 0.35 : 0.22, width: 1 });
  suelo2.position.set(plaza.x, plaza.y);
  mundo.addChildAt(suelo2, mundo.children.indexOf(capaGente));

  // The town hall stands past the square, at the city's entrance: the committee
  // is the seat's process, and the seat's place has always been the square.
  posAyto = { x: plaza.x + 216, y: plaza.y - 12 };
  ayuntamiento = new Ayuntamiento(capaGente, posAyto, casaAncla, anima, SIN_MOVIMIENTO);
  mundo.addChildAt(ayuntamiento.edificio, mundo.children.indexOf(capaGente));
  capaCarteles.addChild(ayuntamiento.cartel);
  // Clicking the hall answers the obvious question — what is the committee
  // doing — the way clicking anything else on this map answers its own.
  ayuntamiento.edificio.eventMode = 'static';
  ayuntamiento.edificio.cursor = 'pointer';
  ayuntamiento.edificio.on('pointertap', fichaAyuntamiento);

  presencia = new Presencia(
    casaVivaDe,
    (id) => casas.get(id) ?? null,
    existingActorFigure,
    SIN_MOVIMIENTO,
  );

  // The gates stand past the town hall, one per road, once the Hall says which.
  puertas = new Puertas({ x: plaza.x, y: plaza.y }, anima, fichaPuerta);
  mundo.addChildAt(puertas.capa, mundo.children.indexOf(capaGente));
  capaCarteles.addChild(puertas.carteles);
  if (configPendiente) {
    aplicaConfig(configPendiente);
    configPendiente = null;
  }

  activityActors = new ActivityActors(
    capaGente,
    existingActorFigure,
    activityPosition,
    (figura, actor) => abrochaCara(figura, actor),
  );
  gameSpeech = new CitySpeech(lienzo, activityActors.resolve);
  for (const event of queuedSpeech.splice(0)) {
    ayuntamiento.recibe(event);
    gameSpeech.show(event);
  }

  // The architect is drawn when present, like everybody else: reparteEnPlaza()
  // places them from the bus lights. Drawing them always made the map claim
  // somebody was there when they were not.

  // A handle for debugging in the console: what each house is, and how tall it is
  // right now. Cheap, and the alternative is guessing about the one thing this
  // map has to get right.
  (window as any).__city = {
    casas,
    // The two live painters, exposed so a broken live update can be reproduced
    // from the console instead of guessed at.
    pintaLuces: (l: any[]) => conectados(l),
    pintaObreros: (o: any[]) => cuadrilla(o),
    speak: (actor: string, target: string, text: string) =>
      showActivity({
        protocol: 'agents-city-activity/1',
        id: `debug-${Date.now()}`,
        seq: 0,
        city: 'local-preview',
        thread: null,
        kind: 'conversation.agent',
        actor,
        role: actor === 'seat' ? 'chair' : 'member',
        phase: 'answered',
        tone: 'evidence',
        title: `${actor} speaks`,
        summary: text,
        details: [],
        target,
        at: new Date().toISOString(),
      }),
    // Rehearse the gates without a Hall: `roads([{name:'home',address:'you/home'}])`,
    // then `letter('ada','you/home','security')` sends one out through the arch.
    roads: (lista: { name: string; address: string }[]) => puertas?.configura(lista),
    letter: (de: string, para: string, etiqueta = 'product') => volando(de, para, etiqueta),
    // Drive the live lights from the console: `presence('conversation.user','nova')`
    // and the house breathes without waiting for a real turn.
    presence: (kind: string, actor: string) =>
      showActivity({
        protocol: 'agents-city-activity/1',
        id: `debug-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        seq: 0,
        city: 'local-preview',
        thread: null,
        kind,
        actor,
        role: 'member',
        phase: 'debug',
        tone: 'system',
        title: kind,
        summary: '',
        details: [],
        at: new Date().toISOString(),
      }),
    // Drive the town hall from the console: a whole session can be rehearsed
    // without opening a real deliberation, which is how the scene gets debugged.
    committee: (kind: string, actor = 'seat', summary = '', thread = 'debug-delib') =>
      showActivity({
        protocol: 'agents-city-activity/1',
        id: `debug-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        seq: 0,
        city: 'local-preview',
        thread,
        kind,
        actor,
        role: actor === 'seat' ? 'chair' : 'member',
        phase: 'debug',
        tone: 'decision',
        title: kind,
        summary,
        details: [],
        at: new Date().toISOString(),
      }),
    animando: () => animaciones.size,
    // Where the town hall sits on screen right now: how a headless check aims
    // a click at it without guessing camera math.
    hallScreen: () => ayuntamiento?.edificio.getGlobalPosition() ?? { x: 0, y: 0 },
    alturas: () =>
      [...casas.entries()].map(([id, c]) => ({
        id,
        pisos: c.dibujado ?? 0,
        // The settled height, not the frame's: sprite.height mid-tween is a
        // number about the animation, not about the parcel.
        objetivo: +alturaDe(c.dibujado ?? 0).toFixed(3),
        escalaY: c.h?.sp ? +(c.h.sp.scale.y / (c.h.escala ?? 1)).toFixed(3) : 0,
        modelo: c.h?.medida ? +c.h.medida.alto.toFixed(2) : 0,
      })),
  };

  app.ticker.add((t) => {
    for (const f of [...animaciones]) if (!f(t.deltaTime)) animaciones.delete(f);
    mueveCamara(t.deltaTime);
    gameSpeech?.tick();
    presencia?.tick(t.deltaTime);
  });

  encaja(app);
  window.addEventListener('resize', () => encaja(app));
  raton(app);
  cifra('c-casas', parcelas.length);
  gastoHUD(datos.gasto);
  setInterval(
    () =>
      fetch('/api/tokens')
        .then((r) => r.json())
        .then(gastoHUD)
        .catch(() => {}),
    60000,
  );
  vivo();
  cargaPeli();
}

/** Reuse the figure already painted by the presence/work feeds whenever they
 * can identify the speaker. Activity figures only fill the gap for repo agents
 * those older feeds do not represent. */
function existingActorFigure(actor: string): Container | null {
  const wanted = actorKey(actor);
  const users = new Set<string>([actor]);
  for (const light of ultimasLuces) {
    if (actorMatches(light.agente, wanted) || actorMatches(light.usuario, wanted)) {
      users.add(String(light.usuario || ''));
    }
  }
  if (actor === 'seat') {
    const chair = personas.find((person) => person.rol === 'cpto') || personas[0];
    if (chair) users.add(chair.usuario);
  }
  for (const user of users) {
    const figure = enPlaza.get(user) || peritos.get(user);
    if (figure) return figure;
  }
  for (const [id, worker] of enObra) {
    if (
      actorMatches(id, wanted) ||
      [...users].some((user) => id === user || id.startsWith(`${user}/`))
    ) {
      return worker.c;
    }
  }
  return null;
}

/** The parcel an actor answers to, by the same matching the bubbles use — or
 * null when the map has no parcel it can honestly pin them to. */
function casaVivaDe(actor: string): { id: string; casa: CasaViva } | null {
  const wanted = actorKey(actor);
  for (const [id, candidate] of casas) {
    if (
      actorMatches(candidate.p.repo, wanted) ||
      actorMatches(candidate.p.nombre, wanted) ||
      actorMatches(candidate.p.id, wanted)
    ) {
      return { id, casa: candidate };
    }
  }
  return null;
}

/** Where an actor's house stands, in world coordinates. */
function casaAncla(actor: string): { x: number; y: number } | null {
  const viva = casaVivaDe(actor);
  if (!viva) return null;
  const parent = viva.casa.g.parent;
  return { x: (parent?.x ?? 0) + viva.casa.g.x, y: (parent?.y ?? 0) + viva.casa.g.y };
}

/** Members stand beside their repo house; the chair stands in the square. */
function activityPosition(event: ActivityEvent): { x: number; y: number } {
  if (event.role === 'chair' || event.actor === 'seat') {
    return { x: plaza.x - 58, y: plaza.y + 18 };
  }
  const ancla = casaAncla(event.actor);
  if (ancla) {
    return { x: ancla.x + TW * 0.38, y: ancla.y + TH * 0.72 };
  }
  const angle = ((stableNumber(event.actor) % 9) / 9) * Math.PI * 2;
  return { x: plaza.x + Math.cos(angle) * 92, y: plaza.y + Math.sin(angle) * 34 + 14 };
}

function actorKey(value: unknown): string {
  return String(value || '')
    .split('/')
    .at(-1)!
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function actorMatches(value: unknown, wanted: string): boolean {
  return Boolean(wanted && actorKey(value) === wanted);
}

function stableNumber(value: string): number {
  let hash = 17;
  for (const character of value) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return hash;
}

/** The HUD legend comes from the data too, not from the HTML. */
function leyenda(unidades: Unidad[]) {
  const c = document.getElementById('leyenda');
  if (!c) return;
  c.innerHTML = '';
  for (const u of unidades) {
    const d = document.createElement('div');
    d.innerHTML =
      `<span class="pip" style="background:#${hex(u.color)}"></span>${esc(u.nombre)}` +
      (u.nota ? ` <span class="nota2">· ${esc(u.nota)}</span>` : '');
    c.appendChild(d);
  }
}

/**
 * The camera.
 *
 * Not a fit-to-screen and nothing else: a map where the whole city always fits
 * is a map where the people are four pixels tall, and the people are the point.
 * So there is a target — a place and a zoom — and the view eases towards it every
 * frame. The replay moves that target to wherever work landed that day; the
 * present frames the whole city; and the moment you drag or wheel, the camera
 * lets go and leaves you alone until you ask for it back.
 */
const camara = {
  x: 0,
  y: 0,
  s: 1, // where it is going
  tuyo: false, // the human took over
  sigue: true, // chase the action during the replay
  pantalla: { w: 0, h: 0 },
};

function mira(x: number, y: number, s: number) {
  camara.x = x;
  camara.y = y;
  camara.s = s;
}

/** Frame the whole city. What the present looks at, and what the ⤢ button does. */
function encaja(app: Application, inmediato = true) {
  camara.pantalla = { w: app.screen.width, h: app.screen.height };
  const b = mundo.getLocalBounds();
  const esc = Math.min(
    app.screen.width / (b.width + 90),
    app.screen.height / (b.height + 120),
    1.5,
  );
  camara.tuyo = false;
  mira(b.x + b.width / 2, b.y + b.height / 2, esc);
  if (inmediato) {
    mundo.scale.set(esc);
    mundo.position.set(
      app.screen.width / 2 - camara.x * esc,
      app.screen.height / 2 - camara.y * esc,
    );
    carteles(esc);
  }
}

/** One step of the easing. Called from the same ticker as everything else. */
function mueveCamara(dt: number) {
  if (camara.tuyo) return;
  const k = Math.min(1, 0.055 * dt);
  const s = mundo.scale.x + (camara.s - mundo.scale.x) * k;
  const px = camara.pantalla.w / 2 - camara.x * s;
  const py = camara.pantalla.h / 2 - camara.y * s;
  mundo.scale.set(s);
  mundo.x += (px - mundo.x) * k;
  mundo.y += (py - mundo.y) * k;
  if (Math.abs(s - escalaActual) > 0.02) carteles(s);
}

/**
 * Point the camera at what is happening on this day of the replay.
 *
 * The centre is the average of the houses that grew, so with work in two corners
 * it pulls back and shows both, and with everything in one district it goes in
 * close. Weighted by nothing: a parcel that landed one PR matters as much as the
 * monolith, because what is being shown is where somebody was working.
 */
function miraLaAccion(activas: string[]) {
  if (!camara.sigue) return;
  const puntos = activas
    .map((id) => casas.get(id))
    .filter(Boolean)
    .map((c) => ({ x: (c!.g.parent?.x ?? 0) + c!.g.x, y: (c!.g.parent?.y ?? 0) + c!.g.y }));
  if (!puntos.length) return;
  const cx = puntos.reduce((a, p) => a + p.x, 0) / puntos.length;
  const cy = puntos.reduce((a, p) => a + p.y, 0) / puntos.length;
  // How spread out the day's work is decides the zoom: everything in one street
  // gets a close shot, work in three districts gets a wide one.
  const r = Math.max(...puntos.map((p) => Math.hypot(p.x - cx, p.y - cy)), 120);
  // Capped at 1: closer than that and you are looking at three buildings with no
  // idea where they are. The point of following is to be near the work AND still
  // see the city around it.
  const quiere = Math.max(
    0.5,
    Math.min(1, Math.min(camara.pantalla.w / (r * 3.2), camara.pantalla.h / (r * 2.8))),
  );
  // The zoom only moves when it really has to. Recomputing it every day meant
  // the camera pushed in and pulled out constantly as the day's work spread or
  // gathered — accurate, and nauseating to watch.
  const s = Math.abs(quiere - camara.s) > 0.22 ? quiere : camara.s;
  // And the pan gets the same medicine. "Panning is free" turned out to be wrong
  // in the same way: retargeting on every day's centroid sent the view lurching
  // corner to corner. Now the camera moves only when the action has really left
  // the shot — more than a fifth of the visible world away — and parks otherwise.
  const dx = Math.abs(cx - camara.x) / (camara.pantalla.w / Math.max(s, 0.1));
  const dy = Math.abs(cy - 60 / s - camara.y) / (camara.pantalla.h / Math.max(s, 0.1));
  if (dx > 0.2 || dy > 0.2 || s !== camara.s) mira(cx, cy - 60 / s, s);
}

function raton(app: Application) {
  let arrastra = false,
    ax = 0,
    ay = 0;
  app.canvas.addEventListener('pointerdown', (e) => {
    arrastra = true;
    ax = e.clientX;
    ay = e.clientY;
    camara.tuyo = true; // you drag, the camera stops deciding
  });
  window.addEventListener('pointerup', () => {
    arrastra = false;
  });
  window.addEventListener('pointermove', (e) => {
    if (!arrastra) return;
    mundo.x += e.clientX - ax;
    mundo.y += e.clientY - ay;
    ax = e.clientX;
    ay = e.clientY;
  });
  app.canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      camara.tuyo = true;
      const k = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      const antes = mundo.scale.x,
        desp = Math.max(0.25, Math.min(3, antes * k));
      // Zoom hacia el puntero: si no, alejarse te saca del sitio que mirabas.
      mundo.x = e.offsetX - (e.offsetX - mundo.x) * (desp / antes);
      mundo.y = e.offsetY - (e.offsetY - mundo.y) * (desp / antes);
      mundo.scale.set(desp);
      carteles(desp);
    },
    { passive: false },
  );

  // Double click on the ground: give the camera back.
  app.canvas.addEventListener('dblclick', () => encaja(app, false));

  // A click on the map that did not land on a house or a person closes the card.
  // Clicking away is what everybody tries first, and it did nothing.
  app.stage.eventMode = 'static';
  app.stage.hitArea = { contains: () => true } as any;
  app.stage.on('pointertap', (e: any) => {
    let n: any = e.target;
    while (n) {
      if (n.__usuario || (n.eventMode === 'static' && n !== app.stage && n.cursor === 'pointer'))
        return;
      n = n.parent;
    }
    cierraFicha();
  });

  /**
   * The controls.
   *
   * A map you can only move with a trackpad is a map half the people who open it
   * cannot move at all. Zoom, fit, and a switch for whether the camera chases
   * what is happening — plus the same four things on the keyboard, because
   * anybody who watches this for more than a minute reaches for the arrows.
   */
  const zoom = (k: number) => {
    camara.tuyo = true;
    const antes = mundo.scale.x,
      desp = Math.max(0.25, Math.min(3, antes * k));
    const cx = app.screen.width / 2,
      cy = app.screen.height / 2;
    mundo.x = cx - (cx - mundo.x) * (desp / antes);
    mundo.y = cy - (cy - mundo.y) * (desp / antes);
    mundo.scale.set(desp);
    carteles(desp);
  };
  const sigue = document.getElementById('m-sigue');
  const marcaSeguir = () => sigue?.classList.toggle('on', camara.sigue);
  document.getElementById('m-mas')?.addEventListener('click', () => zoom(1.25));
  document.getElementById('m-menos')?.addEventListener('click', () => zoom(1 / 1.25));
  document.getElementById('m-encaja')?.addEventListener('click', () => {
    encaja(app, false);
    marcaSeguir();
  });
  sigue?.addEventListener('click', () => {
    camara.sigue = !camara.sigue;
    if (camara.sigue) camara.tuyo = false;
    marcaSeguir();
  });
  // Fullscreen: the whole page, not just the canvas — the HUD, the fiches and
  // the bubbles are part of watching the city, so they come along. Embedded in
  // the Hall this fullscreens the map's iframe, which is exactly the map.
  const full = document.getElementById('m-full');
  const pantallaCompleta = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen().catch(() => {});
  };
  full?.addEventListener('click', pantallaCompleta);
  document.addEventListener('fullscreenchange', () => {
    full?.classList.toggle('on', Boolean(document.fullscreenElement));
    encaja(app, false); // the viewport just changed size: reframe the city
  });

  window.addEventListener('keydown', (e) => {
    if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
    const paso = e.shiftKey ? 120 : 45;
    switch (e.key) {
      case '+':
      case '=':
        zoom(1.25);
        break;
      case '-':
      case '_':
        zoom(1 / 1.25);
        break;
      case 'f':
      case 'F':
        encaja(app, false);
        marcaSeguir();
        break;
      case 'g':
      case 'G':
        camara.sigue = !camara.sigue;
        if (camara.sigue) camara.tuyo = false;
        marcaSeguir();
        break;
      case 'p':
      case 'P':
        pantallaCompleta();
        break;
      case ' ':
        reproduce();
        e.preventDefault();
        break;
      case 'ArrowLeft':
      case 'a':
        camara.tuyo = true;
        mundo.x += paso;
        break;
      case 'ArrowRight':
      case 'd':
        camara.tuyo = true;
        mundo.x -= paso;
        break;
      case 'ArrowUp':
      case 'w':
        camara.tuyo = true;
        mundo.y += paso;
        break;
      case 'ArrowDown':
      case 's':
        camara.tuyo = true;
        mundo.y -= paso;
        break;
      default:
        return;
    }
  });
}

/** Zoomed out the trade drops, then the whole label: who it is shows up close. */
/**
 * Labels keep their size on screen, whatever the zoom.
 *
 * The alternative — letting them scale with the world — means the district
 * banner is unreadable when you are looking at the whole city and the size of a
 * road sign when you are not. Every map ever drawn keeps its type at one size;
 * the city underneath is what zooms.
 */
function carteles(escala: number) {
  escalaActual = escala;
  const inverso = Math.max(0.55, Math.min(1.8, 1 / escala));
  for (const c of capaCarteles?.children ?? []) (c as Container).scale.set(inverso);
  const figuras: Container[] = [
    ...[...enObra.values()].map((o) => o.c),
    ...peritos.values(),
    ...enPlaza.values(),
  ];
  for (const g of figuras) {
    const ca = (g as any).__cartel;
    if (ca) ca.scale.set(inverso / ESCALA_GENTE);
  }
  const conCartel = escala > 0.5,
    conSegunda = escala > 0.85;
  for (const { c } of enObra.values()) toca(c, conCartel, conSegunda);
  for (const c of peritos.values()) toca(c, conCartel, conSegunda);
  for (const c of enPlaza.values()) toca(c, conCartel, conSegunda);
  for (const c of capaGente.children) toca(c as Container, conCartel, conSegunda);
  // District banners keep their name at every zoom — it is how you know what you
  // are looking at — and drop the parcel count when it stops being readable.
  for (const c of capaCarteles?.children ?? []) {
    const sub = (c as any).__sub;
    if (sub) sub.visible = escala > 0.8;
  }
}
function toca(c: Container, cartel: boolean, segunda: boolean) {
  const ca = (c as any).__cartel,
    sg = (c as any).__agente;
  if (ca) ca.visible = cartel;
  if (sg) sg.visible = segunda;
}

/**
 * Who this person is, and what they are doing right now.
 *
 * The map is about work, and work belongs to people: clicking a figure and
 * getting nothing was the map refusing to answer the most obvious question
 * anybody asks of it.
 *
 * What it does NOT show is anything that ranks them. The crew size is here
 * because it says what is open, and it is labelled as that — never as output.
 */
function fichaPersona(usuario: string) {
  const f = document.getElementById('ficha')!;
  const cuerpo = document.getElementById('ficha-cuerpo')!;
  const p = personas.find((x) => x.usuario === usuario);
  const col = '#' + colorDe(usuario).toString(16).padStart(6, '0');
  const suyas = [...casas.values()].filter((c) => c.p.dueno === usuario);
  const picando = ultimosObreros.filter((o) => o.usuario === usuario);

  const lista = suyas
    .slice(0, 8)
    .map(
      (c) =>
        `<div class="ag"><span class="an">${esc(c.p.nombre)}</span>` +
        `<span class="do">${esc(c.p.unidad)}</span></div>`,
    )
    .join('');

  cuerpo.innerHTML =
    `<h3><span class="pip" style="background:${col}"></span> ${esc(p?.nombre ?? usuario)}</h3><dl>` +
    `<dt>On the bus</dt><dd>${esc(p?.agente ?? usuario + '/…')}</dd>` +
    `<dt>Role</dt><dd>${esc(p?.rol ?? '—')}${p?.oficio ? ` · ${esc(p.oficio)}` : ''}</dd>` +
    `<dt>Answers for</dt><dd>${suyas.length} ${plural(suyas.length, 'parcel')}</dd>` +
    `<dt>Open now</dt><dd>${
      picando.length
        ? picando
            .map((o) => `${esc(o.ventana)} → ${esc(casas.get(o.parcela)?.p.nombre ?? o.parcela)}`)
            .join('<br>')
        : 'nothing started'
    }</dd></dl>` +
    (lista ? `<div class="lista">${lista}</div>` : '') +
    (suyas.length > 8 ? `<p class="nota2">and ${suyas.length - 8} more</p>` : '') +
    metasDe(usuario);
  f.hidden = false;
}

/**
 * This person's goals, as they are written on their card.
 *
 * The map shows properties and work; the goal is what says whether any of it is
 * going anywhere. It comes with the measure that decides it — a goal you cannot
 * run a command against is an opinion — and with the baseline and the date it
 * was taken, so nobody gets to relitigate the starting point in month three.
 */
function metasDe(usuario: string): string {
  const suyos = objetivos.filter((o) => o.usuario === usuario);
  if (!suyos.length) {
    return `<p class="nota2">No goal set yet. That is a gap, not a detail: a round
      with no goal can only ask what happened, never whether it mattered.</p>`;
  }
  return (
    `<div class="metas">` +
    suyos
      .map((o) => {
        const estado = (o.estado ?? '').toLowerCase().replace(/\s+/g, '-');
        return (
          `<div class="meta">` +
          `<div class="mt"><span class="est ${esc(estado)}">${esc(o.estado ?? '—')}</span>` +
          `<b>${esc(o.titulo)}</b></div>` +
          (o.como ? `<div class="ml"><span>measured by</span>${esc(o.como)}</div>` : '') +
          (o.medida
            ? `<div class="ml"><span>measure</span><code>${esc(o.medida)}</code></div>`
            : '') +
          (o.partida ? `<div class="ml"><span>from</span>${esc(o.partida)}</div>` : '') +
          (o.meta
            ? `<div class="ml"><span>to</span>${esc(o.meta)}${o.cuando ? ` · ${esc(o.cuando)}` : ''}</div>`
            : '') +
          `</div>`
        );
      })
      .join('') +
    `</div>`
  );
}

/** The town hall's card: what the committee is doing right now, and the door
 * to the full transcript when a Hall is wrapped around this map. */
function fichaAyuntamiento() {
  if (!ayuntamiento) return;
  const f = document.getElementById('ficha')!;
  const cuerpo = document.getElementById('ficha-cuerpo')!;
  const s = ayuntamiento.estado();
  cuerpo.innerHTML =
    `<h3>${caraHTML('seat')}Town hall</h3><dl>
    <dt>Committee</dt><dd>${esc(s.fase)}</dd>
    ${s.actor ? `<dt>Last turn</dt><dd>${esc(s.actor)}</dd>` : ''}
    <dt>Positions in</dt><dd>${s.posiciones | 0}</dd>
    <dt>Session</dt><dd>${s.activo ? 'sitting now' : 'not sitting'}</dd></dl>` +
    (parentOrigin
      ? `<p><button class="irHall" id="vamosComite">Open the committee in the Hall</button></p>`
      : `<p class="nota2">The acts live in the city's deliberations folder.</p>`);
  document.getElementById('vamosComite')?.addEventListener('click', () => navHall('committee'));
  f.hidden = false;
}

/** A gate's card: where the road goes, and the Hall's roads page behind it. */
function fichaPuerta(road: RoadInfo) {
  const f = document.getElementById('ficha')!;
  const cuerpo = document.getElementById('ficha-cuerpo')!;
  cuerpo.innerHTML =
    `<h3>${esc(road.name)}</h3><dl>
    <dt>Road to</dt><dd><code>${esc(road.address)}</code></dd>
    <dt>Grants</dt><dd>reachability between seats — never authority</dd></dl>` +
    (parentOrigin
      ? `<p><button class="irHall" id="vamosRed">Open roads in the Hall</button></p>`
      : '');
  document.getElementById('vamosRed')?.addEventListener('click', () => navHall('red'));
  f.hidden = false;
}

/** An agent's face for HTML cards, when the Hall has sent one. */
function caraHTML(nombre: string): string {
  const uri = avataresURI[nombre];
  if (!uri || !uri.startsWith('data:image/svg+xml;base64,')) return '';
  return `<img class="fichaCara" src="${esc(uri)}" alt="">`;
}

function ficha(p: Parcela) {
  const f = document.getElementById('ficha')!;
  const cuerpo = document.getElementById('ficha-cuerpo')!;
  const due = personas.find((x) => x.usuario === p.dueno);
  cuerpo.innerHTML =
    `<h3>${caraHTML(p.nombre) || caraHTML(p.repo)}${esc(p.nombre)}</h3><dl>
    <dt>Repo</dt><dd>${esc(p.repo)}</dd>
    <dt>Parcel</dt><dd>${esc(p.ruta || 'whole repo')}</dd>
    <dt>District</dt><dd>${esc(p.unidad)}</dd>
    <dt>Owner</dt><dd>${due ? `${esc(due.usuario)} · ${esc(due.oficio)}` : esc(p.dueno ?? 'no owner')}</dd>
    <dt>Capital</dt><dd>${p.pisos | 0} landed ${plural(p.pisos | 0, 'PR')}${(p.hermanas ?? 1) > 1 ? ' *' : ''}</dd>
    <dt>Open</dt><dd>${p.andamios | 0} ${plural(p.andamios | 0, 'scaffold')}${p.andamio_viejo ? ` · ${p.andamio_viejo | 0} stale` : ''}</dd>
    <dt>30 days</dt><dd>${p.actividad30 | 0} ${plural(p.actividad30 | 0, 'commit')}</dd></dl>` +
    ((p.hermanas ?? 1) > 1
      ? `<p class="aviso2">* Whole-repo figure, not this parcel:
         ${p.hermanas} parcels of <code>${esc(p.repo)}</code> share this number.
         Measuring per path needs one more API call per PR and is not done yet.</p>`
      : '');
  f.hidden = false;
}

/**
 * Escape before anything reaches innerHTML.
 *
 * Everything painted here is written by somebody else: the window name comes from
 * a hook on another person's machine, the text of a notice from the agent that
 * sent it, and a parcel's name from parcels.yml. Without this, an agent called
 * `<img onerror=...>` runs code on the screen the whole team is looking at.
 */
/** "1 floor", "2 floors". Small, but a map that says "1 floors" is a map nobody
 *  believes about anything else either. */
const plural = (n: number, palabra: string) => (n === 1 ? palabra : palabra + 's');

/**
 * A colour that came from the database, reduced to what a colour can be.
 *
 * The units are data, and data is edited by people: a value like
 * `red;background:url(x)` cannot escape a quoted attribute once escaped, but it
 * can still redefine what that attribute paints. Six hex digits or nothing.
 */
const hex = (v: unknown, pordefecto = 'c8b48a') =>
  /^[0-9a-fA-F]{3,8}$/.test(String(v ?? '')) ? String(v) : pordefecto;

const esc = (v: unknown) =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const cifra = (id: string, v: number | string) => {
  const e = document.getElementById(id);
  if (e) e.textContent = String(v);
};

/**
 * What the whole city spent. Deliberately one number: the reports arrive per
 * person because that is the only way to deduplicate them, but nothing here
 * splits them back out. A leaderboard would change what people do, and what
 * this map is for is the opposite of that.
 *
 * Hidden until somebody reports, so a city that has never run bin/tokens.py
 * shows nothing rather than a confident zero.
 */
type Gasto = {
  hoy?: { tokens?: number; cache?: number; gente?: number };
  mes?: { tokens?: number; cache?: number };
};

const corto = (n: number) =>
  n >= 1e9
    ? (n / 1e9).toFixed(1).replace(/\.0$/, '') + 'B'
    : n >= 1e6
      ? (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M'
      : n >= 1e3
        ? Math.round(n / 1e3) + 'k'
        : String(n);

function gastoHUD(g?: Gasto) {
  const caja = document.getElementById('gasto') as HTMLElement | null;
  if (!caja) return;
  const hoy = g?.hoy?.tokens ?? 0,
    mes = g?.mes?.tokens ?? 0;
  if (!hoy && !mes) {
    caja.hidden = true;
    return;
  }
  caja.hidden = false;
  cifra('g-hoy', corto(hoy));
  cifra('g-mes', corto(mes) + ' tokens');
  const cache = g?.mes?.cache ?? 0;
  cifra('g-cache', mes ? Math.round((cache / (mes + cache)) * 100) + '%' : '—');
  const gente = g?.hoy?.gente ?? 0;
  const t = caja.querySelector('.gt span');
  if (t)
    t.textContent = gente
      ? `tokens spent today, across ${gente} ${gente === 1 ? 'person' : 'people'}`
      : 'tokens spent today, whole city';
}

/**
 * The shapes the API speaks, translated to the ones the map speaks — in one
 * place, at the door.
 *
 * The square returns `user`, `agent`, `window`, `parcel`; the drawing code has
 * always used `usuario`, `agente`, `ventana`, `parcela`. Nothing complained:
 * every field simply arrived undefined, so the live view drew nobody at all
 * while the replay — which builds its own objects — worked perfectly. That is
 * the worst kind of bug, and the fix is to have exactly one place where the two
 * vocabularies meet instead of hoping every call site remembers.
 */
const deLuz = (l: any) => ({
  usuario: l.usuario ?? l.user,
  agente: l.agente ?? l.agent,
  desde: l.since ?? l.desde,
});
const deObrero = (o: any) => ({
  id: o.id,
  usuario: o.usuario ?? o.user,
  ventana: o.ventana ?? o.window,
  parcela: o.parcela ?? o.parcel,
});
const deCarta = (n: any) => ({
  de: n.de ?? n.from,
  a: n.a ?? n.to,
  etiqueta: n.etiqueta ?? n.tag,
  texto: n.texto ?? n.text,
  ts: n.ts,
});

function vivo() {
  const punto = document.getElementById('punto')!,
    conex = document.getElementById('conex')!;
  let ws: WebSocket,
    espera = 1000;
  const conecta = () => {
    ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
    ws.onopen = () => {
      punto.classList.add('on');
      conex.textContent = 'live';
      espera = 1000;
    };
    ws.onclose = () => {
      punto.classList.remove('on');
      conex.textContent = 'reconnecting…';
      setTimeout(conecta, (espera = Math.min(espera * 2, 20000)));
    };
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.t === 'state') {
        conectados((m.lights ?? []).map(deLuz));
        cuadrilla((m.workers ?? []).map(deObrero));
        cartas((m.notices ?? []).map(deCarta));
      } else if (m.t === 'change' && m.ev.t === 'notice') {
        const notice = deCarta({ ...m.ev, ts: '' });
        cartas([notice], true);
        showActivity({
          protocol: 'agents-city-activity/1',
          id: `notice-${Date.now()}`,
          seq: 0,
          city: 'map',
          thread: null,
          kind: 'conversation.agent',
          actor: String(notice.de || ''),
          role: 'member',
          phase: 'answered',
          tone: 'evidence',
          title: `${notice.de} sent a notice`,
          summary: String(notice.texto || ''),
          details: [],
          target: String(notice.a || ''),
          at: new Date().toISOString(),
        });
      } else if (m.t === 'change') repasa();
    };
  };
  const repasa = () =>
    fetch('/api/state')
      .then((r) => r.json())
      .then((d: any) => {
        conectados((d.lights ?? []).map(deLuz));
        cuadrilla((d.workers ?? []).map(deObrero));
      })
      .catch(() => {});
  setInterval(repasa, 20000);
  conecta();
}

/**
 * Who has a session open on the bus. Different from digging: this is who is
 * *there*, even if they have not touched a file. Anyone with no work started
 * waits in the square; the moment they start, their worker appears at the house.
 */
let ultimasLuces: any[] = [];
function conectados(luces: any[]) {
  ultimasLuces = luces;
  cifra('c-conectados', luces.length);

  // The strip is decoration; the map is not. A throw in here used to take the
  // whole live update with it — the count updated, the crew never did.
  try {
    cintaDelBus(luces);
  } catch (e) {
    console.error('city: ticker', e);
  }
  reparteEnPlaza();
}

/**
 * The ticker at the top: who is on the bus right now.
 *
 * A strip that slides rather than a list that sits still, because this is the
 * one thing on screen that changes by itself — somebody opens a session and they
 * are there. The content is written twice so the loop has no seam, and the
 * duration comes from how much there is to say, so three people scroll slowly
 * and thirty scroll at the same speed rather than three times faster.
 */
function cintaDelBus(luces: any[]) {
  const tira = document.getElementById('tira');
  if (!tira) return;
  if (!luces.length) {
    tira.style.animation = 'none';
    tira.innerHTML =
      '<span class="nadie">Nobody on the bus right now — ' +
      'open a session with the city plugin and you appear here</span>';
    return;
  }
  const uno = (l: any) => {
    const p = personas.find((x) => x.usuario === l.usuario);
    const col = '#' + colorDe(l.usuario).toString(16).padStart(6, '0');
    const donde = [...enObra.entries()].find(([id]) => id.startsWith(l.usuario + '/'));
    const casa = donde ? casas.get(donde[1].parcela)?.p.nombre : '';
    // Every name on the tape is a door: click it and you get who they are and
    // what they are trying to do.
    return (
      `<span class="uno" data-u="${esc(l.usuario)}" role="button" tabindex="0">` +
      `<span class="pip" style="background:${esc(col)}"></span>` +
      `<span>${esc(l.agente)}</span>` +
      (p?.oficio ? `<span class="of2">${esc(p.oficio)}</span>` : '') +
      (casa ? `<span class="en">· ${esc(casa)}</span>` : '') +
      `</span>`
    );
  };
  const fila = luces.map(uno).join('');
  tira.innerHTML = fila + fila; // twice: the loop has no seam
  // Anybody on the tape can be clicked: it is the fastest route to "who is this
  // and what are they trying to do", which is the question the strip provokes.
  tira.onclick = (e) => {
    const n = (e.target as HTMLElement).closest('[data-u]') as HTMLElement | null;
    if (n?.dataset.u) fichaPersona(n.dataset.u);
  };
  tira.style.animation = `desliza ${Math.max(14, luces.length * 6)}s linear infinite`;
}

/** Only people who are connected with no work started stay in the square. */
function reparteEnPlaza() {
  const conObra = new Set([...enObra.values()].map(() => '')); // se rellena abajo
  const ocupados = new Set<string>();
  for (const [id] of enObra) ocupados.add(id.split('/')[0]);

  const deben = ultimasLuces.filter((l) => !ocupados.has(l.usuario));
  for (const [u, c] of enPlaza) {
    if (!deben.some((l) => l.usuario === u)) {
      c.parent?.removeChild(c);
      enPlaza.delete(u);
    }
  }
  deben.forEach((l, i) => {
    if (enPlaza.has(l.usuario)) return;
    const p = personas.find((x) => x.usuario === l.usuario);
    // El arquitecto tiene su propia figura: no pica y no lleva cuadrilla.
    const fig =
      p?.rol === 'cpto' ? arquitecto(l.usuario) : perito(l.usuario, p?.oficio ?? 'on the bus');
    // Spread around the square, with labels at staggered heights: five figures in
    // a small ellipse with every label at the same height is a smudge.
    const ang = (i / Math.max(5, deben.length)) * Math.PI * 2 - Math.PI / 2;
    fig.position.set(plaza.x + Math.cos(ang) * 104, plaza.y + Math.sin(ang) * 34 + 10);
    const cartel = (fig as any).__cartel;
    if (cartel) cartel.y -= (i % 3) * 15;
    capaGente.addChild(fig);
    enPlaza.set(l.usuario, fig);
  });
}
/** Reconcile the workers and foremen on screen with what the square reports. */
let ultimosObreros: any[] = [];
/**
 * The mark on the plot somebody is digging in, in their colour.
 *
 * Without it a figure standing near a building is just a figure standing near a
 * building: at any zoom where more than one house fits on screen, you cannot
 * tell which one they are working on. The ring is drawn on the ground under the
 * house, beneath the house itself, so the building still occludes it the way it
 * occludes everything else.
 */
const marcas = new Map<string, Container>();
function marca(id: string, c: CasaViva, usuario: string) {
  quitaMarca(id);
  const col = colorDe(usuario);
  const g = new Graphics()
    .poly([0, 0, TW / 2, TH / 2, 0, TH, -TW / 2, TH / 2])
    .fill({ color: col, alpha: 0.13 })
    .poly([0, 0, TW / 2, TH / 2, 0, TH, -TW / 2, TH / 2])
    .stroke({ color: col, width: 1.4, alpha: 0.85 });
  const cont = new Container();
  cont.addChild(g);
  cont.position.set(c.g.x, c.g.y);
  const padre = c.g.parent!;
  padre.addChildAt(cont, Math.max(0, padre.getChildIndex(c.g)));
  marcas.set(id, cont);

  let t = 0;
  anima((dt) => {
    if (!cont.parent) return false;
    t += 0.05 * dt;
    g.alpha = 0.75 + Math.sin(t) * 0.25; // a slow breath, not a blink
    return true;
  });
}
function quitaMarca(id: string) {
  const m = marcas.get(id);
  if (m) {
    m.parent?.removeChild(m);
    m.destroy({ children: true });
    marcas.delete(id);
  }
}

function cuadrilla(lista: any[]) {
  ultimosObreros = lista;
  cifra('c-luces', lista.length);
  panel(lista);

  const vistos = new Set<string>();
  for (const o of lista) {
    vistos.add(o.id);
    const c = casas.get(o.parcela);
    if (!c) continue;
    const ya = enObra.get(o.id);
    if (ya && ya.parcela === o.parcela) continue;
    const cuantos = [...enObra.values()].filter(
      (x) => x.parcela === o.parcela && x.c !== ya?.c,
    ).length;
    const b = c.g.parent!;
    const destino = {
      x: b.x + c.g.x - TW * 0.24 + cuantos * 13,
      y: b.y + c.g.y + TH * 0.66 + cuantos * 5,
    };
    if (ya) {
      anda(ya.c, destino);
      enObra.set(o.id, { c: ya.c, parcela: o.parcela });
    } else {
      const fig = obrero(o.usuario, o.ventana, cuantos);
      fig.position.set(destino.x, destino.y);
      abrochaCara(fig, o.ventana);
      capaGente.addChild(fig);
      enObra.set(o.id, { c: fig, parcela: o.parcela });
      late(c.g);
    }
    marca(o.id, c, o.usuario);
  }
  for (const [id, x] of enObra)
    if (!vistos.has(id)) {
      x.c.parent?.removeChild(x.c);
      enObra.delete(id);
      quitaMarca(id);
    }

  // One foreman per person with a crew, next to the house holding most of them.
  const por = new Map<string, any[]>();
  for (const o of lista) {
    (por.get(o.usuario) ?? por.set(o.usuario, []).get(o.usuario)!).push(o);
  }
  for (const [u, c] of peritos)
    if (!por.has(u)) {
      c.parent?.removeChild(c);
      peritos.delete(u);
    }
  for (const [u, ags] of por) {
    const p = personas.find((x) => x.usuario === u);
    if (!p || p.rol === 'cpto') continue;
    const ref = casas.get(ags[0].parcela);
    if (!ref) continue;
    const b = ref.g.parent!;
    // Outside the plot and in front: next to a house, their label eats the labels
    // of their own workers. A foreman does not dig, so they need not be inside.
    // In front of the block and to its side, in plot coordinates — the district
    // metrics are its grid now, not a screen box, and reading the old ones gave
    // every foreman a position of NaN.
    const m = (b as any).__m;
    const hueco = Math.max(0, [...peritos.keys()].indexOf(u));
    const esq = iso(-1.2 * PASO, (m.filas + 0.2) * PASO);
    const pos = { x: b.x + esq.x + hueco * 8, y: b.y + esq.y + 16 + hueco * 16 };
    const ya = peritos.get(u);
    if (ya) {
      anda(ya, pos);
      continue;
    }
    const fig = perito(u, p.oficio, ags.length);
    fig.position.set(pos.x, pos.y);
    capaGente.addChild(fig);
    peritos.set(u, fig);
  }
  reparteEnPlaza();
  carteles(escalaActual);
}

/** Somebody walking to where they are working now. */
function anda(fig: Container, a: { x: number; y: number }) {
  const de = { x: fig.x, y: fig.y };
  const d = Math.hypot(a.x - de.x, a.y - de.y);
  if (d < 2) {
    fig.position.set(a.x, a.y);
    return;
  }
  const paso = 1 / Math.max(28, Math.min(110, d / 3));
  let t = 0;
  anima((dt) => {
    t = Math.min(1, t + paso * dt);
    const s = t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t);
    fig.x = de.x + (a.x - de.x) * s;
    // A slight hop, so a figure crossing the map reads as walking and not sliding.
    fig.y = de.y + (a.y - de.y) * s - Math.sin(s * Math.PI) * 10;
    if (t >= 1) {
      fig.position.set(a.x, a.y);
      return false;
    }
    return true;
  });
}

/** A ring on a plot: something just happened here, look. */
function late(g: Container) {
  const anillo = new Graphics()
    .poly([0, 0, TW / 2, TH / 2, 0, TH, -TW / 2, TH / 2])
    .stroke({ color: 0xf5c451, width: 2, alpha: 0.9 });
  g.addChild(anillo);
  let t = 0;
  anima((dt) => {
    t += 0.03 * dt;
    anillo.alpha = Math.max(0, 0.9 - t);
    anillo.scale.set(1 + t * 0.7);
    if (t > 1) {
      anillo.parent?.removeChild(anillo);
      anillo.destroy();
      return false;
    }
    return true;
  });
}

function panel(lista: any[]) {
  const ul = document.getElementById('cuadrillas')!;
  if (!lista.length) {
    ul.innerHTML = '<li class="vacio">Nobody digging right now</li>';
    return;
  }
  const por = new Map<string, any[]>();
  for (const o of lista) {
    (por.get(o.usuario) ?? por.set(o.usuario, []).get(o.usuario)!).push(o);
  }
  ul.innerHTML = '';
  for (const [u, ags] of [...por].sort((a, b) => b[1].length - a[1].length)) {
    const p = personas.find((x) => x.usuario === u);
    const col = '#' + colorDe(u).toString(16).padStart(6, '0');
    const li = document.createElement('li');
    li.innerHTML =
      `<div class="quien"><span class="pip" style="background:${esc(col)}"></span>${esc(u)}
      <span class="of">${esc(p?.oficio ?? '')}</span><span class="cuantos">×${ags.length | 0}</span></div>` +
      ags
        .map((a) => {
          const c = casas.get(a.parcela);
          return `<div class="ag"><span class="an">/${esc(a.ventana)}</span><span class="do">${esc(c ? c.p.nombre : a.parcela)}</span></div>`;
        })
        .join('');
    ul.appendChild(li);
  }
}

function cartas(cs: any[], anadir = false) {
  const ul = document.getElementById('tt')!;
  // Colours by property, not by unit: a tag does not belong to any district.
  const COL: Record<string, string> = {
    data: 'var(--carta)',
    ux: '#8f7ae6',
    security: 'var(--lampara)',
    cost: '#3fb8a0',
    product: '#e08a3c',
    llm: '#4a9ede',
  };
  const pinta = (c: any) => {
    const li = document.createElement('li');
    const dia = String(c.ts ?? '').slice(0, 10);
    // The tag is not interpolated into the colour: it selects from a whitelist.
    // An invented tag paints as text, in the default colour.
    li.innerHTML =
      `<div class="cab">` +
      `<span class="etq" style="color:${COL[c.etiqueta] ?? 'var(--tinta2)'}">${esc(c.etiqueta ?? 'notice')}</span>` +
      `<span class="de">${esc(c.de)} → ${esc(c.a)}</span>` +
      `<span class="cuando">${esc(dia)}</span>` +
      `</div><div class="cuerpo">${esc(c.texto ?? '')}</div>`;
    return li;
  };
  if (!anadir) ul.innerHTML = '';
  for (const c of cs) anadir ? ul.prepend(pinta(c)) : ul.appendChild(pinta(c));
  // A feed, not a ticker: there is a column for these now, so they are worth
  // keeping. Sixty is about a screenful and a half of scrollback.
  while (ul.children.length > 60) ul.lastChild!.remove();
  const vacio = document.getElementById('tt-vacio');
  if (vacio) vacio.hidden = ul.children.length > 0;
  // The count lives in this column's header now. It was also a tile in the left
  // sidebar, which meant the same number in two places and the notices reading
  // as if they were in both.
  const n = ul.children.length;
  cifra('c-cartas', n ? `${n}` : '');
}

/* ── The replay ─────────────────────────────────────────────────────────────
 * Rewinds the city day by day. A house's floors on 3 March is how much had landed
 * by 3 March, so the history is computed by accumulating over a base and there is
 * no need to store a snapshot per day.
 *
 * Painting a day redraws the house: it changes model when it changes bracket, and
 * watching a two-storey building turn into a tower is exactly the point.
 */
interface Peli {
  desde: string;
  hasta: string;
  limites: { primero?: string; ultimo?: string };
  base: [string, number][];
  dias: [string, [string, number][]][];
  avisos: [string, string, string, string, string][]; // day, from, to, tag, text
}
let peli: Peli | null = null;
let indice = -1;
let reproduciendo = false;
let reloj: number | undefined;

async function cargaPeli(desde?: string, hasta?: string) {
  const q = new URLSearchParams();
  if (desde) q.set('desde', desde);
  if (hasta) q.set('hasta', hasta);
  try {
    peli = await (await fetch(`/api/historia?${q}`)).json();
  } catch {
    return;
  }
  if (!peli?.dias?.length) return;

  const barra = document.getElementById('peli')!;
  barra.hidden = false;
  const d = document.getElementById('desde') as HTMLInputElement;
  const h = document.getElementById('hasta') as HTMLInputElement;
  d.value = peli.desde;
  h.value = peli.hasta;
  if (peli.limites.primero) {
    d.min = peli.limites.primero;
    h.min = peli.limites.primero;
  }
  if (peli.limites.ultimo) {
    d.max = peli.limites.ultimo;
    h.max = peli.limites.ultimo;
  }

  const r = document.getElementById('dia') as HTMLInputElement;
  r.max = String(peli.dias.length - 1);
  r.value = r.max;
  pintaDia(peli.dias.length - 1);
}

/** Each parcel's floors at the end of day `hasta` of the range. */
function capitalEn(hasta: number): Map<string, number> {
  const acc = new Map<string, number>(peli!.base);
  for (let i = 0; i <= hasta; i++) {
    for (const [parcela, n] of peli!.dias[i][1]) {
      acc.set(parcela, (acc.get(parcela) ?? 0) + n);
    }
  }
  return acc;
}

/**
 * The replay is not a bar chart that grows. What makes it worth watching is the
 * activity: somebody digging where work landed that day, a letter crossing the
 * city, a floor popping up with dust. All of it derived from the same history —
 * nothing invented at render time.
 */
function pintaDia(i: number) {
  if (!peli) return;
  indice = i;
  const acc = capitalEn(i);
  const ultimo = i >= peli.dias.length - 1 && peli.hasta >= (peli.limites.ultimo ?? peli.hasta);
  if (!ultimo) vidaDelDia(i);

  if (ultimo) repasaEnVivo();
  for (const [id, c] of casas) {
    const capital = ultimo ? c.p.pisos : (acc.get(id) ?? 0);
    // A parcel with nothing landed yet leaves the plot empty: a house that
    // APPEARS tells "something started here" better than one that was always up.
    const datos = {
      ...c.p,
      pisos: capital,
      andamios: ultimo ? c.p.andamios : 0,
      andamio_viejo: ultimo ? c.p.andamio_viejo : 0,
      actividad30: ultimo ? c.p.actividad30 : capital > 0 ? 2 : 0,
    };
    // What is drawn on top of the house — scaffolding, crane, crack, lights —
    // and whether there is a house at all. Height is deliberately not in here:
    // height is what gets animated, everything else is what forces a redraw.
    const adorno = [
      capital > 0,
      datos.andamios,
      datos.andamio_viejo,
      datos.grieta,
      datos.actividad30 > 0,
    ].join('|');
    if (c.dibujado === capital && c.adorno === adorno) continue;

    if (c.adorno === adorno && c.h?.sp && c.dibujado !== undefined && capital > 0) {
      // The house is already there and only its capital moved: grow it. Rebuilding
      // it — which is what this did before — meant the same sprite was destroyed
      // and recreated once per day, and the city read as flickering rather than
      // growing.
      const gano = capital - c.dibujado;
      subeHasta(c, capital, gano > 0);
      if (gano > 0 && !ultimo) burbuja(c, gano);
      c.dibujado = capital;
      continue;
    }

    const col = COLOR[c.p.unidad] ?? COLOR_POR_DEFECTO;
    const padre = c.g.parent!,
      px = c.g.x,
      py = c.g.y,
      z = padre.getChildIndex(c.g);
    padre.removeChild(c.g);
    const h = capital === 0 && !ultimo ? undefined : casa(col, datos, c.p.id);
    const nuevo = h ? h.g : new Container();
    nuevo.position.set(px, py);
    nuevo.eventMode = 'static';
    nuevo.cursor = 'pointer';
    nuevo.on('pointertap', () => ficha(c.p));
    padre.addChildAt(nuevo, Math.min(z, padre.children.length));
    // A house that appears deserves to be seen appearing: it rises out of the
    // plot with dust at its feet.
    if (!ultimo && h && c.dibujado === 0) {
      brota(h);
      if (capital > 0) burbuja({ ...c, g: nuevo, h }, capital);
    }
    c.g = nuevo;
    c.h = h;
    c.dibujado = capital;
    c.adorno = adorno;
  }
  rotula(acc, ultimo);
}

/**
 * Take a house to the height its capital asks for, over about a third of a
 * second, and kick up dust if it went up.
 *
 * The one place where growth is expressed. Both the replay and the live map call
 * it, which is why the easing and the overshoot live here and not at either call
 * site: a building that grows differently depending on who asked would read as
 * two different maps.
 */
function subeHasta(c: CasaViva, pisos: number, arriba: boolean) {
  const h = c.h;
  if (!h?.sp || !h.medida || !h.escala) return;
  // Outgrown its shape? Put it in a bigger building first, at the size it has
  // now, and let the tween below take it the rest of the way.
  reviste(h, c.p.id, pisos, c.p.clase);
  const f0 = h.sp.scale.y / h.escala;
  const f1 = factorDe(pisos, h.medida);
  if (Math.abs(f1 - f0) < 0.002) return;
  const motas = arriba ? polvo(h.g) : [];
  let t = 0;
  anima((dt) => {
    // Fast enough to settle before the next day of the film lands, and with no
    // overshoot at all: a floor is a floor. The version that bounced — up a
    // little past the target and back — read as the houses oscillating, because
    // with a PR landing every quarter of a second each bounce started on top of
    // the last one. Work stacks; it does not wobble.
    t = Math.min(1, t + dt * 0.14);
    const e = 1 - Math.pow(1 - t, 3); // ease out, monotone
    h.sp!.scale.y = h.escala! * (f0 + (f1 - f0) * e);
    for (const m of motas) {
      m.y -= 0.6 * dt;
      m.alpha -= 0.02 * dt;
    }
    if (t >= 1) {
      h.sp!.scale.y = h.escala! * f1;
      for (const m of motas) {
        m.parent?.removeChild(m);
        m.destroy();
      }
      return false;
    }
    return true;
  });
}

/**
 * A bubble over a house when work lands: "+3", rising and fading.
 *
 * The floor that grew is the fact; the bubble is what makes you notice the fact.
 * Watching the replay without it, the eye reads the city as slowly inflating and
 * never sees the individual moment something shipped — which is the moment the
 * whole map exists to show.
 */
function burbuja(c: CasaViva, cuantos: number) {
  const col = COLOR[c.p.unidad] ?? COLOR_POR_DEFECTO;
  const g = new Container();
  const alto = c.h?.alto ?? 40;

  const texto = new Text({
    text: `+${cuantos}`,
    style: new TextStyle({
      fontFamily: 'Chakra Petch, sans-serif',
      fontSize: 12,
      fontWeight: '700',
      fill: 0x131a24,
    }),
  });
  texto.anchor.set(0.5);
  const ancho = texto.width + 12;
  const chapa = new Graphics()
    .roundRect(-ancho / 2, -9, ancho, 18, 9)
    .fill({ color: tono(col, 0.45) })
    .roundRect(-ancho / 2, -9, ancho, 18, 9)
    .stroke({ color: 0x131a24, width: 1, alpha: 0.25 });
  g.addChild(chapa, texto);
  g.position.set((c.g.parent?.x ?? 0) + c.g.x, (c.g.parent?.y ?? 0) + c.g.y - alto - 14);
  capaGente.addChild(g);

  let t = 0;
  anima((dt) => {
    t = Math.min(1, t + 0.022 * dt);
    // Up and settling, not a straight rise: it should read as something popping
    // out of the building, not as a balloon let go.
    g.y -= (1 - t) * 0.9 * dt;
    g.scale.set(t < 0.18 ? 0.6 + t * 2.2 : 1);
    g.alpha = t > 0.7 ? (1 - t) / 0.3 : 1;
    if (t >= 1) {
      g.parent?.removeChild(g);
      g.destroy({ children: true });
      return false;
    }
    return true;
  });
}

/** A house appearing on an empty plot: it rises from nothing, with dust. */
function brota(h: Casa) {
  const motas = polvo(h.g);
  const y0 = h.sp ? h.sp.scale.y : 0;
  if (h.sp) h.sp.scale.y = y0 * 0.06;
  let t = 0;
  anima((dt) => {
    t = Math.min(1, t + dt * 0.06);
    const e = 1 - Math.pow(1 - t, 3);
    if (h.sp) h.sp.scale.y = y0 * (0.06 + 0.94 * e);
    else h.g.scale.set(1, 0.2 + 0.8 * e);
    for (const m of motas) {
      m.y -= 0.6 * dt;
      m.alpha -= 0.02 * dt;
    }
    if (t >= 1) {
      if (h.sp) h.sp.scale.y = y0;
      else h.g.scale.set(1, 1);
      for (const m of motas) {
        m.parent?.removeChild(m);
        m.destroy();
      }
      return false;
    }
    return true;
  });
}

/** Who was working that day, and which letters crossed the city. */
/** Notices already in the column, so scrubbing does not add them twice. */
const yaContadas = new Set<string>();

function vidaDelDia(i: number) {
  if (!peli) return;
  const [dia, activas] = peli.dias[i];
  // The camera watches the trailing week, not the single day: day-by-day
  // centroids ping-pong between districts, a week's worth is a stable, honest
  // shot of where the work is. The workers and bubbles below stay strictly
  // daily — only the framing takes the long view.
  const enCuadro = new Set<string>();
  for (let j = Math.max(0, i - 5); j <= i; j++) {
    for (const [pid] of peli.dias[j][1]) enCuadro.add(pid);
  }
  miraLaAccion([...enCuadro]);

  // Workers where something landed that day, standing at that house. The person
  // is the parcel's owner when it has one — the map does not invent who did what.
  const trabajando: any[] = [];
  for (const [pid] of activas.slice(0, 14)) {
    const c = casas.get(pid);
    if (!c) continue;
    const quien = c.p.dueno || '—';
    trabajando.push({
      id: `${quien}/${pid}`,
      usuario: quien,
      ventana: pid.split(':')[0],
      parcela: pid,
    });
  }
  cuadrilla(trabajando);
  // The ticker follows the film too: during a replay it carries the people who
  // worked that day. Otherwise the strip says "nobody on the bus" over a city
  // visibly full of people, which is the map contradicting itself on screen.
  cintaDelBus(trabajando.map((t) => ({ usuario: t.usuario, agente: `${t.usuario}/${t.ventana}` })));

  // And the letters of that day, flying from sender to recipient.
  // The film's notices pile up in the column as they happen, newest first, and
  // each one lands once however many times you scrub over its day — a feed that
  // repeats itself is a feed nobody reads. The live ones replace them when the
  // playhead reaches the present.
  const delDia = peli.avisos
    .filter(([d]) => d === dia)
    .map(([d, de, para, etq, texto]) => ({ de, a: para, etiqueta: etq, texto, ts: d }));
  const nuevos = delDia.filter((c) => {
    const k = `${c.ts}|${c.de}|${c.a}|${c.texto}`;
    if (yaContadas.has(k)) return false;
    yaContadas.add(k);
    return true;
  });
  if (nuevos.length) cartas(nuevos, true);
  for (const c of nuevos) volando(c.de, c.a, c.etiqueta);
}

/**
 * A letter crossing the city, from the sender's house to the recipient's.
 *
 * Drawn between houses and not between people on purpose: what a notice says is
 * "this change touched your property", and the change has a place.
 */
function volando(de: string, para: string, etiqueta: string) {
  const casaDe = [...casas.values()].find((c) => c.p.dueno === de);
  const casaA = [...casas.values()].find((c) => c.p.dueno === para);
  const COL: Record<string, number> = {
    data: 0xe2604f,
    ux: 0x8f7ae6,
    security: 0xf5c451,
    cost: 0x3fb8a0,
    product: 0xe08a3c,
    llm: 0x4a9ede,
  };
  const col = COL[etiqueta] ?? 0xe8e2d4;
  const donde = (c: CasaViva) => ({
    x: (c.g.parent?.x ?? 0) + c.g.x,
    y: (c.g.parent?.y ?? 0) + c.g.y,
  });

  if (casaDe && casaA && casaDe !== casaA) {
    vueloDeCarta(donde(casaDe), donde(casaA), col);
    return;
  }
  // One end of this letter is not in this city: it enters or leaves by a gate.
  // The map draws its own city and nothing else — the other city exists here
  // exactly as the seat knows it, as an address over an arch.
  if (casaDe && !casaA) {
    const puerta = puertas?.puerta(para);
    if (!puerta) return;
    vueloDeCarta(donde(casaDe), { x: puerta.x - 4, y: puerta.y - 18 }, col, () =>
      puertas?.vuela(puerta, col, true),
    );
    return;
  }
  if (!casaDe && casaA) {
    const puerta = puertas?.puerta(de);
    if (!puerta) return;
    const destino = donde(casaA);
    puertas?.vuela(puerta, col, false);
    vueloDeCarta({ x: puerta.x - 4, y: puerta.y - 18 }, destino, col);
  }
}

/** The letter itself: sender to recipient, in an arc, with its wobble. */
function vueloDeCarta(
  p0: { x: number; y: number },
  p1: { x: number; y: number },
  col: number,
  alLlegar?: () => void,
) {
  const carta = new Graphics()
    .rect(-4, -3, 8, 6)
    .fill({ color: 0xf2ecdd })
    .rect(-4, -3, 8, 2)
    .fill({ color: col });
  const estela = new Graphics().circle(0, 0, 5).fill({ color: col, alpha: 0.16 });
  const g = new Container();
  g.addChild(estela, carta);
  capaGente.addChild(g);

  let t = 0;
  anima((dt) => {
    t += 0.022 * dt;
    const s = t < 1 ? t : 1;
    g.x = p0.x + (p1.x - p0.x) * s;
    // An arc, so it reads as flying and not sliding along the ground.
    g.y = p0.y + (p1.y - p0.y) * s - Math.sin(s * Math.PI) * 46;
    g.alpha = alLlegar ? 1 : s > 0.85 ? (1 - s) / 0.15 : 1;
    carta.rotation = Math.sin(t * 6) * 0.25;
    if (t >= 1) {
      g.parent?.removeChild(g);
      g.destroy({ children: true });
      alLlegar?.();
      return false;
    }
    return true;
  });
}

function rotula(acc: Map<string, number>, ultimo: boolean) {
  if (!peli) return;
  const [dia] = peli.dias[indice];
  // The total counts ONCE per repo, not per parcel: every parcel of a repo
  // inherits the whole repo's count, so summing them multiplied the total by the
  // number of parcels. Take the largest of each repo.
  const porRepo = new Map<string, number>();
  let conObra = 0;
  for (const [id, v] of acc) {
    const c = casas.get(id);
    if (!c) continue;
    if (v > 0) conObra++;
    const repo = c.p.repo;
    porRepo.set(repo, Math.max(porRepo.get(repo) ?? 0, v));
  }
  let total = 0;
  for (const v of porRepo.values()) total += v;
  const f = new Date(dia + 'T00:00:00Z');
  document.getElementById('diaTexto')!.textContent =
    f.toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    }) + (ultimo ? ' · today' : '');
  document.getElementById('diaDato')!.textContent =
    `${total.toLocaleString('en-GB')} ${plural(total, 'floor')} · ` +
    `${conObra} ${plural(conObra, 'parcel')} under work`;
}

/** Back to the present: the people on screen are the real ones again. */
function repasaEnVivo() {
  if (!camara.tuyo) encaja(appGlobal!, false); // back to the whole city
  fetch('/api/state')
    .then((r) => r.json())
    .then((d: any) => {
      conectados((d.lights ?? []).map(deLuz));
      cuadrilla((d.workers ?? []).map(deObrero));
      // The notices too: leaving the replay's on screen next to the live workers
      // is the map claiming something happened today that happened in 2024.
      cartas((d.notices ?? []).map(deCarta));
    })
    .catch(() => {});
}

/**
 * Play tells the story from the beginning.
 *
 * It used to start wherever the playhead happened to be — which, on a fresh
 * load, is today: you pressed play and watched a finished city do nothing. Play
 * now means "build this city in front of me", so it loads the whole history and
 * starts at day one. Anybody who wants a slice still has the two date fields,
 * and pressing play inside a slice plays that slice.
 */
function reproduce() {
  if (!peli) return;
  if (reproduciendo) {
    para();
    return;
  }

  const desdeElPrincipio = indice >= peli.dias.length - 1;
  const todaLaHistoria = peli.desde === (peli.limites.primero ?? peli.desde);
  if (desdeElPrincipio && !todaLaHistoria) {
    // At the end, and looking at a slice: rewind to the whole story.
    cargaPeli(peli.limites.primero, peli.limites.ultimo).then(() => empieza(0));
    return;
  }
  empieza(desdeElPrincipio ? 0 : indice);
}

function para() {
  reproduciendo = false;
  clearInterval(reloj);
  document.getElementById('play')!.textContent = '▶';
}

/** Run the film from this day on, one day every 260 ms. */
function empieza(desde: number) {
  if (!peli) return;
  if (desde === 0) {
    yaContadas.clear();
    cartas([]);
  }
  reproduciendo = true;
  document.getElementById('play')!.textContent = '❙❙';
  const barra = document.getElementById('dia') as HTMLInputElement;
  indice = desde;
  barra.value = String(desde);
  pintaDia(desde);
  clearInterval(reloj);
  reloj = setInterval(() => {
    if (!peli) return para();
    if (indice >= peli.dias.length - 1) return para();
    barra.value = String(indice + 1);
    pintaDia(indice + 1);
  }, 260) as unknown as number;
}

document.getElementById('play')?.addEventListener('click', reproduce);
document.getElementById('dia')?.addEventListener('input', (e) => {
  if (reproduciendo) para();
  pintaDia(Number((e.target as HTMLInputElement).value));
});
for (const id of ['desde', 'hasta']) {
  document.getElementById(id)?.addEventListener('change', () => {
    if (reproduciendo) para();
    for (const [, c] of casas) c.dibujado = undefined;
    cargaPeli(
      (document.getElementById('desde') as HTMLInputElement).value,
      (document.getElementById('hasta') as HTMLInputElement).value,
    );
  });
}

/** Close the card. Three ways in, one way out, and it used to have none: the
 *  close handler was wired to a button that was never in the page. */
function cierraFicha() {
  const f = document.getElementById('ficha');
  if (f) f.hidden = true;
}
document.getElementById('cerrar')?.addEventListener('click', cierraFicha);
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') cierraFicha();
});
arranca();
