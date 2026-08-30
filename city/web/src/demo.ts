/**
 * The demo shelf: a committee, played back.
 *
 * `agents-city demo` has always existed and it is the honest one — an ephemeral
 * city, the real bus, the real state machine. It also asks for a terminal, a
 * wrangler download and two minutes. Somebody deciding whether this product is
 * for their clinic or their law firm will not do that first; they will look for
 * a play button, and there wasn't one.
 *
 * So the Hall plays a **recording**. Not a simulation: `demo/graba.py` runs each
 * story over that same real bus and keeps the exact event stream a spectator
 * saw, and this plays those events back through the very same renderer the live
 * rail uses. Nothing here knows what a committee is, which is the point — a
 * second implementation of the state machine is a second thing to drift.
 *
 * It says on screen that it is a recording. A demo that pretends to be live is
 * the one kind of demo this product must never ship.
 */

import type { ActivityEvent } from './activity';
import { t as _ } from './idioma';
import { Montada } from './vista';

export interface Ficha {
  id: string;
  dominio: string;
  ciudad: string;
  titulo: string;
  turnos: number;
  reparto: string[];
}

interface Grabacion extends Ficha {
  eventos: ActivityEvent[];
  error?: string;
}

export interface PuertaDemo {
  api: <T>(ruta: string, opts?: RequestInit) => Promise<T>;
  esc: (s: unknown) => string;
  /** The live rail's own turn renderer — the same one, deliberately. */
  pinta: (evento: ActivityEvent) => string;
}

/** How fast a turn arrives, in milliseconds. The middle one is the pace the
 * terminal demo uses, so the two feel like the same product. */
const VELOCIDADES: Array<[string, number]> = [
  ['0.5×', 2900],
  ['1×', 1450],
  ['2×', 700],
  ['4×', 350],
];

export class Demos extends Montada {
  private catalogo: Ficha[] = [];
  private cargando = false;
  private elegida: Grabacion | null = null;
  private hasta = 0;
  private corriendo = false;
  private velocidad = 1450;
  private reloj: number | null = null;

  constructor(private readonly p: PuertaDemo) {
    super();
  }

  override monta(host: HTMLElement): void {
    if (!this.catalogo.length && !this.cargando) void this.lee();
    super.monta(host);
  }

  /** Stop the clock. The router calls this when the section is left: a timer
   * still firing into a detached node is a leak with a soundtrack. */
  desmonta(): void {
    this.corriendo = false;
    if (this.reloj !== null) {
      clearTimeout(this.reloj);
      this.reloj = null;
    }
  }

  protected override repinta(): void {
    super.repinta();
    const lista = this.elegida ? this.host?.querySelector<HTMLElement>('#demoLista') : null;
    if (lista) lista.scrollTop = lista.scrollHeight;
  }

  private async lee(): Promise<void> {
    this.cargando = true;
    try {
      const r = await this.p.api<{ demos: Ficha[] }>('/api/demos');
      this.catalogo = r.demos ?? [];
    } catch {
      this.catalogo = [];
    } finally {
      this.cargando = false;
      this.repinta();
    }
  }

  private async abre(id: string): Promise<void> {
    this.desmonta();
    this.hasta = 0;
    this.elegida = null;
    this.repinta();
    try {
      const r = await this.p.api<Grabacion>('/api/demos?story=' + encodeURIComponent(id));
      if (!r.error) this.elegida = r;
    } catch {
      this.elegida = null;
    }
    this.repinta();
    if (this.elegida) this.arranca();
  }

  private arranca(): void {
    if (!this.elegida) return;
    if (this.hasta >= this.elegida.eventos.length) this.hasta = 0;
    this.corriendo = true;
    this.repinta();
    this.siguiente();
  }

  private siguiente(): void {
    if (this.reloj !== null) clearTimeout(this.reloj);
    this.reloj = window.setTimeout(() => {
      if (!this.corriendo || !this.elegida) return;
      const evento = this.elegida.eventos[this.hasta];
      this.hasta += 1;
      const final = this.hasta >= this.elegida.eventos.length;
      if (final) {
        this.hasta = this.elegida.eventos.length;
        this.corriendo = false;
      }
      // A turn arriving is one more turn on the list. Repainting the player
      // rebuilt every turn so far from zero, rebound the four speed buttons and
      // forced a layout — twenty-two times, to append twenty-two lines. The
      // full repaint is kept for the transitions that actually change the
      // controls: play, pause, replay, and the end.
      if (evento && !final) this.anade(evento);
      else this.repinta();
      if (!final) this.siguiente();
    }, this.velocidad);
  }

  /** One more turn on screen, without taking the screen down. */
  private anade(evento: ActivityEvent): void {
    const lista = this.host?.querySelector<HTMLElement>('#demoLista');
    if (!lista || !this.elegida) return this.repinta();
    const vacia = lista.querySelector('.liveEmpty');
    if (vacia) lista.innerHTML = '';
    lista.insertAdjacentHTML('beforeend', this.p.pinta(evento));
    lista.scrollTop = lista.scrollHeight;
    this.marcador();
  }

  /** The counter and the bar, which are the only other things a turn moves. */
  private marcador(): void {
    if (!this.host || !this.elegida) return;
    const total = this.elegida.eventos.length;
    const hecho = Math.min(this.hasta, total);
    const cuenta = this.host.querySelector<HTMLElement>('.demoCuenta');
    if (cuenta) cuenta.textContent = _('{done} of {total}', { done: hecho, total });
    const barra = this.host.querySelector<HTMLElement>('.demoBarra i');
    if (barra) barra.style.width = `${total ? (hecho / total) * 100 : 0}%`;
  }

  protected html(): string {
    if (this.elegida) return this.reproductor(this.elegida);
    if (this.cargando) return `<p class="cargando">${_('reading the demo shelf')}</p>`;
    if (!this.catalogo.length)
      return `<div><span class="sub">${_('demos')}</span>
        <h1 style="margin-top:6px">${_('Nothing recorded here')}</h1>
        <p class="prosa">${_('This install has no demo recordings. Make them with demo/graba.py, or run the full thing from a terminal with agents-city demo.')}</p></div>`;
    const esc = this.p.esc;
    return `<div>
      <span class="sub">${_('demos')}</span>
      <h1 style="margin-top:6px">${_('See a committee happen')}</h1>
      <p class="prosa">${_(`A real question, answered by a city of agents that never talk to each
      other behind the chair's back. Pick the field closest to yours — the machine is the same
      one in all three; only the work changes.`)}</p>
      <div class="demoRejilla">${this.catalogo
        .map(
          (d) => `<button type="button" class="demoCarta" data-demo="abre" data-id="${esc(d.id)}">
          <span class="demoDominio">${esc(d.dominio)}</span>
          <b>${esc(d.titulo)}</b>
          <span class="demoCiudad">${esc(d.ciudad)}</span>
          <span class="demoReparto">${esc(d.reparto.join(' · '))}</span>
          <span class="demoPlay">▶ ${_('{n} turns', { n: d.turnos })}</span>
        </button>`,
        )
        .join('')}</div>
      <p class="pista">${_('These are recordings of real runs over the real bus, played back here. To run one live in a terminal: agents-city demo --domain software.')}</p>
    </div>`;
  }

  private reproductor(d: Grabacion): string {
    const esc = this.p.esc;
    const total = d.eventos.length;
    const hecho = Math.min(this.hasta, total);
    const turnos = d.eventos.slice(0, hecho).map(this.p.pinta).join('');
    const acabado = hecho >= total;
    return `<div class="demoPlayer">
      <div class="demoCab">
        <button type="button" class="bt bvMini" data-demo="atras">← ${_('All demos')}</button>
        <div><span class="sub">${esc(d.dominio)} · ${esc(d.ciudad)}</span>
          <h2>${esc(d.titulo)}</h2></div>
      </div>
      <div class="demoMandos">
        <button type="button" class="bt ppal" data-demo="${this.corriendo ? 'pausa' : 'play'}">${
          this.corriendo ? `❚❚ ${_('Pause')}` : acabado ? `↺ ${_('Replay')}` : `▶ ${_('Play')}`
        }</button>
        ${
          // Once it has finished, the primary button already says Replay and
          // does exactly this. Two identical controls side by side is a person
          // wondering which one is the real one.
          hecho && !acabado
            ? `<button type="button" class="bt" data-demo="replay">↺ ${_('Replay')}</button>`
            : ''
        }
        <span class="demoVel">${VELOCIDADES.map(
          ([etiqueta, ms]) =>
            `<button type="button" class="demoVelBoton ${
              ms === this.velocidad ? 'aqui' : ''
            }" data-demo="vel" data-ms="${ms}">${esc(etiqueta)}</button>`,
        ).join('')}</span>
        <span class="demoCuenta">${_('{done} of {total}', { done: hecho, total })}</span>
      </div>
      <div class="demoBarra"><i style="width:${total ? (hecho / total) * 100 : 0}%"></i></div>
      <ol class="liveLista" id="demoLista">${
        turnos ||
        `<li class="liveEmpty">${_('Press play. The turns arrive one by one, exactly as they did.')}</li>`
      }</ol>
      <p class="pista">${_('A recording of a real run: these events came off the real bus, from the real committee. Nothing here is being decided now.')}</p>
    </div>`;
  }

  protected enlaza(raiz: HTMLElement): void {
    raiz.querySelectorAll<HTMLElement>('[data-demo]').forEach((el) => {
      el.onclick = (evento) => {
        evento.preventDefault();
        switch (el.dataset.demo) {
          case 'abre':
            void this.abre(el.dataset.id ?? '');
            break;
          case 'atras':
            this.desmonta();
            this.elegida = null;
            this.hasta = 0;
            this.repinta();
            break;
          case 'play':
            this.arranca();
            break;
          case 'pausa':
            this.desmonta();
            this.repinta();
            break;
          case 'replay':
            this.desmonta();
            this.hasta = 0;
            this.arranca();
            break;
          case 'vel': {
            this.velocidad = Number(el.dataset.ms) || 1450;
            // Take effect on the next turn rather than after the one already
            // scheduled at the old pace: a speed control that waits three
            // seconds to be believed reads as broken.
            if (this.corriendo) this.siguiente();
            this.repinta();
            break;
          }
        }
      };
    });
  }
}
