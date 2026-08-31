/* The town hall's front end.
 *
 * Typed and built by the same esbuild and the same `tsc --strict` as the map,
 * because the first version was 400 lines of untyped template literals inline in
 * the HTML — and it shipped broken once, on an escaped apostrophe the compiler
 * would have caught before any browser saw it.
 *
 * It builds to dist-hall/, not dist/: dist/ is what the deployed Worker serves to
 * the active city, and the hall is local by design — it drives an API that writes
 * this machine's disk. The Python server (bin/serve.py) is the only thing that
 * ever serves this file.
 */

import './es'; // the Spanish dictionary registers itself on import
import { FormularioDeCasa } from './casa';
import { confirma, pregunta } from './dialogo';
import { Demos } from './demo';
import * as desconectado from './desconectado';
import type { Vista } from './vista';
import { Explorador } from './explorador';
import { idioma, plural, ponIdioma, t as _ } from './idioma';
import {
  ESFUERZOS,
  NIVEL_ESFUERZO,
  RUNTIMES,
  motorDe,
  nivelDeMotor,
  opciones as opcionesDe,
} from './motores';
import { Bienvenida } from './bienvenida';
import {
  ActivityEvent,
  MAP_ACTIVITY_PROTOCOL,
  isActivityEvent as esActividad,
  isMapNavMessage as esNavDeMapa,
  isPresenceEvent,
  isSpeechEvent,
} from './activity';

// ── what the API answers ─────────────────────────────────────────────────────
interface Objetivo {
  user?: string;
  title: string;
  signal: string;
  command: string;
  manual?: string;
  baseline: string;
  target: string;
  by: string;
}
interface Tarjeta {
  user: string;
  name: string;
  role: string;
  agent: string;
  repos: string[];
  repo_roles: Record<string, string>;
  goals_defined: boolean;
  objetivo: Objetivo | null;
}
interface Unidad {
  id: string;
  name: string;
  color: string;
}
interface ParcelaFila {
  id: string;
  repo: string;
  ruta: string;
  unidad: string;
  nombre: string;
}
interface Color {
  hex: string;
  nombre: string;
}
interface Ciudad {
  ruta: string;
  nombre: string;
  slug?: string;
  id?: string;
  actual: boolean;
  /** How many agents live in it. An agent belongs to exactly one city. */
  agentes?: number;
}
interface Road {
  id: string;
  name: string;
  owner: string;
  address: string;
  local?: boolean;
  domain?: string;
  role?: string;
}
interface ReceptionSummary {
  pending: number;
  pendingBytes: number;
  routingMode: 'manual' | 'auto';
  reviewPolicy: 'every_message' | 'new_thread';
  routerProfile: string | null;
  autoAvailable: boolean;
  error?: string;
}
interface ReceptionState {
  protocol: 'agents-city-reception/1';
  error?: string;
  settings: {
    routingMode: 'manual' | 'auto';
    reviewPolicy: 'every_message' | 'new_thread';
    routerProfile: string | null;
    autoAvailable: boolean;
    autoRules: Array<{ cityId: string; address: string; keywords: string[] }>;
  };
  summary: { pending: number; pendingBytes: number; shown: number };
  messages: Array<{
    id: string;
    from: string;
    fromName: string;
    kind: 'message' | 'rejection';
    inReplyTo: string | null;
    createdAt: string;
    receivedAt: string;
    receivedVia: string;
    text: string;
    connectionId: string | null;
    roadId: string | null;
    agentExposure: false;
  }>;
  cities: Array<{ id: string; name: string; address: string }>;
  connections: Array<{ id: string; roadId: string; name: string; connected: boolean }>;
  outbox: { queued: number };
}
interface SkillInfo {
  name: string;
  description: string;
  manifest: string;
  provider: string;
  /** Present only when this skill lives in the agent home's own
   * `.claude/skills` — the one place the Hall installs into and may remove
   * from. `dir` is the folder name removal is keyed on; the display name
   * above is the SKILL.md's word and free to differ. */
  removable?: boolean;
  dir?: string;
}
interface AgentCapabilities {
  path: string;
  role?: string;
  skills: SkillInfo[];
}
/** One agent's character sheet, as the server builds it: identity, engine and
 * growth — every number real, none invented for the card to look fuller. */
interface FichaAgente {
  name: string;
  slug: string;
  kind: string;
  role: string;
  runtime: string;
  model: string;
  effort: string;
  avatar_seed: string;
  avatar: string;
  cli: { binary: string; installed: boolean; connected: boolean };
  legacy: boolean;
  /** What this agent actually works on — repos, worktrees, document folders.
   * `fixed` is a legacy repo agent's own repo, which is not a mount it chose. */
  mounts: { label: string; target: string; fixed?: boolean }[];
  growth: { floors: number; bricks: number; activity30: number; signal: string };
}
interface Deliberation {
  id: string;
  status: string;
  question: string;
  desired_outcome: string;
  participants: string[];
  received: number;
  total: number;
  revision: number;
  decision: string;
  contributors: string[];
  verifier: string;
  verification: string;
  updated_at: string;
  act: string;
}
interface LiveBus {
  online: boolean;
  url: string;
  city: string;
  started_at: string;
}
interface Invitation {
  version: number;
  id: string;
  name: string;
  owner: string;
  address: string;
  domain: string;
  role?: string;
}
interface Estado {
  datos: string;
  casa: string;
  yo: string;
  address: string;
  city_id: string;
  city_name: string;
  domain: string;
  kind: string;
  grow: string;
  tarjetas: Tarjeta[];
  unidades: Unidad[];
  parcelas: ParcelaFila[];
  lab: string[];
  gh: boolean;
  tmux: string[];
  plugin: boolean;
  mapa: string;
  paleta: Color[];
  sesion: string;
  ciudades: Ciudad[];
  roads: Road[];
  reception: ReceptionSummary;
  invitation: Invitation;
  skills: Record<string, AgentCapabilities>;
  deliberations: Deliberation[];
  live_bus: LiveBus;
  /** name → identicon data URI, kind-tinted. Server-drawn (avatar.py) so the
   * face is the same one everywhere, forever. */
  avatars?: Record<string, string>;
  /** The normalised agent list, as full character sheets. */
  agents?: FichaAgente[];
  /** True only for the packaged Aurora demo: unlocks the replay controls. */
  demo?: boolean;
  /** One line when a newer release is published, '' otherwise. */
  update?: string;
}
interface RolInfo {
  id: string;
  name: string;
  summary: string;
  trade: string;
}
interface DomainInfo {
  id: string;
  name: string;
  summary: string;
}
/** What a reset would do, as the server computes it — never guessed here. */
interface Efectos {
  city: string;
  backup: string;
  agents: number;
  roads: number;
  deliberations: number;
  keeps: string[];
  loses: string[];
}
interface RepoLocal {
  nombre: string;
  ruta: string;
  cuando: string;
  mio: boolean;
}
interface Respuesta {
  ok?: boolean;
  error?: string;
  user?: string;
  attach?: string;
  city?: string;
  roads?: Road[];
}

declare global {
  interface Window {
    PASE: string;
  }
}

// ── plumbing ─────────────────────────────────────────────────────────────────
const PASE = window.PASE;
const CIUDAD = new URLSearchParams(location.search).get('city') ?? '';

/**
 * Tell the city's journal something happened here.
 *
 * The page is half of this product and it used to keep its failures to itself:
 * an error became a toast, the toast went away, and a person reporting it had
 * only their memory. This writes into the same file the server writes, so one
 * file answers "what happened" — and `agents-city doctor --report` can hand it
 * to somebody else without them having to have been watching.
 *
 * It never throws and never awaits: a log that can break the thing it is
 * logging, or slow it down, is worse than no log.
 */
function anota(que: string, detalle?: unknown, donde?: string): void {
  try {
    let u = '/api/diario?PASE=' + encodeURIComponent(PASE);
    if (CIUDAD) u += '&city=' + encodeURIComponent(CIUDAD);
    void fetch(u, {
      method: 'POST',
      headers: { 'X-City-Pase': PASE, 'Content-Type': 'application/json' },
      body: JSON.stringify({ que, detalle, donde: donde ?? location.hash ?? '' }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* the journal is a courtesy, never a dependency */
  }
}

async function api<T>(ruta: string, opts?: RequestInit): Promise<T> {
  let u = ruta + (ruta.includes('?') ? '&' : '?') + 'PASE=' + encodeURIComponent(PASE);
  if (CIUDAD) u += '&city=' + encodeURIComponent(CIUDAD);
  let r: Response;
  try {
    r = await fetch(u, {
      headers: { 'X-City-Pase': PASE, 'Content-Type': 'application/json' },
      ...opts,
    });
  } catch (e) {
    // A request that never came back. This is the one a person cannot report,
    // because nothing on screen says it happened — so now something does.
    if (ruta !== '/api/diario') {
      anota('fetch failed', String(e), ruta);
      desconectado.muestra('cerrado');
    }
    throw e;
  }
  // 403 is the other way to lose the server: it is up, and this tab holds an
  // address it no longer accepts. Same experience for the person — every button
  // stops working — so the same screen, worded for what it actually is.
  if (r.status === 403 && ruta !== '/api/diario') desconectado.muestra('caducado');
  const cuerpo = (await r.json()) as T & { error?: string };
  if (ruta !== '/api/diario' && (!r.ok || cuerpo?.error))
    anota('api refused', { estado: r.status, error: cuerpo?.error }, ruta);
  return cuerpo as T;
}

/** querySelector that refuses to hand back null: a missing element here is a bug
 *  in this file, and an early loud throw beats a silent dead button. */
function q<T extends Element>(sel: string, raiz: ParentNode = document): T {
  const el = raiz.querySelector<T>(sel);
  if (!el) throw new Error(`no element matches ${sel}`);
  return el;
}
function todos<T extends Element>(sel: string, raiz: ParentNode = document): T[] {
  return [...raiz.querySelectorAll<T>(sel)];
}

function esc(s: unknown): string {
  return String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  );
}
const corto = (p: string): string => p.replace(E.casa, '~');

let toastTimer = 0;
function toast(msg: string, mal = false): void {
  const t = q<HTMLElement>('#toast');
  t.textContent = msg;
  t.className = 'ver' + (mal ? ' mal' : '');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    t.className = '';
  }, 3200);
}
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── state ────────────────────────────────────────────────────────────────────
let E: Estado;
// A city is a place, not a dashboard. Open on the map so the centre always
// belongs to the city; configuration and the full transcript stay in the two
// Hall sidebars. The other sections remain explicit destinations in the rail.
let SECCION = 'mapa';
const SECCIONES: Array<[string, string]> = [
  ['resumen', 'Overview'],
  ['mapa', 'The map'],
  ['puesto', 'My seat'],
  ['barrios', 'Districts'],
  ['recepcion', 'Reception'],
  ['red', 'Roads'],
  ['committee', 'Committee'],
  ['gente', 'Houses'],
  ['demos', 'Demos'],
  ['ciudades', 'Cities'],
];

/** True until the person navigates: the landing section is decided once, from
 * the state, and never yanked out from under them afterwards. */
let primeraCarga = true;

async function refresca(): Promise<void> {
  E = await api<Estado>('/api/estado');
  if (primeraCarga) {
    primeraCarga = false;
    // A city with no seat or no agents has nothing to draw, and "Not drawn
    // yet" is a dead end as a first impression. Start where the next step is.
    const mia = E.tarjetas.find((t) => t.user === E.yo);
    // Never land on a dead end. Three cases, in order of what the person needs:
    //   nothing set up      -> the guide, which asks the questions
    //   set up, no map yet  -> the overview, which says what is left and how
    //   set up, map running -> the map, which is the point of the product
    // Landing on the map view without a map was how "Not drawn yet" became the
    // first thing an owner saw every single morning.
    if (!mia || (E.agents ?? []).length === 0) SECCION = 'bienvenida';
    else if (!E.mapa) SECCION = 'resumen';
  }
  pinta();
  pintaAvisoDeVersion();
  pintaDemoControles();
  sincronizaActividad(E.live_bus);
}

/**
 * The demo's remote control, in the live rail: replay, pause, resume. The
 * guided committee plays once when the first spectator connects, and anybody
 * whose map was still baking missed it — these buttons are the way back. Real
 * cities never see them, and the server refuses them anyway.
 */
/** A newer release, said once and quietly: the server already decided whether
 * there is one (cached for a day), so this only renders what it was told. */
function pintaAvisoDeVersion(): void {
  const caja = document.getElementById('avisoVersion');
  if (!caja) return;
  const texto = (E.update ?? '').trim();
  caja.textContent = texto;
  caja.hidden = !texto;
}

function pintaDemoControles(): void {
  const header = document.querySelector<HTMLElement>('#livePanel header');
  const previa = document.getElementById('demoControles');
  if (!header || !E.demo) {
    previa?.remove();
    return;
  }
  if (previa) return; // already wired; the buttons keep their own state
  const caja = document.createElement('div');
  caja.id = 'demoControles';
  caja.innerHTML =
    `<span>${_('guided committee')}</span>` +
    `<button id="demoReplay" type="button" title="${_('Play the guided committee from the top')}">${_('⟳ replay')}</button>` +
    `<button id="demoPausa" type="button" title="${_('Pause or resume mid-scene')}">${_('⏸ pause')}</button>`;
  header.appendChild(caja);
  const pausa = q<HTMLButtonElement>('#demoPausa', caja);
  const manda = (action: string) =>
    api<{ ok?: boolean; running?: boolean; paused?: boolean }>('/api/demo', {
      method: 'POST',
      body: JSON.stringify({ action }),
    });
  q<HTMLButtonElement>('#demoReplay', caja).onclick = async () => {
    const r = await manda('restart');
    pausa.textContent = '⏸ pause';
    if (!r.ok) toast('Could not restart the demo', true);
  };
  pausa.onclick = async () => {
    const antes = pausa.textContent?.includes('resume') ?? false;
    const r = await manda(antes ? 'resume' : 'pause');
    if (!r.running) {
      pausa.textContent = '⏸ pause';
      toast('Nothing playing — hit replay', true);
      return;
    }
    pausa.textContent = r.paused ? '▶ resume' : '⏸ pause';
  };
}

// ── live, read-only WebSocket feed ──────────────────────────────────────────
let liveSocket: WebSocket | null = null;
let liveUrl = '';
let liveEvents: ActivityEvent[] = [];
let liveConnected = false;
let liveRetry = 0;
let liveSelectedThread: string | null = null;
let liveFilterTouched = false;
let liveShowWork = false;
let pendingMapActivity: ActivityEvent | null = null;

function sincronizaActividad(endpoint: LiveBus): void {
  if (!endpoint?.online || !endpoint.url) {
    liveConnected = false;
    pintaActividad();
    programaDescubrimiento();
    return;
  }
  if (
    endpoint.url === liveUrl &&
    liveSocket &&
    (liveSocket.readyState === WebSocket.OPEN || liveSocket.readyState === WebSocket.CONNECTING)
  ) {
    return;
  }
  const anterior = liveSocket;
  if (anterior) {
    anterior.onclose = null;
    anterior.close();
  }
  liveUrl = endpoint.url;
  const socket = new WebSocket(endpoint.url);
  liveSocket = socket;
  liveConnected = false;
  pintaActividad();
  socket.onopen = () => {
    if (liveSocket !== socket) return;
    liveConnected = true;
    liveRetry = 0;
    pintaActividad();
  };
  socket.onmessage = (message) => {
    if (liveSocket !== socket) return;
    let value: Record<string, unknown>;
    try {
      value = JSON.parse(String(message.data)) as Record<string, unknown>;
    } catch {
      return;
    }
    if (value.type === 'activity.state') {
      liveEvents = Array.isArray(value.events)
        ? (value.events as ActivityEvent[]).filter(esActividad)
        : [];
      liveEvents.sort((a, b) => a.seq - b.seq);
      if (liveSelectedThread === null) liveSelectedThread = newestConversationThread();
      pintaActividad(true);
    } else if (value.type === 'activity.event' && esActividad(value.event)) {
      const event = value.event;
      if (!liveEvents.some((item) => item.id === event.id)) liveEvents.push(event);
      liveEvents = liveEvents.sort((a, b) => a.seq - b.seq).slice(-200);
      if (!liveFilterTouched && event.kind === 'committee.opened' && event.thread) {
        liveSelectedThread = event.thread;
      }
      pintaActividad(true);
      enviaActividadAlMapa(event);
    }
  };
  socket.onclose = () => {
    if (liveSocket !== socket) return;
    liveSocket = null;
    liveConnected = false;
    pintaActividad();
    programaDescubrimiento();
  };
  socket.onerror = () => {};
}

/** The Hall keeps the full transcript in its right rail. The map gets the same
 * semantic event for a short, anchored game bubble — and the lifecycle beats,
 * which never become bubbles but drive the map's live lights. */
function enviaActividadAlMapa(event: ActivityEvent): void {
  const esComite = event.kind.startsWith('committee.');
  if (!isSpeechEvent(event) && !isPresenceEvent(event) && !esComite) return;
  const frame = document.querySelector<HTMLIFrameElement>('#cityMapFrame');
  if (!frame) return;
  if (frame.dataset.ready !== '1') {
    pendingMapActivity = event;
    return;
  }
  const origin = new URL(frame.src, location.href).origin;
  frame.contentWindow?.postMessage(
    { protocol: MAP_ACTIVITY_PROTOCOL, type: 'activity.event', event },
    origin,
  );
}

function programaDescubrimiento(): void {
  if (liveRetry) return;
  liveRetry = window.setTimeout(async () => {
    liveRetry = 0;
    try {
      sincronizaActividad(await api<LiveBus>('/api/live'));
    } catch {
      programaDescubrimiento();
    }
  }, 1_500);
}

function pintaActividad(seguir = false): void {
  const dot = document.querySelector<HTMLElement>('#liveDot');
  const state = document.querySelector<HTMLElement>('#liveState');
  const list = document.querySelector<HTMLOListElement>('#liveEvents');
  const filter = document.querySelector<HTMLSelectElement>('#liveFilter');
  const context = document.querySelector<HTMLElement>('#liveContext');
  const workToggle = document.querySelector<HTMLButtonElement>('#liveWorkToggle');
  if (!dot || !state || !list || !filter || !context || !workToggle) return;
  dot.classList.toggle('on', liveConnected);
  state.textContent = liveConnected
    ? _('websocket live')
    : liveUrl
      ? _('reconnecting')
      : _('session offline');

  const opened = new Map<string, string>();
  for (const event of liveEvents) {
    if (
      event.thread &&
      (event.kind === 'committee.opened' || event.kind === 'conversation.user') &&
      !esPromptDeTransporte(event) &&
      !opened.has(event.thread)
    ) {
      opened.set(event.thread, event.summary);
    }
  }
  filter.innerHTML =
    `<option value="">${_('all conversations')}</option>` +
    [...opened.entries()]
      .reverse()
      .map(
        ([thread, question]) =>
          `<option value="${esc(thread)}">${esc(question.slice(0, 54) || thread)}</option>`,
      )
      .join('');
  const selected = liveSelectedThread || '';
  filter.value = [...filter.options].some((option) => option.value === selected) ? selected : '';
  filter.onchange = () => {
    liveSelectedThread = filter.value;
    liveFilterTouched = true;
    pintaActividad(true);
  };
  workToggle.classList.toggle('on', liveShowWork);
  workToggle.setAttribute('aria-pressed', String(liveShowWork));
  workToggle.textContent = liveShowWork ? _('hide work') : _('show work');
  workToggle.onclick = () => {
    liveShowWork = !liveShowWork;
    pintaActividad(true);
  };
  pintaContexto(filter.value, context);

  const scoped = filter.value
    ? liveEvents.filter((event) => event.thread === filter.value)
    : liveEvents;
  const visible = scoped.filter(
    (event) =>
      !esPromptDeTransporte(event) &&
      (liveShowWork || !esRuidoDeTrabajo(event) || event.tone === 'error'),
  );
  if (!visible.length) {
    list.innerHTML = `<li class="liveEmpty">${
      liveConnected
        ? _('The bus is live. Questions, positions and moderated replies will appear here.')
        : _('Start the city session. Its visible conversation will appear here as it happens.')
    }</li>`;
    return;
  }
  const wasNearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 90;
  list.innerHTML = visible.map(renderActividad).join('');
  if (seguir || wasNearBottom) list.scrollTop = list.scrollHeight;
}

function renderActividad(event: ActivityEvent): string {
  const when = new Date(event.at);
  const time = Number.isNaN(when.getTime())
    ? ''
    : when.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const side = event.role === 'chair' ? 'chair' : event.role === 'member' ? 'member' : 'system';
  const role = rolOperativo(event.actor);
  const route =
    event.target && !['committee', 'seat'].includes(event.target)
      ? `to ${event.target}`
      : event.target === 'committee'
        ? 'to the committee'
        : '';
  const summary = event.summary.trim();
  const compact = resumenVisible(summary);
  const long = compact !== summary;
  const details = event.details.length
    ? `<details class="liveEvidence"><summary>${event.details.length} ${
        event.details.length === 1 ? 'detail' : 'details'
      }</summary><ul>${event.details.map((detail) => `<li>${esc(detail)}</li>`).join('')}</ul></details>`
    : '';
  const full = long
    ? `<details class="liveFull"><summary>${_('read full message')}</summary><p>${esc(summary)}</p></details>`
    : '';
  return `<li class="liveTurn ${side} ${esc(event.tone)}">
    <div class="liveAvatar${E?.avatars?.[event.actor] ? ' conCara' : ''}"
      style="--actor-hue:${tonoActor(event.actor)}" aria-hidden="true">
      ${cara(event.actor, event.role === 'chair')}
    </div>
    <article class="liveBubble">
      <div class="liveMeta"><span class="liveActor">${esc(event.actor)}</span>
        ${role ? `<span class="liveRole">${esc(role)}</span>` : ''}
        ${route ? `<span>${esc(route)}</span>` : ''}<span class="liveWhen">${esc(time)}</span></div>
      <div class="liveHeading">${icono(event.kind)}<h3>${esc(tituloVisible(event))}</h3></div>
      <p>${esc(compact)}</p>${full}${details}
    </article>
  </li>`;
}

function newestConversationThread(): string {
  return (
    [...liveEvents]
      .reverse()
      .find(
        (event) =>
          Boolean(event.thread) &&
          (event.kind === 'committee.opened' ||
            (event.kind === 'conversation.user' && !esPromptDeTransporte(event))),
      )?.thread || ''
  );
}

function pintaContexto(thread: string, container: HTMLElement): void {
  const deliberation = thread ? E?.deliberations?.find((item) => item.id === thread) : undefined;
  const conversation = thread ? liveEvents.filter((event) => event.thread === thread) : [];
  const opened = conversation.find((event) => event.kind === 'committee.opened');
  if (!deliberation && !opened) {
    container.innerHTML = '';
    container.hidden = true;
    return;
  }
  const invited =
    opened?.details
      .find((detail) => detail.startsWith('Invited:'))
      ?.slice('Invited:'.length)
      .split(',')
      .map((actor) => actor.trim())
      .filter(Boolean) || [];
  const participants = deliberation?.participants || invited;
  const received =
    deliberation?.received ??
    new Set(
      conversation
        .filter((event) => event.kind === 'committee.position.submitted')
        .map((event) => event.actor),
    ).size;
  const total = deliberation?.total ?? participants.length;
  const status = conversation.at(-1)?.phase || deliberation?.status || 'starting';
  const actors = ['seat', ...participants];
  container.hidden = false;
  container.innerHTML = `<div class="livePeople">${actors
    .map(
      (actor) =>
        `<span class="livePerson${E?.avatars?.[actor] ? ' conCara' : ''}" title="${esc(
          actor === 'seat' ? 'seat · chair' : `${actor} · ${rolOperativo(actor) || 'member'}`,
        )}" style="--actor-hue:${tonoActor(actor)}">${cara(actor, actor === 'seat')}</span>`,
    )
    .join('')}</div><span class="liveContextText"><b>${_('seat moderates')}</b> · ${esc(
    received,
  )}/${esc(total)} positions · ${esc(status)}</span>`;
}

function esPromptDeTransporte(event: ActivityEvent): boolean {
  if (event.kind !== 'conversation.user') return false;
  const summary = event.summary.trimStart();
  return (
    summary.startsWith('[Agents City authenticated local bus]') ||
    (summary.startsWith('<channel') && summary.slice(0, 500).includes('plugin:city:city-bus'))
  );
}

function esRuidoDeTrabajo(event: ActivityEvent): boolean {
  return (
    event.kind === 'work.command.started' ||
    event.kind === 'work.command.completed' ||
    event.kind === 'runtime.turn.started' ||
    event.kind === 'runtime.turn.completed' ||
    event.kind === 'runtime.gateway.ready' ||
    event.kind === 'runtime.session.started' ||
    event.kind === 'runtime.session.ended'
  );
}

function rolOperativo(actor: string): string {
  if (actor === 'seat') return 'chair';
  return E?.skills?.[actor]?.role || '';
}

/**
 * An actor's face for the live rail: the server-drawn identicon when the city
 * knows this agent, the old initials (or the chair icon) when it does not —
 * an actor from another city still gets shown, just without claiming a face.
 */
function cara(actor: string, esChair: boolean): string {
  const uri = E?.avatars?.[actor];
  if (uri && uri.startsWith('data:image/svg+xml;base64,')) {
    return `<img class="liveCara" src="${esc(uri)}" alt="">`;
  }
  return esChair ? icono('chair') : esc(iniciales(actor));
}

function iniciales(actor: string): string {
  const parts = actor.split(/[-_.\s]+/).filter(Boolean);
  const initials =
    parts.length > 1
      ? parts
          .slice(0, 2)
          .map((part) => part[0])
          .join('')
      : actor.slice(0, 2);
  return initials.toUpperCase();
}

function tonoActor(actor: string): number {
  let hash = 17;
  for (const character of actor) hash = (hash * 31 + character.charCodeAt(0)) % 360;
  return hash;
}

function resumenVisible(summary: string): string {
  if (summary.length <= 520) return summary;
  const boundary = summary.slice(0, 520).lastIndexOf(' ');
  return summary.slice(0, boundary > 360 ? boundary : 520).trimEnd() + '…';
}

function tituloVisible(event: ActivityEvent): string {
  if (event.kind === 'conversation.user')
    return event.actor === 'seat' ? 'Question' : 'Brief received';
  if (event.kind === 'conversation.agent.commentary') return 'Working note';
  if (event.kind === 'conversation.agent') return 'Response';
  if (event.kind === 'committee.opened') return 'Question to the committee';
  if (event.kind === 'committee.position.submitted') return 'Position sealed';
  if (event.kind === 'committee.positions.revealed') return 'Blind round complete';
  if (event.kind === 'committee.position.revealed') return 'Position';
  if (event.kind === 'committee.synthesis.published') return 'Chair synthesis';
  if (event.kind === 'committee.floor.requested') return 'Requests the floor';
  if (event.kind === 'committee.floor.granted') return 'Floor granted';
  if (event.kind === 'committee.floor.denied') return 'Floor denied';
  if (event.kind === 'committee.floor.spoke') return 'Intervention';
  if (event.kind === 'committee.decision.recorded') return 'Decision';
  if (event.kind.startsWith('committee.verification.')) return 'Verification';
  if (event.kind === 'committee.closed') return 'Committee closed';
  return event.title;
}

function icono(kind: string): string {
  if (kind === 'chair') {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 17h16l-1.4-9-4.1 3L12 5l-2.5 6-4.1-3L4 17Zm1 2h14"/></svg>';
  }
  if (kind.includes('question') || kind === 'committee.opened' || kind === 'conversation.user') {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5h14v10H9l-4 4V5Zm5 4a2 2 0 1 1 3.4 1.4c-.9.6-1.4 1-1.4 2.1M12 14.7v.1"/></svg>';
  }
  if (kind.includes('decision') || kind.includes('verification') || kind === 'committee.closed') {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>';
  }
  if (kind.includes('floor')) {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 11V5a1.5 1.5 0 0 1 3 0v5-7a1.5 1.5 0 0 1 3 0v7-5a1.5 1.5 0 0 1 3 0v7l1-2a1.5 1.5 0 0 1 2.6 1.5L17 18a4 4 0 0 1-3.5 2H10a5 5 0 0 1-5-5v-3.5a1.5 1.5 0 0 1 3 0V13"/></svg>';
  }
  if (kind.includes('command') || kind.includes('work.')) {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 8 4 4-4 4m6 0h6"/></svg>';
  }
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 6h14v12H5zM8 10h8m-8 4h5"/></svg>';
}

function rail(): void {
  // Everything above the divider belongs to ONE city — its seat, its agents,
  // its map. Saying so here is the difference between a menu and a place: an
  // agent's workspace and mounts live inside this city's folder, and a flat
  // list of "Cities" and "Agents" as siblings hid that completely.
  const cuantos = (E.agents ?? []).length;
  q('#railCiudad').innerHTML = `<span class="railEtiqueta">${_('you are in')}</span>
    <b>${esc(E.city_name)}</b>
    <span class="railDe">${esc(E.domain)} · ${plural(cuantos, '{n} house', '{n} houses')}</span>`;
  q('#rail').innerHTML = SECCIONES.filter(([id]) => id !== 'ciudades')
    .map(([id, et]) => {
      const n =
        id === 'demos'
          ? ''
          : id === 'gente'
            ? String(Object.keys(E.skills).length)
            : id === 'committee'
              ? String(E.deliberations.length)
              : id === 'recepcion'
                ? String(E.reception?.pending ?? 0)
                : id === 'red'
                  ? String(E.roads.length)
                  : id === 'barrios'
                    ? String(E.parcelas.length)
                    : '';
      return `<li class="${id === SECCION ? 'aqui' : ''}" data-s="${id}" role="button"
        tabindex="0" ${id === SECCION ? 'aria-current="page"' : ''}>
      <span>${esc(_(et))}</span>${n ? `<span class="n">${n}</span>` : ''}</li>`;
    })
    .join('');
  q('#railOtras').innerHTML =
    `<li class="${SECCION === 'ciudades' ? 'aqui' : ''}" data-s="ciudades" role="button"
      tabindex="0" ${SECCION === 'ciudades' ? 'aria-current="page"' : ''}>
      <span>${_('All cities')}</span><span class="n">${E.ciudades.length}</span></li>`;
  todos<HTMLElement>('#rail li,#railOtras li').forEach((li) => {
    const abre = () => {
      document.body.classList.remove('enGuia');
      SECCION = li.dataset.s ?? 'mapa';
      pinta();
    };
    li.onclick = abre;
    li.onkeydown = (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      abre();
    };
  });
  q('#dondeDatos').textContent = corto(E.datos);
  const cs = q<HTMLElement>('#ciudades');
  if (E.ciudades.length > 1) {
    cs.innerHTML = `<select id="cambiaCiudad" aria-label="${_('which city this hall manages')}"
      title="${_('which city this hall manages')}">
      ${E.ciudades
        .map(
          (c) => `<option value="${esc(c.ruta)}" ${c.actual ? 'selected' : ''}>
        ${esc(c.nombre)}</option>`,
        )
        .join('')}</select>`;
    q<HTMLSelectElement>('#cambiaCiudad').onchange = (ev) => {
      const ruta = (ev.target as HTMLSelectElement).value;
      location.href = '/?PASE=' + encodeURIComponent(PASE) + '&city=' + encodeURIComponent(ruta);
    };
  } else {
    cs.innerHTML = '';
  }
  const nueva = q<HTMLAnchorElement>('#alWizard');
  nueva.onclick = async (ev) => {
    ev.preventDefault();
    const dicho = await pregunta({
      titulo: _('Start another city'),
      cuerpo: [
        _(
          'A city is a place with its own seat, its own houses and its own map. Yours stay where they are.',
        ),
      ],
      campos: [
        {
          id: 'name',
          etiqueta: _('What is it called?'),
          pista: _('home, clients, the lab — whatever you would say out loud'),
          requerido: true,
        },
      ],
      aceptar: _('Create it'),
    });
    const name = dicho?.name;
    if (!name?.trim()) return;
    const r = await api<Respuesta>('/api/ciudades', {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
    if (r.error || !r.city) return toast(r.error ?? 'Could not create the city', true);
    location.href = '/?PASE=' + encodeURIComponent(PASE) + '&city=' + encodeURIComponent(r.city);
  };
}

/** The view on screen, if it is one that has anything to stop. */
let montada: Vista | null = null;

function pinta(): void {
  // Whatever was here is being left. The dispatcher used to name one view and
  // one of its teardown methods by hand, which is a line it would have grown
  // again for the next view that owned a timer or a socket.
  montada?.desmonta?.();
  montada = null;
  rail();
  q<HTMLElement>('.cuerpo').style.padding = '';
  q<HTMLElement>('#lienzo').style.maxWidth = '';
  VISTAS[SECCION]();
  q<HTMLElement>('.cuerpo').scrollTop = 0;
}

const VISTAS: Record<string, () => void> = {};

// ── overview ─────────────────────────────────────────────────────────────────
/** The guided first run. Built once and kept, so a half-finished answer
 * survives a repaint. */
let guia: Bienvenida | null = null;

VISTAS.bienvenida = () => {
  document.body.classList.add('enGuia');
  guia ??= new Bienvenida({
    api,
    esc,
    aviso: toast,
    refresca,
    vete: (seccion: string) => {
      document.body.classList.remove('enGuia');
      SECCION = seccion;
      pinta();
    },
    ciudad: E.city_name,
    yo: E.yo,
    datos: corto(E.datos),
  });
  guia.monta(q<HTMLElement>('#lienzo'));
  montada = guia;
};

VISTAS.ciudades = () => {
  const filas = E.ciudades
    .map(
      (c) => `
      <div class="fila ${c.actual ? 'on' : ''}">
        <span class="et">${esc(c.nombre)}${c.actual ? ' <b class="de">· open now</b>' : ''}</span>
        <span class="de">${c.agentes ?? 0} house${(c.agentes ?? 0) === 1 ? '' : 's'} of its own</span>
        <span class="de mono">${esc(corto(c.ruta))}</span>
        <span style="margin-left:auto;display:flex;gap:6px">
          ${
            c.actual
              ? ''
              : `<a class="bt mini" href="?city=${encodeURIComponent(c.ruta)}">open</a>
                 <button class="bt mini archiva" data-ciudad="${esc(c.ruta)}"
                   data-nombre="${esc(c.nombre)}">archive</button>`
          }
        </span>
      </div>`,
    )
    .join('');
  q('#lienzo').innerHTML = `<div><span class="sub">cities</span>
    <h1 style="margin-top:6px">${_('Your cities')}</h1>
    <p class="prosa" style="margin-top:8px">${_(`One person, several autonomous cities: each has
    its own identity, domain, chair, <b>its own houses</b> and its own roads. A house is not
    shared — it stands inside the city that owns it, with its workspace and mounts under that
    city's folder — so two cities can each have a <code class="mono">docs</code> house and
    they are two different workers. They share nothing unless you build a road between
    them.`)}</p></div>
    <div class="lista"><div class="filas">${filas}</div></div>
    <div class="campos" style="max-width:420px">
      <div class="campo"><label>${_('Start another city')}</label>
        <input type="text" id="nuevaCiudad" placeholder="${_('client-a, research, the book…')}"></div>
      <button class="bt ppal" id="creaCiudad">Create it</button>
    </div>
    <div class="peligro">
      <h3>${_('Start this city over')}</h3>
      <p class="prosa">${_(
        'Takes {city} back to its first day: no seat, no agents, no committee history, no map. Your repositories and document folders are <b>never touched</b> — only the city that points at them.',
        { city: `<b>${esc(E.city_name)}</b>` },
      )}</p>
      <button class="bt malo" id="reiniciaCiudad">${_('Start over…')}</button>
    </div>
    <p class="pista">Archiving <b>moves</b> a city into
    <code class="mono">.backups/</code> — nothing is deleted, and you can bring it back with
    <code class="mono">mv</code>. The city you are standing in, and the last one you own,
    cannot be archived.</p>`;
  enlaza();
  const campo = q<HTMLInputElement>('#nuevaCiudad');
  q<HTMLButtonElement>('#creaCiudad').onclick = async () => {
    const nombre = campo.value.trim();
    if (!nombre) {
      toast('Give it a name', true);
      return;
    }
    const r = await api<Respuesta>('/api/ciudades', {
      method: 'POST',
      body: JSON.stringify({ name: nombre }),
    });
    if (!r.ok) {
      toast(r.error ?? 'Could not create it', true);
      return;
    }
    toast(`${nombre} created`);
    await refresca();
  };
  const reiniciar = document.getElementById('reiniciaCiudad');
  if (reiniciar)
    reiniciar.onclick = async () => {
      // Two round-trips on purpose: the first asks the server what this would
      // actually do, and the person reads it before typing anything. "Are you
      // sure?" is not information; a list of what disappears is.
      const previa = await api<{ preview?: Efectos; error?: string }>('/api/ciudad-reinicia', {
        method: 'POST',
        body: '{}',
      });
      if (!previa.preview) {
        toast(previa.error ?? 'Could not read what a reset would do', true);
        return;
      }
      const p = previa.preview;
      const dicho = await pregunta({
        titulo: _('Start over {city}?', { city: p.city }),
        cuerpo: [
          _('You lose:') + ' ' + p.loses.join(', ') + '.',
          _('Right now that is {agents} house(s), {roads} road(s) and {acts} committee act(s).', {
            agents: p.agents,
            roads: p.roads,
            acts: p.deliberations,
          }),
          _('You keep:') + ' ' + p.keeps.join(', ') + '.',
        ],
        campos: [{ id: 'nombre', etiqueta: _('Type the city’s name to confirm'), requerido: true }],
        exige: p.city,
        aceptar: _('Start over'),
        peligro: true,
      });
      if (dicho === null) return;
      const r = await api<{ ok?: boolean; backup?: string; error?: string }>(
        '/api/ciudad-reinicia',
        { method: 'POST', body: JSON.stringify({ confirm: p.city }) },
      );
      if (!r.ok) {
        toast(r.error ?? 'Could not reset it', true);
        return;
      }
      toast(`${p.city} starts over — the old one is at ${r.backup ?? 'its backup'}`);
      primeraCarga = true; // land wherever a fresh city should land: the guide
      await refresca();
    };
  todos<HTMLButtonElement>('.archiva').forEach((boton) => {
    boton.onclick = async () => {
      const nombre = boton.dataset.nombre ?? '';
      const vale = await confirma(
        _('Archive {city}?', { city: nombre }),
        [_('It moves into .backups. Nothing is deleted, and you can put it back by hand.')],
        { aceptar: _('Archive it') },
      );
      if (!vale) return;
      const r = await api<{ ok?: boolean; backup?: string; error?: string }>(
        '/api/ciudad-archiva',
        { method: 'POST', body: JSON.stringify({ city: boton.dataset.ciudad ?? '' }) },
      );
      if (!r.ok) {
        toast(r.error ?? 'Could not archive it', true);
        return;
      }
      toast(`${nombre} archived — it is in ${r.backup ?? '.backups'}`);
      await refresca();
    };
  });
};

/** The demo shelf, built once so a half-played story survives a repaint. */
let demos: Demos | null = null;

VISTAS.demos = () => {
  demos ??= new Demos({ api, esc, pinta: renderActividad });
  q('#lienzo').innerHTML = '<div id="demoHueco"></div>';
  demos.monta(q<HTMLElement>('#demoHueco'));
  montada = demos;
};

VISTAS.resumen = () => {
  const mia = E.tarjetas.find((t) => t.user === E.yo);
  const sinUnidad = E.parcelas.filter((p) => p.unidad === 'none' || p.unidad === 'mine').length;
  const agentes = E.agents ?? [];
  // The order somebody actually does it in: take the chair, say who works
  // here, say what for. The old list asked for "folders" — the vocabulary of
  // the model before agents existed — and never mentioned the roster at all,
  // so a new city could look finished with nobody in it.
  const tareas = [
    {
      ok: !!mia,
      txt: mia
        ? `Your seat is taken — you are <b>${esc(mia.agent)}</b> in <b>${esc(E.domain)}</b>`
        : 'Take your seat: the work domain and your role in it',
      ir: 'puesto',
    },
    {
      ok: agentes.length > 0,
      txt:
        agentes.length === 0
          ? 'Build the <b>houses</b> of this city — one per worker, each whole: its kind, its role, and everything it works on'
          : `<b>${agentes.length}</b> house${agentes.length === 1 ? '' : 's'} in this city: ${esc(
              agentes.map((a) => a.name).join(', '),
            )}`,
      ir: 'gente',
    },
    {
      ok: agentes.length === 0 || agentes.some((a) => (a.mounts ?? []).length),
      txt: agentes.some((a) => (a.mounts ?? []).length)
        ? 'Every house works on something real'
        : 'Give a house something to work on — a repository, a worktree, a folder of documents',
      ir: 'gente',
    },
    {
      ok: !!(mia && mia.goals_defined),
      txt:
        mia && mia.goals_defined
          ? `Your goal: <b>${esc(mia.objetivo ? mia.objetivo.title : '')}</b>`
          : 'Set <b>one goal</b>, with the command that measures it',
      ir: 'puesto',
    },
    {
      ok: E.parcelas.length === 0 || sinUnidad === 0,
      txt:
        E.parcelas.length === 0
          ? 'Districts appear on the map once agents have houses'
          : sinUnidad
            ? `<b>${sinUnidad}</b> of ${E.parcelas.length} houses sit in no real district — assign them`
            : 'Every house has its district',
      ir: 'barrios',
    },
  ];
  const empezando = !mia || agentes.length === 0;
  const sesionArriba = E.tmux.includes(E.sesion);
  q('#lienzo').innerHTML = `
    <div><span class="sub">${empezando ? 'welcome' : 'your city'}</span>
      <h1 style="margin-top:6px">${empezando ? 'Let’s build ' + esc(E.city_name) : esc(E.city_name)}</h1>
      <p class="de mono" style="margin-top:5px">${esc(E.address)}</p>
      ${
        empezando
          ? `<p class="prosa" style="margin-top:8px">A city is a chair and the agents behind
             it. Two steps and it is alive: take your seat — the work domain and your role in
             it — then add the agents, each one asked for whole: what kind of work it does,
             its role, everything it works on, the engine that runs it and the skills it
             starts with. Everything below is a plain file in
             <code class="mono">${esc(corto(E.datos))}</code> you can also edit by hand.</p>`
          : `<p class="prosa" style="margin-top:8px">Domain: <b>${esc(E.domain)}</b>. Growth is
             counted with <code class="mono">${esc(E.grow || 'nothing yet')}</code>.</p>`
      }</div>
    <div class="cifras">
      <div class="cifra"><b>${Object.keys(E.skills).length}</b><span>${_('repo agents')}</span></div>
      <div class="cifra"><b>${E.parcelas.length}</b><span>houses</span></div>
      <div class="cifra"><b>${E.roads.length}</b><span>roads</span></div>
      <div class="cifra"><b>${E.deliberations.length}</b><span>${_('committee acts')}</span></div>
      <div class="cifra"><b>${Object.values(E.skills).reduce((n, a) => n + a.skills.length, 0)}</b><span>${_('skills recognised')}</span></div>
    </div>
    <div class="luces">
      <span class="luz ${E.tarjetas.length ? 'on' : ''}">${_('data repo')}</span>
      <span class="luz ${E.gh ? 'on' : 'neutra'}">github${E.gh ? '' : ' — optional'}</span>
      <span class="luz ${E.plugin ? 'on' : ''}">${_('plugin installed')}</span>
      <span class="luz ${sesionArriba ? 'on' : 'neutra'}">tmux session${sesionArriba ? ' up' : ''}</span>
    </div>
    <div><span class="sub">${_('what is left')}</span>
      <div class="tareas" style="margin-top:9px">${tareas
        .map(
          (t) => `
        <div class="tarea ${t.ok ? 'hecha' : ''}">${t.txt}
          ${t.ok ? '' : `<button class="bt mini ir" data-ir="${t.ir}">go</button>`}</div>`,
        )
        .join('')}
      </div></div>
    <div><span class="sub">work</span>
      <div style="display:flex;flex-direction:column;gap:9px;margin-top:9px">
        <div class="orden"><span class="et2">${_('your day')}</span>
          <code>${
            sesionArriba
              ? 'tmux attach -t ' + esc(E.sesion)
              : 'one window per folder, an agent in each'
          }</code>
          ${
            sesionArriba
              ? `<button class="bt mini" data-copia="tmux attach -t ${esc(E.sesion)}">copy</button>`
              : `<button class="bt mini ppal" id="abreSesion">${_('open my session')}</button>`
          }
        </div>
        <div class="orden"><span class="et2">the map</span>
          <code>${E.mapa ? esc(E.mapa) : 'not drawn yet'}</code>
          <button class="bt mini ${E.mapa ? '' : 'ppal'}" data-ir="mapa">${E.mapa ? 'open' : 'draw it'}</button></div>
      </div></div>`;
  enlaza();
  const b = document.querySelector<HTMLButtonElement>('#abreSesion');
  if (b)
    b.onclick = async () => {
      b.disabled = true;
      b.textContent = 'building…';
      const r = await api<Respuesta>('/api/sesion', {
        method: 'POST',
        body: JSON.stringify({ user: E.yo }),
      });
      await espera(1500);
      await refresca();
      toast(
        r.ok && r.attach ? `Session built — attach with: ${r.attach}` : 'Could not build it',
        !r.ok,
      );
    };
};

// ── the map ──────────────────────────────────────────────────────────────────
VISTAS.mapa = () => {
  if (E.mapa) {
    // One web: the map lives inside the hall. It is its own server (a Worker,
    // independently deployable) so it arrives by iframe, full bleed. Embed mode
    // hides the map's standalone rails: the Hall already owns both sidebars.
    q<HTMLElement>('.cuerpo').style.padding = '0';
    q<HTMLElement>('#lienzo').style.maxWidth = 'none';
    const mapUrl = new URL(E.mapa, location.href);
    mapUrl.searchParams.set('embed', '1');
    mapUrl.searchParams.set('parent_origin', location.origin);
    q('#lienzo').innerHTML =
      `<iframe id="cityMapFrame" src="${esc(mapUrl.toString())}" title="the map"
      allow="fullscreen" allowfullscreen
      style="width:100%;height:calc(100vh - 2px);border:0;display:block"></iframe>`;
    const frame = q<HTMLIFrameElement>('#cityMapFrame');
    frame.onload = () => {
      frame.dataset.ready = '1';
      // What only the Hall knows and the map should draw: the city's roads,
      // which become its gates. The standalone map never gets this and never
      // invents a gate.
      const origin = new URL(frame.src, location.href).origin;
      frame.contentWindow?.postMessage(
        {
          protocol: MAP_ACTIVITY_PROTOCOL,
          type: 'map.config',
          roads: E.roads.map((r) => ({ name: r.name, address: r.address })),
          agents: (E.agents ?? []).map((a) => ({ name: a.name, kind: a.kind })),
          avatars: E.avatars ?? {},
        },
        origin,
      );
      // The map loads after the theme was decided, so tell it now as well —
      // otherwise a light Hall frames a night map until the next toggle.
      frame.contentWindow?.postMessage(
        { type: 'agents-city-map-theme/1', theme: temaActual() },
        origin,
      );
      if (pendingMapActivity) {
        const event = pendingMapActivity;
        pendingMapActivity = null;
        enviaActividadAlMapa(event);
      }
    };
    return;
  }
  const cuantos = (E.agents ?? []).length;
  q('#lienzo').innerHTML = `<div><span class="sub">the map</span>
    <h1 style="margin-top:6px">Your city, drawn</h1>
    <p class="prosa" style="margin-top:8px">${
      cuantos
        ? `<b>${cuantos}</b> agent${cuantos === 1 ? '' : 's'} live here, and the map shows
           them as houses that grow with the work they do — with the town hall in the middle
           when a committee is sitting, and a gate for every road out.`
        : `The map draws one house per agent. There are none yet, so it would be an empty
           plot — build one from <b>Houses</b> first.`
    }</p>
    <p class="prosa">The map is its own little server, so it is not running until you say so.
    The first time takes about a minute: it builds the front end and seeds a local database.
    After that it opens instantly, and it is yours — nothing is uploaded anywhere.</p></div>
    <div><button class="bt ppal" id="arrancaMapa">${
      cuantos ? 'Draw my city' : 'Draw it anyway'
    }</button></div>
    <p class="cargando" id="mapaEspera" style="display:none">baking the map — first time takes a minute</p>`;
  q<HTMLButtonElement>('#arrancaMapa').onclick = async () => {
    q<HTMLButtonElement>('#arrancaMapa').disabled = true;
    q<HTMLElement>('#mapaEspera').style.display = '';
    await api<Respuesta>('/api/mapa', { method: 'POST', body: '{}' });
    for (let i = 0; i < 60; i++) {
      await espera(3000);
      E = await api<Estado>('/api/estado');
      if (E.mapa) {
        pinta();
        return;
      }
    }
    toast('It did not come up — run ./bin/city by hand and look at its output', true);
    pinta();
  };
};

// ── my seat ──────────────────────────────────────────────────────────────────
VISTAS.puesto = () => {
  void puesto();
};

async function puesto(): Promise<void> {
  const mia = E.tarjetas.find((t) => t.user === E.yo);
  q('#lienzo').innerHTML = `<div><span class="sub">${_('my seat')}</span>
    <h1 style="margin-top:6px">${esc(E.yo)}</h1>
    <p class="prosa" style="margin-top:8px">This is your chair: the work domain, your
    role inside it, and one goal. The seat stays the boss even when its
    professional role is blank. Saving writes your card —
    <code class="mono">${esc(corto(E.datos))}/${esc(E.yo)}.md</code> — the same file
    every other door writes, and it never touches your roster.</p></div>
    <div><span class="sub">${_('work domain')}</span><div class="rolejilla" id="domains" style="margin-top:9px">
      <p class="cargando">${_('reading the domain packs')}</p></div></div>
    <div><span class="sub">role</span><div class="rolejilla" id="roles" style="margin-top:9px">
      <p class="cargando">${_('reading the role files')}</p></div></div>
    <div><span class="sub">${_('the agents')}</span>
      <p class="prosa" style="margin-top:8px">Who works in this city — and what each
      one works on — lives in <b>${_('Agents &amp; skills')}</b>, where an agent is asked for
      whole: its kind, its role, its repositories and document folders, its engine
      and its skills. One place, so the terminal and this page cannot disagree.
      <button class="bt" type="button" data-ir="gente" style="margin-left:8px">${_('Open the roster')}</button></p></div>
    <div><span class="sub">${_('one goal — optional')}</span><div class="campos" id="meta" style="margin-top:9px"></div></div>
    <div style="display:flex;gap:10px;align-items:center">
      <button class="bt ppal" id="guardaPuesto">${_('Save my seat')}</button>
      <span class="cargando" id="puestoEstado" style="display:none">writing</span></div>`;

  // Domain first, then only the roles relevant inside it. Both are copied into
  // the city as editable Markdown; neither changes skills in a referenced repo.
  const domainsR = (await api<{ domains: DomainInfo[] }>('/api/domains')).domains;
  let domain = E.domain || E.kind || 'software';
  let rol = mia ? mia.role : '';
  let rolesR: RolInfo[] = [];
  const pintaRoles = (): void => {
    q('#roles').innerHTML = rolesR
      .map(
        (r) => `
      <button class="rol ${r.id === rol ? 'on' : ''}" data-r="${esc(r.id)}">
        <h3>${esc(r.name)}</h3><span class="de">${esc(r.id)} · ${esc(r.trade.toLowerCase())}</span>
        <p>${esc(r.summary)}</p></button>`,
      )
      .join('');
    todos<HTMLButtonElement>('#roles .rol').forEach((b) => {
      b.onclick = () => {
        rol = b.dataset.r ?? '';
        pintaRoles();
      };
    });
  };
  const cargaRoles = async (): Promise<void> => {
    rolesR = (await api<{ roles: RolInfo[] }>('/api/roles?domain=' + encodeURIComponent(domain)))
      .roles;
    if (!rolesR.some((r) => r.id === rol)) rol = '';
    pintaRoles();
  };
  const pintaDominios = (): void => {
    q('#domains').innerHTML = domainsR
      .map(
        (d) => `
      <button class="rol ${d.id === domain ? 'on' : ''}" data-d="${esc(d.id)}">
        <h3>${esc(d.name)}</h3><span class="de">${esc(d.id)}</span>
        <p>${esc(d.summary)}</p></button>`,
      )
      .join('');
    todos<HTMLButtonElement>('#domains .rol').forEach((b) => {
      b.onclick = () => {
        domain = b.dataset.d ?? 'software';
        pintaDominios();
        void cargaRoles();
      };
    });
  };
  pintaDominios();
  await cargaRoles();

  // The roster is not asked for here any more: it lives in one place,
  // the agents view, so this page and the terminal cannot write different
  // cities. What this page owns is the chair — domain, role, goal.

  // goal
  const o: Partial<Objetivo> = (mia && mia.objetivo) || {};
  q('#meta').innerHTML = `
    <div class="campo"><label>${_('The goal, in one line')}</label>
      <input type="text" id="g_title" value="${esc(o.title)}" placeholder="${_('Concrete enough to argue with — empty skips it')}">
    </div>
    <div class="dos">
      <div class="campo"><label>${_('How it is measured')}</label>
        <input type="text" id="g_signal" value="${esc(o.signal)}"></div>
      <div class="campo"><label>${_('The command that returns it, if a command can')}</label>
        <input type="text" class="mono" id="g_command" value="${esc(o.command)}"
          placeholder="${_('empty for a qualitative goal')}"></div>
    </div>
    <div class="campo"><label>${_('…or who judges it, and how often')}</label>
      <input type="text" id="g_manual" value="${esc(o.manual)}"
        placeholder="${_('in prose: the architect reads the AGENTS.md files on Fridays')}">
      <p class="pista">A goal judged by a person is a real goal — plenty of quality
        is prose, not a number. Used when the command is empty.</p></div>
    <div class="dos">
      <div class="campo"><label>${_('What it returns today')}</label>
        <input type="text" class="mono" id="g_baseline" value="${esc(o.baseline)}"></div>
      <div class="campo"><label>${_('Where it has to get to')}</label>
        <input type="text" class="mono" id="g_target" value="${esc(o.target)}"></div>
    </div>
    <div class="campo" style="max-width:240px"><label>${_('By when')}</label>
      <input type="text" id="g_by" value="${esc(o.by ?? 'this quarter')}"></div>`;

  const val = (id: string): string => q<HTMLInputElement>(id).value.trim();
  q<HTMLButtonElement>('#guardaPuesto').onclick = async () => {
    if (!rol) {
      toast('Pick a role — it is the name your seat answers to', true);
      return;
    }
    q<HTMLElement>('#puestoEstado').style.display = '';
    const r = await api<Respuesta>('/api/ficha', {
      method: 'POST',
      body: JSON.stringify({
        user: E.yo,
        domain,
        role: rol,
        objetivo: {
          title: val('#g_title'),
          signal: val('#g_signal'),
          command: val('#g_command'),
          manual: val('#g_manual'),
          baseline: val('#g_baseline'),
          target: val('#g_target'),
          by: val('#g_by') || 'this quarter',
        },
      }),
    });
    await refresca();
    toast(
      r.ok ? `Card written — you are ${r.user ?? E.yo}` : (r.error ?? 'It could not write'),
      !r.ok,
    );
  };
}

// ── districts & houses ───────────────────────────────────────────────────────
VISTAS.barrios = () => {
  // Local working copies; nothing touches disk until Save.
  const unidades: Unidad[] = E.unidades.map((u) => ({ ...u }));
  const lab = new Set<string>(E.lab);
  interface Fila {
    ruta: string;
    unidad: string;
    nombre: string;
  }
  const porRepo: Record<string, Fila[]> = {};
  for (const p of E.parcelas) {
    (porRepo[p.repo] = porRepo[p.repo] ?? []).push({
      ruta: p.ruta,
      unidad: p.unidad,
      nombre: p.nombre,
    });
  }
  const slug = (s: string): string =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 20);

  const render = (): void => {
    const idsValidos = new Set([...unidades.map((u) => u.id), 'none']);
    q('#lienzo').innerHTML = `<div><span class="sub">${_('districts & houses')}</span>
      <h1 style="margin-top:6px">${_('The modelling no tool can do for you')}</h1>
      <p class="prosa" style="margin-top:8px">${_(`A house is <b>not a repo</b> — it is a
      parcel, a slice of one serving a single business unit. Split the interesting
      repos, give every house its district, and the map can say
      “this change touches banking” instead of “this change touches src/lib”.`)}</p></div>

      <div><span class="sub">districts</span>
        <div class="tabla" id="unidades" style="margin-top:9px"></div>
        <div style="display:flex;gap:9px;margin-top:9px">
          <input type="text" id="nuevaU" placeholder="${_('another district…')}" style="flex:1">
          <button class="bt" id="masU">Add</button></div></div>

      <div><span class="sub">houses</span><div id="parcelas" style="margin-top:9px"></div></div>

      <div style="display:flex;gap:10px;align-items:center">
        <button class="bt ppal" id="guardaBarrios">${_('Save districts & houses')}</button>
        <span style="font-size:12px;color:var(--tinta3);font-style:italic">
          writes units.yml and parcels.yml — reseed the map to see it drawn</span></div>`;

    q('#unidades').innerHTML =
      unidades
        .map(
          (u, i) => `
      <div class="tr">
        <input type="text" value="${esc(u.name)}" data-i="${i}" style="flex:1">
        <span class="id">${esc(u.id)}</span>
        <span class="pips" data-i="${i}">${E.paleta
          .map(
            (p) => `
          <button class="pip ${p.hex === u.color ? 'on' : ''}" data-c="${p.hex}"
            style="background:#${p.hex}" title="${esc(p.nombre)}"></button>`,
          )
          .join('')}</span>
        <button class="x" data-x="${i}">×</button></div>`,
        )
        .join('') ||
      '<div class="tr" style="color:var(--tinta3);font-size:12.5px">No districts yet — everything sits in “no unit”.</div>';

    q('#parcelas').innerHTML =
      Object.keys(porRepo)
        .sort()
        .map(
          (repo) => `
      <div class="repoBloque" data-repo="${esc(repo)}">
        <div class="repoCab"><span>${esc(repo)}</span>
          <button class="bt mini" data-split="${esc(repo)}">split</button>
          <label class="lab"><input type="checkbox" data-lab="${esc(repo)}"
            ${lab.has(repo) ? 'checked' : ''}> lab</label></div>
        ${(porRepo[repo] ?? [])
          .map(
            (f, j) => `
          <div class="parcela">
            <input type="text" value="${esc(f.nombre)}" data-k="nombre" data-r="${esc(repo)}" data-j="${j}" title="name on the map">
            <input type="text" class="mono" value="${esc(f.ruta)}" data-k="ruta" data-r="${esc(repo)}" data-j="${j}"
              placeholder="glob inside the repo — empty = the whole repo">
            <select data-k="unidad" data-r="${esc(repo)}" data-j="${j}">
              ${[...unidades.map((u) => u.id), 'none']
                .map(
                  (id) => `
                <option value="${esc(id)}" ${(idsValidos.has(f.unidad) ? f.unidad : 'none') === id ? 'selected' : ''}>${esc(id)}</option>`,
                )
                .join('')}
            </select>
            ${
              (porRepo[repo] ?? []).length > 1
                ? `<button class="x" data-quita="${esc(repo)}" data-j="${j}">×</button>`
                : '<span></span>'
            }
          </div>`,
          )
          .join('')}
      </div>`,
        )
        .join('') ||
      '<p class="prosa">No houses yet. Pick your folders in <b>My seat</b> and each becomes one.</p>';

    // wiring
    todos<HTMLInputElement>('#unidades input[data-i]').forEach((inp) => {
      inp.oninput = () => {
        const u = unidades[Number(inp.dataset.i)];
        if (!u) return;
        u.name = inp.value;
        u.id = slug(inp.value) || u.id;
        const idEl = inp.closest('.tr')?.querySelector('.id');
        if (idEl) idEl.textContent = u.id;
      };
    });
    todos<HTMLButtonElement>('#unidades .pip').forEach((b) => {
      b.onclick = () => {
        const grupo = b.closest<HTMLElement>('.pips');
        const u = unidades[Number(grupo?.dataset.i)];
        if (u) {
          u.color = b.dataset.c ?? u.color;
          render();
        }
      };
    });
    todos<HTMLButtonElement>('#unidades .x[data-x]').forEach((b) => {
      b.onclick = () => {
        unidades.splice(Number(b.dataset.x), 1);
        render();
      };
    });
    q<HTMLButtonElement>('#masU').onclick = () => {
      const n = q<HTMLInputElement>('#nuevaU').value.trim();
      if (!n) return;
      const usados = unidades.map((u) => u.color);
      const libre = E.paleta.find((p) => !usados.includes(p.hex)) ?? E.paleta[0];
      unidades.push({ id: slug(n), name: n, color: libre ? libre.hex : 'c8b48a' });
      render();
    };
    q<HTMLInputElement>('#nuevaU').onkeydown = (e) => {
      if (e.key === 'Enter') q<HTMLButtonElement>('#masU').click();
    };

    todos<HTMLInputElement | HTMLSelectElement>('#parcelas [data-k]').forEach((el) => {
      el.onchange = () => {
        const fila = porRepo[el.dataset.r ?? '']?.[Number(el.dataset.j)];
        if (!fila) return;
        const k = el.dataset.k as keyof Fila;
        fila[k] = el.value;
      };
    });
    todos<HTMLButtonElement>('#parcelas [data-split]').forEach((b) => {
      b.onclick = () => {
        const r = b.dataset.split ?? '';
        (porRepo[r] = porRepo[r] ?? []).push({
          ruta: '',
          unidad: 'none',
          nombre: `${r} · new slice`,
        });
        render();
      };
    });
    todos<HTMLButtonElement>('#parcelas [data-quita]').forEach((b) => {
      b.onclick = () => {
        porRepo[b.dataset.quita ?? '']?.splice(Number(b.dataset.j), 1);
        render();
      };
    });
    todos<HTMLInputElement>('#parcelas [data-lab]').forEach((c) => {
      c.onchange = () => {
        const r = c.dataset.lab ?? '';
        if (c.checked) lab.add(r);
        else lab.delete(r);
      };
    });

    q<HTMLButtonElement>('#guardaBarrios').onclick = async () => {
      const r1 = await api<Respuesta>('/api/unidades', {
        method: 'POST',
        body: JSON.stringify({ unidades }),
      });
      const r2 = await api<Respuesta>('/api/parcelas', {
        method: 'POST',
        body: JSON.stringify({ repos: porRepo, lab: [...lab] }),
      });
      await refresca();
      const mal = r1.error ?? r2.error;
      toast(mal ?? 'Districts and houses written', !!mal);
    };
  };
  render();
};

// ── roads ────────────────────────────────────────────────────────────────────
VISTAS.red = () => {
  const conectadas = new Set(E.roads.map((r) => r.id));
  const locales = E.ciudades.filter((c) => !c.actual && c.id && !conectadas.has(c.id));
  const invitation = JSON.stringify(E.invitation);
  q('#lienzo').innerHTML = `<div><span class="sub">roads</span>
    <h1 style="margin-top:6px">${_('Cities this one may reach')}</h1>
    <p class="prosa" style="margin-top:8px">A road joins city seats. It may stay on
    this machine or continue over the remote bus; the city sees one explicit
    connection either way.</p></div>
    <div class="gente">${
      E.roads
        .map(
          (r) => `<div class="persona"><h3>${esc(r.name)}</h3>
          <span class="ag">${esc(r.address)}</span>
          <span class="rp">${r.local ? 'local road' : 'remote road'}</span>
          <button class="bt mini" data-road-close="${esc(r.id)}">close</button></div>`,
        )
        .join('') || `<p class="prosa">${_('No roads yet. This city is isolated on purpose.')}</p>`
    }</div>
    <div><span class="sub">${_('other cities on this machine')}</span>
      <div class="gente" style="margin-top:9px">${
        locales
          .map(
            (c) => `<div class="persona"><h3>${esc(c.nombre)}</h3>
              <span class="ag">${esc(c.slug ?? c.ruta)}</span>
              <button class="bt mini ppal" data-road-open="${esc(c.id)}">open road</button></div>`,
          )
          .join('') || `<p class="prosa">${_('No unconnected local cities.')}</p>`
      }</div></div>
    <div class="orden"><span class="et2">${_('remote invitation · public, no token')}</span>
      <code>${esc(invitation)}</code>
      <button class="bt mini" data-copia="${esc(invitation)}">copy</button>
    </div>`;
  enlaza();
  todos<HTMLButtonElement>('[data-road-open]').forEach((b) => {
    b.onclick = async () => {
      const r = await api<Respuesta>('/api/roads', {
        method: 'POST',
        body: JSON.stringify({ action: 'connect', target: b.dataset.roadOpen }),
      });
      if (r.error) return toast(r.error, true);
      await refresca();
      toast('Road open at both local cities');
    };
  });
  todos<HTMLButtonElement>('[data-road-close]').forEach((b) => {
    b.onclick = async () => {
      const r = await api<Respuesta>('/api/roads', {
        method: 'POST',
        body: JSON.stringify({ action: 'disconnect', target: b.dataset.roadClose }),
      });
      if (r.error) return toast(r.error, true);
      await refresca();
      toast('Road closed');
    };
  });
};

// ── owner reception ─────────────────────────────────────────────────────────
VISTAS.recepcion = () => {
  q('#lienzo').innerHTML = `<div><span class="sub">${_('reception')}</span>
    <h1 style="margin-top:6px">${_('Messages wait for you, not your agents')}</h1>
    <p class="prosa" style="margin-top:8px">${_(
      'Remote text stops here as inert text. Read it, reject it with a reason, or choose the cities that should receive it. Until then no model can read it.',
    )}</p></div>
    <div class="recModo" id="recModo">
      <div><span class="et2">${_('routing mode')}</span><b>${_('Manual review')}</b>
        <p>${_('Every message needs a person before it reaches a city.')}</p></div>
      <button class="bt mini" type="button" data-rec-open-config>${_('Configure Auto')}</button>
    </div>
    <div id="recConfig" hidden></div>
    <div id="recLista"><p class="prosa">${_('Reading your reception…')}</p></div>`;
  void cargaRecepcion();
};

async function cargaRecepcion(): Promise<void> {
  const hueco = q<HTMLElement>('#recLista');
  let estado: ReceptionState;
  try {
    estado = await api<ReceptionState>('/api/reception');
  } catch {
    hueco.innerHTML = `<div class="recError">${_('Could not read your reception')}</div>`;
    return;
  }
  if (estado.error) {
    hueco.innerHTML = `<div class="recError">${esc(estado.error)}</div>`;
    return;
  }
  E.reception = {
    pending: estado.summary.pending,
    pendingBytes: estado.summary.pendingBytes,
    routingMode: estado.settings.routingMode,
    reviewPolicy: estado.settings.reviewPolicy,
    routerProfile: estado.settings.routerProfile,
    autoAvailable: estado.settings.autoAvailable,
  };
  const reglas = new Map(estado.settings.autoRules.map((rule) => [rule.cityId, rule.keywords]));
  const modo = q<HTMLElement>('#recModo');
  modo.innerHTML = `<div><span class="et2">${_('routing mode')}</span>
    <b>${estado.settings.routingMode === 'auto' ? _('Automatic routing') : _('Manual review')}</b>
    <p>${
      estado.settings.routingMode === 'auto'
        ? _('Only one clear, low-risk rule match can leave the human queue automatically.')
        : _('Every message needs a person before it reaches a city.')
    }</p></div>
    <button class="bt mini" type="button" data-rec-open-config>${_('Configure Auto')}</button>`;
  const configuracion = q<HTMLElement>('#recConfig');
  configuracion.innerHTML = `<form class="recAutoConfig" data-rec-config>
    <fieldset><legend>${_('Routing policy')}</legend>
      <label><input type="radio" name="routing_mode" value="manual"
        ${estado.settings.routingMode === 'manual' ? 'checked' : ''}> ${_('Keep human review')}</label>
      <label><input type="radio" name="routing_mode" value="auto"
        ${estado.settings.routingMode === 'auto' ? 'checked' : ''}> ${_('Use the local rule router')}</label>
    </fieldset>
    <div class="recReglas"><p>${_('Write comma-separated words or phrases for each destination. Empty cities are never selected.')}</p>
      ${estado.cities
        .map(
          (city) => `<label><span><b>${esc(city.name)}</b><small>${esc(city.address)}</small></span>
        <input type="text" name="rule-${esc(city.id)}" maxlength="1200"
          data-rule-city="${esc(city.id)}" value="${esc((reglas.get(city.id) ?? []).join(', '))}"
          placeholder="${_('e.g. contract, privacy, legal review')}"></label>`,
        )
        .join('')}</div>
    <p class="recAutoAviso">${_('Suspicious, unmatched, or ambiguous text always waits for you. Auto never executes, answers, or opens links.')}</p>
    <button class="bt ppal" type="submit">${_('Save routing policy')}</button>
  </form>`;
  q<HTMLButtonElement>('[data-rec-open-config]', modo).onclick = () => {
    configuracion.hidden = !configuracion.hidden;
  };
  rail();
  const conexiones = estado.connections.length
    ? `<section class="recConexiones"><div class="recSeccion"><b>${_('New encrypted message')}</b>
        <span>${estado.outbox.queued ? plural(estado.outbox.queued, 'message queued', 'messages queued') : _('Messages leave from this computer with end-to-end encryption.')}</span></div>
      <form class="recCompose" data-rec-send>
        <label class="recComposePersona" for="rec-send-connection"><span>${_('Write to')}</span>
          <select id="rec-send-connection" name="connection" required>
            ${estado.connections
              .map(
                (conexion) => `<option value="${esc(conexion.id)}">${esc(conexion.name)}</option>`,
              )
              .join('')}
          </select>
        </label>
        <label class="recComposeTexto" for="rec-send-text"><span>${_('Message')}</span>
          <textarea id="rec-send-text" name="text" rows="3" maxlength="11500" required
            placeholder="${_('Your message will stop in their private reception.')}"></textarea>
        </label>
        <button class="bt ppal" type="submit">${_('Send securely')}</button>
      </form></section>`
    : '';
  const vacia = !estado.messages.length
    ? `<div class="recVacia"><b>${_('Reception clear')}</b>
        <p>${_('No remote message is waiting for a decision.')}</p></div>`
    : '';
  const ciudades = estado.cities
    .map(
      (ciudad) => `<label class="recDestino"><input type="checkbox" name="destination"
        value="${esc(ciudad.id)}"><span><b>${esc(ciudad.name)}</b>
        <small>${esc(ciudad.address)}</small></span></label>`,
    )
    .join('');
  const pendientes = estado.messages.length
    ? `<div class="recResumen"><b>${estado.summary.pending}</b>
      <span>${plural(estado.summary.pending, 'message waiting', 'messages waiting')}</span>
      <small>${formateaBytes(estado.summary.pendingBytes)} · ${_('local only')}</small></div>
    <div class="recMensajes">${estado.messages
      .map(
        (mensaje) => `<article class="recMensaje">
          <header><div><span class="recOrigen">${esc(mensaje.fromName)}</span>
            <span>${esc(fechaRecepcion(mensaje.receivedAt))}</span></div>
            <span class="recSeguro">${mensaje.kind === 'rejection' ? _('Reply to a rejected message') : _('No agent has read this')}</span></header>
          <pre class="recTexto">${esc(mensaje.text)}</pre>
          ${
            mensaje.kind === 'rejection'
              ? `<div class="recAvisoAccion">
            <button class="bt mini" type="button" data-rec-dismiss="${esc(mensaje.id)}">${_('Dismiss')}</button>
          </div>`
              : `<div class="recAcciones">
            <form data-rec-route="${esc(mensaje.id)}">
              <fieldset><legend>${_('Send to')}</legend><div class="recDestinos">${ciudades}</div></fieldset>
              <button class="bt ppal" type="submit" disabled>${_('Route to selected cities')}</button>
            </form>
            <details><summary>${_('Reject and reply with a reason')}</summary>
              <form data-rec-reject="${esc(mensaje.id)}">
                <label for="rec-reason-${esc(mensaje.id)}">${_('Reason sent back securely')}</label>
                <input id="rec-reason-${esc(mensaje.id)}" type="text" name="reason"
                  maxlength="500" required
                  placeholder="${_('Reason for rejecting this message')}">
                <button class="bt malo" type="submit">${_('Reject and send reason')}</button>
              </form>
            </details>
          </div>`
          }
        </article>`,
      )
      .join('')}</div>`
    : '';
  hueco.innerHTML = `${vacia}${pendientes}${conexiones}`;
  enlazaRecepcion();
}

function enlazaRecepcion(): void {
  q<HTMLFormElement>('[data-rec-config]').onsubmit = async (evento) => {
    evento.preventDefault();
    const formulario = evento.currentTarget as HTMLFormElement;
    const boton = q<HTMLButtonElement>('button[type=submit]', formulario);
    const routingMode = q<HTMLInputElement>('input[name=routing_mode]:checked', formulario).value;
    const rules = todos<HTMLInputElement>('[data-rule-city]', formulario)
      .map((campo) => ({
        city_id: campo.dataset.ruleCity,
        keywords: campo.value
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean),
      }))
      .filter((rule) => rule.keywords.length);
    boton.disabled = true;
    const respuesta = await api<{ ok?: boolean; error?: string }>('/api/reception', {
      method: 'POST',
      body: JSON.stringify({ action: 'configure', routing_mode: routingMode, rules }),
    });
    if (!respuesta.ok) {
      boton.disabled = false;
      toast(respuesta.error ?? _('Could not save the routing policy'), true);
      return;
    }
    toast(_('Routing policy saved.'));
    await cargaRecepcion();
  };
  todos<HTMLFormElement>('[data-rec-send]').forEach((formulario) => {
    formulario.onsubmit = async (evento) => {
      evento.preventDefault();
      const boton = q<HTMLButtonElement>('button[type=submit]', formulario);
      const campo = q<HTMLTextAreaElement>('textarea[name=text]', formulario);
      const connectionId = q<HTMLSelectElement>('select[name=connection]', formulario).value;
      if (!connectionId || !campo.value.trim()) return;
      boton.disabled = true;
      const respuesta = await api<{ ok?: boolean; error?: string }>('/api/reception', {
        method: 'POST',
        body: JSON.stringify({
          action: 'send',
          connection_id: connectionId,
          text: campo.value,
        }),
      });
      if (!respuesta.ok) {
        boton.disabled = false;
        toast(respuesta.error ?? _('Could not queue the message'), true);
        return;
      }
      campo.value = '';
      toast(_('Message queued on this computer.'));
      await cargaRecepcion();
    };
  });
  todos<HTMLButtonElement>('[data-rec-dismiss]').forEach((boton) => {
    boton.onclick = async () => {
      boton.disabled = true;
      const respuesta = await api<{ ok?: boolean; error?: string }>('/api/reception', {
        method: 'POST',
        body: JSON.stringify({
          action: 'reject',
          message_id: boton.dataset.recDismiss,
          reason: 'Dismissed response',
        }),
      });
      if (!respuesta.ok) {
        boton.disabled = false;
        toast(respuesta.error ?? _('Could not dismiss the response'), true);
        return;
      }
      await cargaRecepcion();
    };
  });
  todos<HTMLFormElement>('[data-rec-route]').forEach((formulario) => {
    const boton = q<HTMLButtonElement>('button[type=submit]', formulario);
    const actualiza = () => {
      boton.disabled = !formulario.querySelector<HTMLInputElement>('input:checked');
    };
    formulario.onchange = actualiza;
    formulario.onsubmit = async (evento) => {
      evento.preventDefault();
      const destinations = todos<HTMLInputElement>(
        'input[name=destination]:checked',
        formulario,
      ).map((campo) => campo.value);
      if (!destinations.length) return;
      boton.disabled = true;
      const respuesta = await api<{ ok?: boolean; error?: string }>('/api/reception', {
        method: 'POST',
        body: JSON.stringify({
          action: 'route',
          message_id: formulario.dataset.recRoute,
          destinations,
        }),
      });
      if (!respuesta.ok) {
        boton.disabled = false;
        toast(respuesta.error ?? _('Could not route the message'), true);
        return;
      }
      toast(_('Message routed. Only the selected cities can now read it.'));
      await cargaRecepcion();
    };
  });
  todos<HTMLFormElement>('[data-rec-reject]').forEach((formulario) => {
    formulario.onsubmit = async (evento) => {
      evento.preventDefault();
      const boton = q<HTMLButtonElement>('button[type=submit]', formulario);
      const reason = q<HTMLInputElement>('input[name=reason]', formulario).value.trim();
      if (!reason) return;
      boton.disabled = true;
      const respuesta = await api<{ ok?: boolean; error?: string }>('/api/reception', {
        method: 'POST',
        body: JSON.stringify({
          action: 'reject',
          message_id: formulario.dataset.recReject,
          reason,
        }),
      });
      if (!respuesta.ok) {
        boton.disabled = false;
        toast(respuesta.error ?? _('Could not reject the message'), true);
        return;
      }
      toast(_('Message rejected. Your reason is queued for encrypted delivery.'));
      await cargaRecepcion();
    };
  });
}

function fechaRecepcion(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString(idioma() === 'es' ? 'es-ES' : 'en-GB', {
        dateStyle: 'medium',
        timeStyle: 'short',
      });
}

function formateaBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ── committee acts ───────────────────────────────────────────────────────────
VISTAS.committee = () => {
  q('#lienzo').innerHTML = `<div><span class="sub">committee</span>
    <h1 style="margin-top:6px">${_('Decisions with a visible chain of custody')}</h1>
    <p class="prosa" style="margin-top:8px">The seat selects relevant repo agents,
    gathers isolated positions, controls the floor, decides and assigns an
    independent verification. This view is read-only; the vendor-neutral CLI
    drives the protocol.</p></div>
    <div class="orden"><span class="et2">start</span>
      <code>${_('agents-city committee schema open')}</code>
      <button class="bt mini" data-copia="agents-city committee schema open">copy</button>
    </div>
    <div class="gente">${
      E.deliberations
        .map(
          (act) => `<div class="persona">
            <h3>${esc(act.question)}</h3>
            <span class="ag">${esc(act.status)} · revision ${act.revision} ·
              ${act.received}/${act.total} positions</span>
            <span class="rp">${esc(act.decision || act.desired_outcome)}</span>
            <span class="de">${esc(act.participants.join(', ') || 'no participants')}
              ${act.contributors.length ? ` · decisive ${esc(act.contributors.join(', '))}` : ''}
              ${act.verifier ? ` · verifier ${esc(act.verifier)} ${esc(act.verification)}` : ''}</span>
            <code class="mono">${esc(corto(act.act))}</code>
          </div>`,
        )
        .join('') ||
      `<p class="prosa">${_('No committee acts yet. Open one only when the seat needs specialised evidence.')}</p>`
    }</div>`;
  enlaza();
};

// ── agents and skills ────────────────────────────────────────────────────────
/** The shared `<option>` builder, with this page's escaper bound in. */
function opciones(valores: string[], actual: string): string {
  return opcionesDe(valores, actual, esc);
}

/** The one sheet-avatar guard: a data URI or nothing. */
function caraRPG(uri?: string): string {
  return uri?.startsWith('data:image/svg+xml;base64,')
    ? `<img class="rpgCara" src="${esc(uri)}" alt="">`
    : '';
}

function barra(ancho: number, clase = ''): string {
  const pct = Math.round(Math.max(0, Math.min(1, ancho)) * 100);
  return `<span class="barra${clase ? ' ' + clase : ''}"><span class="llena" style="width:${pct}%"></span></span>`;
}

VISTAS.gente = () => {
  const mia = E.tarjetas.find((t) => t.user === E.yo);
  const agentes = E.agents ?? [];

  const fichaDe = (a: FichaAgente) => {
    const motor = nivelDeMotor(a.model);
    const esfuerzo = NIVEL_ESFUERZO[a.effort] ?? 0;
    const g = a.growth;
    const crecido = Math.min(1, Math.log2(g.floors + 1) / 8);
    const skills = E.skills[a.name]?.skills ?? [];
    const motorDelAgente = motorDe(a.runtime);
    // "custom…" keeps the curated lineup from ever holding the card hostage:
    // the alias is resolved by the CLI at launch, not by this list. Where the
    // names are not ours to list at all, the whole field is that free text.
    const opcionesModelo =
      opciones([''].concat(motorDelAgente.modelos), a.model) +
      `<option value="__otro__">${_('custom…')}</option>`;
    const opcionesEsfuerzo = opciones(
      [''].concat(ESFUERZOS),
      motorDelAgente.esfuerzo ? a.effort : '',
    );
    const opcionesRuntime = opciones(RUNTIMES, a.runtime);
    const montajes = a.mounts ?? [];
    return `
      <div class="fichaRPG">
        <div class="rpgCab">${caraRPG(a.avatar)}
          <div><h3>${esc(a.name)}</h3>
          <span class="rpgTags"><span class="kindChip ${esc(a.kind)}">${esc(a.kind)}</span>
          <span class="rpgRol">${esc(a.role)}</span>
          <span class="rpgHogar">${a.legacy ? 'repo' : `workspace · ${montajes.length} ${montajes.length === 1 ? 'mount' : 'mounts'}`}</span></span></div>
          <span class="rpgBotones">
            <button class="rpgMini rpgDado" type="button" data-agente="${esc(a.slug)}"
              title="${_("Reroll this agent's face — deterministic, persisted on the card")}">🎲</button>
            <button class="rpgMini rpgIns" type="button" data-agente="${esc(a.slug)}"
              data-file="CLAUDE.md" title="${_('Instructions the Claude runtime reads')}">CLAUDE.md</button>
            <button class="rpgMini rpgIns" type="button" data-agente="${esc(a.slug)}"
              data-file="AGENTS.md" title="${_('Instructions Codex, OpenCode and Kimi read')}">AGENTS.md</button>
          </span>
        </div>
        <div class="rpgFila"><label>${_('engine')}</label>
          ${barra(motor.ancho, motor.defecto ? 'defecto' : '')}
          <select class="rpgSel" data-agente="${esc(a.slug)}" data-campo="model">
            ${opcionesModelo}</select></div>
        <div class="rpgFila"><label>${_('effort')}</label>
          ${barra(esfuerzo / 5, esfuerzo ? '' : 'defecto')}
          <select class="rpgSel" data-agente="${esc(a.slug)}" data-campo="effort"
            ${
              motorDelAgente.esfuerzo
                ? ''
                : `disabled title="${_('This CLI has no effort setting.')}"`
            }>
            ${opcionesEsfuerzo}</select></div>
        <div class="rpgFila"><label>${_('provider')}</label>
          <span class="rpgDato"><span class="cliDot ${
            a.cli.connected ? 'on' : a.cli.installed ? 'idle' : 'off'
          }" title="${esc(
            a.cli.connected
              ? 'connected: this agent’s window is alive right now'
              : a.cli.installed
                ? 'installed on this machine, not in use by this agent'
                : `${a.cli.binary} is not installed`,
          )}"></span>${esc(
            _(a.cli.connected ? 'connected' : a.cli.installed ? 'idle' : 'missing'),
          )} · ${esc(a.cli.binary)}
          <button class="rpgMini rpgTest" type="button" data-agente="${esc(a.slug)}"
            title="${_('Run the engine for real: --version, and the login state on Claude')}">test</button></span>
          <select class="rpgSel" data-agente="${esc(a.slug)}" data-campo="runtime">
            ${opcionesRuntime}</select></div>
        <div class="rpgSkills"><label>${_('works on')} · ${montajes.length}</label>
          ${
            montajes.length
              ? montajes
                  .map(
                    (m) =>
                      `<code class="mono" title="${esc(m.target)}">${esc(m.label)}${
                        m.fixed
                          ? ''
                          : `<button class="rpgQuitar rpgDesmonta" type="button"
                              data-agente="${esc(a.slug)}" data-mount="${esc(m.label)}"
                              title="Stop this agent working on ${esc(m.target)}">×</button>`
                      }</code>`,
                  )
                  .join(' ')
              : '<span class="rpgDato">nothing mounted yet</span>'
          }
          ${
            a.legacy
              ? `<span class="rpgDato">${_('a legacy repo agent works on its own repo')}</span>`
              : `<button class="rpgMini rpgMonta" type="button" data-agente="${esc(a.slug)}"
                  title="A repo, a worktree or a folder of documents — this agent works on all of them">+ folder</button>`
          }</div>
        <div class="rpgFila"><label>${_('growth')}</label>
          ${barra(crecido)}
          <span class="rpgDato">${g.floors | 0} floors · ${g.bricks | 0} bricks · ${g.activity30 | 0}/30d</span></div>
        <div class="rpgSkills"><label>${_('skills')} · ${skills.length}</label>
          ${
            skills.length
              ? skills
                  .map(
                    (s) =>
                      `<code class="mono" title="${esc(s.description)}">${esc(s.name)}${
                        s.removable && s.dir
                          ? `<button class="rpgQuitar" type="button" data-agente="${esc(a.slug)}"
                              data-skill="${esc(s.dir)}" title="${_("Remove this skill from the agent's home")}">×</button>`
                          : ''
                      }</code>`,
                  )
                  .join(' ')
              : '<span class="rpgDato">none discovered</span>'
          }
          <label class="rpgMini rpgSubir"
            title="${_("Install a skill zip into this agent's own home — the Claude runtime reads skills; other engines ignore them")}">
            + zip<input type="file" accept=".zip" data-agente="${esc(a.slug)}"></label></div>
      </div>`;
  };

  q('#lienzo').innerHTML = `<div><span class="sub">the houses of ${esc(E.city_name)}</span>
    <h1 style="margin-top:6px">${_('Who lives in {city}', { city: esc(E.city_name) })}</h1>
    <p class="prosa" style="margin-top:8px">${_(`<b>A house is where an agent lives and works</b>,
    and many houses are a city — it is the same thing the map draws, growing with what that
    agent actually does. The card and the CLI call them <code class="mono">agents</code>;
    here you see their houses.`)}</p>
    <p class="prosa">${_(
      'They belong to <b>this</b> city and only to it: each one’s workspace and its mounts live inside {donde}, so another city has its own people even if you give them the same names.',
      { donde: `<code class="mono">${esc(corto(E.datos))}/agents/</code>` },
    )} Every agent is whole here: the kind of work
    it does, its role, everything it works on — any number of repositories and document
    folders at once — the engine and effort that run it, and the skills in its own home.</p>
    <p class="prosa">Every number is real: growth from what the agent actually produced,
    skills from live read-only recognition. Changes persist to the card and apply the next
    time the session opens.</p>
    <button class="rpgAlta" type="button" id="altaAgente">${_('+ Build a house')}</button></div>
    <div class="fichasRPG">
      <div class="fichaRPG rpgSeat">
        <div class="rpgCab">${caraRPG(E.avatars?.['seat'])}
          <div><h3>seat</h3>
          <span class="rpgTags"><span class="kindChip coordinator">chair</span>
          <span class="rpgRol">${esc(mia?.role ?? 'not configured')}</span></span></div>
        </div>
        <div class="rpgFila"><span class="rpgDato">${esc(E.address)}</span></div>
        <div class="rpgFila"><span class="rpgDato">${esc(mia?.objetivo?.title ?? 'No goal yet')}</span></div>
      </div>
      ${agentes.map(fichaDe).join('')}
    </div>`;

  // Engine changes: one POST, the sheet re-renders from the server's answer.
  // One save round-trip for every sheet edit: POST, refresh the sheet from the
  // server's answer, keep the roster's face in sync, repaint.
  const guardaAgente = async (carga: Record<string, string>, mensaje: string) => {
    let r: { ok?: boolean; agent?: FichaAgente; error?: string };
    try {
      r = await api('/api/agente', { method: 'POST', body: JSON.stringify(carga) });
    } catch (e) {
      toast(String(e), true);
      pinta(); // the failed edit must not stay on screen looking saved
      return;
    }
    if (!r.ok || !r.agent) {
      toast(r.error || 'Could not save', true);
      // Repaint from the untouched state: a select left showing "custom…"
      // never fires another change event for the same choice.
      pinta();
      return;
    }
    E.agents = (E.agents ?? []).map((x) => (x.slug === r.agent!.slug ? r.agent! : x));
    if (E.avatars) E.avatars[r.agent.name] = r.agent.avatar;
    toast(mensaje);
    pinta();
  };

  todos<HTMLSelectElement>('.rpgSel').forEach((sel) => {
    sel.onchange = async () => {
      let valor = sel.value;
      if (valor === '__otro__') {
        // The CLI resolves any alias at launch; the prompt just has to be an
        // alias shape, and the server refuses anything that is not.
        const dicho = await pregunta({
          titulo: _('Which engine?'),
          cuerpo: [
            _('An alias the CLI resolves when the window opens. Anything it accepts works here.'),
          ],
          campos: [
            { id: 'alias', etiqueta: _('Model alias'), pista: 'claude-opus-5', requerido: true },
          ],
          aceptar: _('Use it'),
        });
        const propio = dicho?.alias ?? null;
        if (propio === null) {
          pinta();
          return;
        }
        valor = propio.trim().toLowerCase();
      }
      await guardaAgente(
        { agent: sel.dataset.agente ?? '', [sel.dataset.campo ?? 'model']: valor },
        'Saved — applies next session',
      );
    };
  });

  // The dice: one reroll, one new deterministic look, persisted on the card.
  todos<HTMLButtonElement>('.rpgDado').forEach((boton) => {
    boton.onclick = () =>
      guardaAgente(
        { agent: boton.dataset.agente ?? '', avatar: Math.random().toString(36).slice(2, 8) },
        'New look — same identity, everywhere, forever',
      );
  });

  // The test button: the engine runs for real and answers for itself.
  todos<HTMLButtonElement>('.rpgTest').forEach((boton) => {
    boton.onclick = async () => {
      boton.disabled = true;
      try {
        const r = await api<{
          ok?: boolean;
          binary?: string;
          version?: string;
          detail?: string;
          error?: string;
        }>('/api/motor', {
          method: 'POST',
          body: JSON.stringify({ agent: boton.dataset.agente ?? '' }),
        });
        if (r.error) {
          toast(r.error, true);
          return;
        }
        const partes = [r.version, r.detail].filter(Boolean).join(' · ');
        toast(
          r.ok ? `${r.binary} works — ${partes}` : `${r.binary}: ${r.detail || 'failed'}`,
          !r.ok,
        );
      } catch (e) {
        toast(String(e), true);
      } finally {
        // Not on the success line: a dropped request must not leave the
        // button greyed out until the whole view re-renders.
        boton.disabled = false;
      }
    };
  });

  // Removing a skill: only ones living in the agent's own `.claude/skills/` —
  // a skill committed elsewhere in a repo is the repo's property, no × shown.
  todos<HTMLButtonElement>('.rpgQuitar').forEach((boton) => {
    boton.onclick = async () => {
      const nombre = boton.dataset.skill ?? '';
      const vale = await confirma(
        _('Remove the skill {skill}?', { skill: nombre }),
        [_('It is deleted from this agent’s own home. Nothing outside that folder is touched.')],
        { aceptar: _('Remove it'), peligro: true },
      );
      if (!vale) return;
      const r = await api<{ ok?: boolean; error?: string }>('/api/skill', {
        method: 'POST',
        body: JSON.stringify({ agent: boton.dataset.agente ?? '', remove: nombre }),
      });
      if (!r.ok) {
        toast(r.error || 'Could not remove', true);
        return;
      }
      toast(`Skill ${nombre} removed`);
      void refresca();
    };
  });

  // Adding an agent from the web: the roster the wizard builds question by
  // question, reachable by somebody who never opens a terminal.
  const alta = document.getElementById('altaAgente');
  if (alta)
    alta.onclick = async () => {
      // The very same form the first-run guide uses, in a dialog. It used to be
      // three chained prompt boxes here — name, kind, role — with no engine and
      // no way to pick a folder, which is a second, worse implementation of a
      // question the product had already answered well once.
      const forma = new FormularioDeCasa({ api, esc, aviso: toast, yo: E.yo });
      let hecho: { slug: string; nombre: string } | null = null;
      await pregunta({
        titulo: _('Build a house'),
        cuerpo: [
          _(
            'One worker, its own window, its own corner of your disk. Everything here can be changed afterwards.',
          ),
        ],
        contenido: '<div id="altaCasa"></div>',
        aceptar: _('Build it'),
        ancho: 640,
        enlaza: (raiz, cierra) => {
          const hueco = raiz.querySelector<HTMLElement>('#altaCasa');
          if (hueco) forma.monta(hueco);
          const boton = raiz.querySelector<HTMLButtonElement>('[data-dlg="si"]');
          if (!boton) return;
          boton.onclick = async () => {
            boton.disabled = true;
            hecho = await forma.guarda();
            boton.disabled = false;
            if (hecho) cierra({});
          };
        },
      });
      if (!hecho) return;
      toast(_('{name} has a house now', { name: (hecho as { nombre: string }).nombre }));
      void refresca();
    };

  // Mounts: what an agent works on, added and removed where it is read.
  const montaje = async (carga: Record<string, string>, hecho: string) => {
    try {
      const r = await api<{ ok?: boolean; error?: string }>('/api/montaje', {
        method: 'POST',
        body: JSON.stringify(carga),
      });
      if (!r.ok) {
        toast(r.error || 'Could not change the mounts', true);
        return;
      }
      toast(hecho);
      void refresca();
    } catch (e) {
      toast(String(e), true);
    }
  };
  todos<HTMLButtonElement>('.rpgMonta').forEach((boton) => {
    boton.onclick = async () => {
      // The same walk the house form uses: no guessed list, nothing filtered.
      const elegidas: string[] = [];
      const exp = new Explorador(
        { api, esc },
        (ruta) => {
          const ya = elegidas.indexOf(ruta);
          if (ya >= 0) elegidas.splice(ya, 1);
          else elegidas.push(ruta);
        },
        () => elegidas,
      );
      const dicho = await pregunta({
        titulo: _('What else does it work on?'),
        cuerpo: [
          _(
            'A repository, a worktree, a folder of documents, one exact file. It is linked, never copied.',
          ),
        ],
        contenido: '<div id="montaExp"></div>',
        aceptar: _('Mount it'),
        ancho: 620,
        enlaza: (raiz) => {
          const hueco = raiz.querySelector<HTMLElement>('#montaExp');
          if (hueco) exp.monta(hueco);
        },
      });
      if (dicho === null || !elegidas.length) return;
      // One refresh and one toast for the whole dialog: mounting five folders
      // used to cost five serialised posts, five state fetches and five full
      // repaints of the Hall, for five independent writes.
      const agente = boton.dataset.agente ?? '';
      const fallos = await Promise.all(
        elegidas.map((ruta) =>
          api<{ ok?: boolean; error?: string }>('/api/montaje', {
            method: 'POST',
            body: JSON.stringify({ agent: agente, add: ruta }),
          })
            .then((r) => (r.ok ? '' : `${ruta}: ${r.error ?? 'could not mount'}`))
            .catch((e) => `${ruta}: ${String(e)}`),
        ),
      );
      const malos = fallos.filter(Boolean);
      toast(malos.length ? malos.join('; ') : _('Mounted'), malos.length > 0);
      void refresca();
    };
  });
  todos<HTMLButtonElement>('.rpgDesmonta').forEach((boton) => {
    boton.onclick = async () => {
      const etiqueta = boton.dataset.mount ?? '';
      // Unmounting removes a symlink and a card key. What it points at is not
      // touched — say so, because "remove" reads as "delete my folder".
      const vale = await confirma(
        _('Stop this agent working on {what}?', { what: etiqueta }),
        [_('The link goes. The folder it points at stays exactly where it is.')],
        { aceptar: _('Unmount it') },
      );
      if (!vale) return;
      void montaje(
        { agent: boton.dataset.agente ?? '', remove: etiqueta },
        `${etiqueta} unmounted — the folder itself is untouched`,
      );
    };
  });

  // The instruction editors: one click, the modal opens on that agent's file.
  todos<HTMLButtonElement>('.rpgIns').forEach((boton) => {
    boton.onclick = () =>
      void abreInstrucciones(boton.dataset.agente ?? '', boton.dataset.file ?? '');
  });

  // Installing a skill: the picked zip travels as base64, like claude.ai's own
  // upload. The name only matters when the zip has no single top folder.
  todos<HTMLInputElement>('.rpgSubir input').forEach((entrada) => {
    entrada.onchange = async () => {
      const archivo = entrada.files?.[0];
      if (!archivo) return;
      entrada.disabled = true;
      try {
        const zip = await aBase64(archivo);
        const nombre = archivo.name
          .replace(/\.zip$/i, '')
          .toLowerCase()
          .replace(/[^a-z0-9-]+/g, '-')
          .replace(/^-+|-+$/g, '');
        const r = await api<{ ok?: boolean; skill?: string; error?: string }>('/api/skill', {
          method: 'POST',
          body: JSON.stringify({ agent: entrada.dataset.agente ?? '', name: nombre, zip }),
        });
        if (!r.ok) {
          toast(r.error || 'Could not install', true);
          return;
        }
        toast(`Skill ${r.skill} installed — the Claude runtime reads it next session`);
        void refresca();
      } catch (e) {
        toast(String(e), true);
      } finally {
        entrada.disabled = false;
        entrada.value = '';
      }
    };
  });
};

function aBase64(archivo: File): Promise<string> {
  // The browser's own encoder, off a data URL: native and allocation-friendly,
  // where hand-chunked String.fromCharCode reallocated megabytes on the way.
  return new Promise((listo, falla) => {
    const lector = new FileReader();
    lector.onerror = () => falla(lector.error);
    lector.onload = () => listo(String(lector.result).split(',', 2)[1] ?? '');
    lector.readAsDataURL(archivo);
  });
}

/** The instruction editor: one agent, one file, one honest label saying which
 * engine actually reads it. Saved atomically into the agent's own home. */
let editorAbierto: { agent: string; file: string } | null = null;

async function abreInstrucciones(agente: string, archivo: string): Promise<void> {
  const r = await api<{
    exists?: boolean;
    content?: string;
    home?: string;
    reader?: string;
    error?: string;
  }>(`/api/instrucciones?agent=${encodeURIComponent(agente)}&file=${encodeURIComponent(archivo)}`);
  if (r.error) {
    toast(r.error, true);
    return;
  }
  editorAbierto = { agent: agente, file: archivo };
  q<HTMLElement>('#edTitulo').textContent = `${agente} · ${archivo}`;
  q<HTMLElement>('#edLector').textContent =
    `read by ${r.reader ?? '?'}${r.exists ? '' : ' · new file'}`;
  q<HTMLElement>('#edRuta').textContent = r.home ? `${r.home}/${archivo}` : '';
  q<HTMLTextAreaElement>('#edTexto').value = r.content ?? '';
  q<HTMLElement>('#editorIns').hidden = false;
  q<HTMLTextAreaElement>('#edTexto').focus();
}

document.getElementById('edCerrar')?.addEventListener('click', () => {
  q<HTMLElement>('#editorIns').hidden = true;
  editorAbierto = null;
});
document.getElementById('edGuardar')?.addEventListener('click', async () => {
  if (!editorAbierto) return;
  const r = await api<{ ok?: boolean; error?: string }>('/api/instrucciones', {
    method: 'POST',
    body: JSON.stringify({ ...editorAbierto, content: q<HTMLTextAreaElement>('#edTexto').value }),
  });
  if (!r.ok) {
    toast(r.error || 'Could not save', true);
    return;
  }
  toast('Saved');
  q<HTMLElement>('#editorIns').hidden = true;
  editorAbierto = null;
});

// ── shared ──────────────────────────────────────────────────────────────────
function enlaza(): void {
  todos<HTMLButtonElement>('[data-copia]').forEach((b) => {
    b.onclick = async () => {
      try {
        await navigator.clipboard.writeText(b.dataset.copia ?? '');
        toast('Copied');
      } catch {
        toast('Could not copy — select it by hand', true);
      }
    };
  });
  todos<HTMLButtonElement>('[data-ir]').forEach((b) => {
    b.onclick = () => {
      SECCION = b.dataset.ir ?? 'mapa';
      pinta();
    };
  });
}

/**
 * The divider between the map and the live rail: grab it and the rail follows
 * the mouse. The width persists per browser — a rail you resized yesterday is
 * still that size today — and a double-click gives the default back. Dragging
 * disables the map iframe's pointer events for the duration, or the iframe
 * swallows the drag the moment the cursor crosses it.
 */
function arrastreDelRail(): void {
  const app = document.getElementById('app');
  const asa = document.getElementById('liveResize');
  const rail = document.getElementById('livePanel');
  if (!app || !asa || !rail) return;
  const CLAVE = 'hall-live-width';
  const aplica = (px: number | null) => {
    if (px === null) app.style.removeProperty('--live-ancho');
    else app.style.setProperty('--live-ancho', `${Math.round(px)}px`);
  };
  // Never narrower than the cards stay readable, never wider than the map
  // stops being a map.
  const tope = (px: number) => Math.max(340, Math.min(px, Math.max(420, window.innerWidth * 0.6)));
  try {
    const guardado = Number(localStorage.getItem(CLAVE));
    if (guardado > 0) aplica(tope(guardado));
  } catch {
    // A browser with no storage gets the default width, which is fine.
  }

  asa.addEventListener('pointerdown', (e: PointerEvent) => {
    e.preventDefault();
    const desdeX = e.clientX;
    const desdeAncho = rail.getBoundingClientRect().width;
    app.classList.add('liveResizing');
    asa.setPointerCapture(e.pointerId);
    const mueve = (ev: PointerEvent) => aplica(tope(desdeAncho + (desdeX - ev.clientX)));
    const suelta = () => {
      app.classList.remove('liveResizing');
      asa.removeEventListener('pointermove', mueve);
      asa.removeEventListener('pointerup', suelta);
      asa.removeEventListener('pointercancel', suelta);
      try {
        localStorage.setItem(CLAVE, String(Math.round(rail.getBoundingClientRect().width)));
      } catch {
        // Nothing to persist to; the drag still worked for this session.
      }
    };
    asa.addEventListener('pointermove', mueve);
    asa.addEventListener('pointerup', suelta);
    asa.addEventListener('pointercancel', suelta);
  });
  asa.addEventListener('dblclick', () => {
    aplica(null);
    try {
      localStorage.removeItem(CLAVE);
    } catch {
      // Already gone.
    }
  });
}

/** The map can ask for a section: a click on the town hall opens the
 * committee, a click on a gate opens the roads. Only from the map's own frame
 * and only to sections that exist — a message is a request, not a capability. */
window.addEventListener('message', (message) => {
  if (!esNavDeMapa(message.data)) return;
  const frame = document.querySelector<HTMLIFrameElement>('#cityMapFrame');
  if (!frame || message.source !== frame.contentWindow) return;
  if (message.origin !== new URL(frame.src, location.href).origin) return;
  const view = message.data.view;
  if (view !== 'committee' && view !== 'red') return;
  SECCION = view;
  pinta();
});

/**
 * Night or day. The city's own light is night — an isometric map at 3am — so
 * that stays the default; day is the palette of agentscity.net, so the tool on
 * your machine and the site are visibly one product.
 *
 * Three states, not two: no stored choice means "follow this machine", and only
 * an explicit click stamps the root element and outranks the system setting.
 * The map lives in an iframe of its own, so it is told as well — a light Hall
 * around a night map would read as two products in one window.
 */
/** Which skin is showing right now: the stamped choice, or this machine's. */
function temaActual(): 'light' | 'dark' {
  const elegido = document.documentElement.getAttribute('data-tema');
  if (elegido) return elegido === 'claro' ? 'light' : 'dark';
  // Day is THE default, full stop: a desktop set to dark does not decide this
  // for the owner. Only the switch does, and it is remembered.
  return 'light';
}

function tema(): void {
  const boton = document.getElementById('temaBoton');
  const guardado = ((): string => {
    try {
      return localStorage.getItem('hall-tema') ?? '';
    } catch {
      return ''; // a browser with site data blocked still gets a working page
    }
  })();
  const oscuroDelSistema = false; // daylight is the default; only the switch changes it

  const pon = (elegido: string): void => {
    const raiz = document.documentElement;
    if (elegido) raiz.setAttribute('data-tema', elegido);
    else raiz.removeAttribute('data-tema');
    const claro = elegido ? elegido === 'claro' : !oscuroDelSistema;
    // The button says where a click TAKES you, not where you are: a control
    // labelled with the state you can already see is a riddle.
    if (boton) boton.textContent = claro ? '☾ Night' : '☀ Day';
    const frame = document.querySelector<HTMLIFrameElement>('#cityMapFrame');
    frame?.contentWindow?.postMessage(
      { type: 'agents-city-map-theme/1', theme: claro ? 'light' : 'dark' },
      new URL(frame.src, location.href).origin,
    );
  };

  pon(guardado);
  if (boton)
    boton.onclick = () => {
      const claroAhora = document.documentElement.getAttribute('data-tema')
        ? document.documentElement.getAttribute('data-tema') === 'claro'
        : !oscuroDelSistema;
      const elegido = claroAhora ? 'oscuro' : 'claro';
      try {
        localStorage.setItem('hall-tema', elegido);
      } catch {
        /* not being able to remember it is not a reason to refuse the switch */
      }
      pon(elegido);
    };
}

/**
 * Español or English, on a switch next to the theme.
 *
 * The two READMEs shipped bilingual from the first commit and the product did
 * not, which is backwards: documentation is read once and the interface every
 * day. The page starts in this browser's language and the button says which one
 * a click takes you to, the same way the theme button does.
 */
function interruptorDeIdioma(): void {
  const boton = document.getElementById('idiomaBoton');
  if (!boton) return;
  const pon = (): void => {
    document.documentElement.lang = idioma();
    // The label is the language you would GET, not the one you are reading.
    boton.textContent = idioma() === 'es' ? 'EN' : 'ES';
    // The chrome that lives in the HTML file rather than in a view: its English
    // is kept on the element the first time through, so switching back and
    // forth translates from the source every time instead of from itself.
    todos<HTMLElement>('[data-i18n]').forEach((el) => {
      if (!el.dataset.en) el.dataset.en = (el.textContent ?? '').trim();
      el.textContent = _(el.dataset.en);
    });
  };
  pon();
  boton.onclick = () => {
    ponIdioma(idioma() === 'es' ? 'en' : 'es');
    pon();
    void refresca();
  };
}

// Nothing in a browser reports itself. These two are why a person can say "it
// just did nothing" and be exactly right.
window.addEventListener('error', (e) =>
  anota('uncaught error', { mensaje: e.message, fichero: e.filename, linea: e.lineno }),
);
window.addEventListener('unhandledrejection', (e) =>
  anota('unhandled rejection', String((e as PromiseRejectionEvent).reason)),
);

arrastreDelRail();
interruptorDeIdioma();
tema();
void refresca();

export {};
