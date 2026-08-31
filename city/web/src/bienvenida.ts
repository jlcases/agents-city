/**
 * First run: a city, built by answering five short questions.
 *
 * What was here before was a checklist on a page of statistics about a city
 * that did not exist yet, and the Hall opened on a map with nothing to draw —
 * "Not drawn yet" as a first impression. A person arriving for the first time
 * does not need a dashboard. They need to be told, in their own words, what
 * this thing is and what to do next.
 *
 * So: one question per screen, plain language, every jargon word explained the
 * first time it appears, and nothing mandatory except the two decisions the
 * product genuinely cannot invent — what kind of work happens here, and who
 * does it. Everything is skippable and everything is re-editable afterwards
 * from the same pages that own it, because this flow writes through the very
 * same endpoints those pages use. It is a guide, not a second implementation.
 */

import { plural, t as _ } from './idioma';
import { FormularioDeCasa } from './casa';
import type { DatosDeCasa, Rol } from './casa';

export type { Rol } from './casa';

export interface Dominio {
  id: string;
  name: string;
  summary: string;
}

/** What the onboarding needs from the Hall. Passed in rather than imported, so
 * this file cannot quietly grow its own way of talking to the server. */
export interface Puerta {
  api: <T>(ruta: string, opts?: RequestInit) => Promise<T>;
  esc: (s: unknown) => string;
  aviso: (texto: string, malo?: boolean) => void;
  refresca: () => Promise<void>;
  /** Leave the guide and open a normal Hall section. */
  vete: (seccion: string) => void;
  ciudad: string;
  yo: string;
  datos: string;
}

const PASOS = ['Welcome', 'The work', 'Your chair', 'The houses', 'Ready'];

/** A house, drawn rather than shipped: the same isometric shape the map and the
 * desktop icon use, so the first thing somebody sees is already the product. */
function casita(color: string): string {
  return `<svg viewBox="0 0 120 108" role="img" aria-label="${_('an isometric house')}" class="bvCasa">
    <polygon points="60,10 112,40 60,70 8,40" fill="${color}" opacity=".95"/>
    <polygon points="8,40 60,70 60,100 8,70" fill="${color}" opacity=".62"/>
    <polygon points="112,40 60,70 60,100 112,70" fill="${color}" opacity=".40"/>
  </svg>`;
}

/** A path a person can read: their home is `~`, and the middle of a long one is
 *  not information — the end is. */
function corto(ruta: string): string {
  const casa = /^\/(Users|home)\/[^/]+/.exec(ruta);
  let corta = casa ? '~' + ruta.slice(casa[0].length) : ruta;
  if (corta.length > 44) corta = '…' + corta.slice(corta.length - 43);
  return corta;
}

export class Bienvenida {
  private paso = 0;
  private dominios: Dominio[] = [];
  private roles: Rol[] = [];
  private rolesDeAgente: Rol[] = [];
  private dominio = '';
  private rol = '';
  private roster: DatosDeCasa[] = [];
  private enCurso: FormularioDeCasa | null = null;
  private guardando = false;
  private lienzo: HTMLElement | null = null;

  constructor(private readonly p: Puerta) {}

  /**
   * The view contract, so the Hall's dispatcher treats every section the same.
   *
   * The painting itself is async — the first one asks the server for the domain
   * packs — and a router cannot wait on a view. It does not need to: the guide
   * draws a loading line first and fills itself in.
   */
  monta(host: HTMLElement): void {
    void this.pinta(host);
  }

  /** Draw the current step into `lienzo`. */
  async pinta(lienzo: HTMLElement): Promise<void> {
    this.lienzo = lienzo;
    if (!this.dominios.length) {
      lienzo.innerHTML = '<p class="cargando">reading the domain packs</p>';
      const [d, ra] = await Promise.all([
        this.p.api<{ domains: Dominio[] }>('/api/domains'),
        this.p.api<{ roles: Rol[] }>('/api/roles?scope=agent'),
      ]);
      this.dominios = d.domains;
      this.rolesDeAgente = ra.roles;
    }
    lienzo.innerHTML = `<div class="bv">${this.cabecera()}${await this.cuerpo()}</div>`;
    this.enlaza(lienzo);
  }

  private cabecera(): string {
    const puntos = PASOS.map(
      (nombre, i) =>
        `<span class="bvPunto ${i === this.paso ? 'aqui' : i < this.paso ? 'hecho' : ''}"
          title="${this.p.esc(_(nombre))}"><i></i>${this.p.esc(_(nombre))}</span>`,
    ).join('');
    return `<div class="bvPasos">${puntos}</div>`;
  }

  private async cuerpo(): Promise<string> {
    switch (this.paso) {
      case 0:
        return this.pantallaHola();
      case 1:
        return this.pantallaDominio();
      case 2:
        return await this.pantallaRol();
      case 3:
        return this.pantallaAgentes();
      default:
        return this.pantallaFinal();
    }
  }

  // ── 0. what this is ────────────────────────────────────────────────────────
  private pantallaHola(): string {
    return `
      <div class="bvHola">
        <div class="bvArte">${casita('#7048e8')}${casita('#45b9a7')}${casita('#f2674a')}</div>
        <div>
          <span class="sub">welcome</span>
          <h1>${_('A city is you, and the houses around you')}</h1>
          <p class="prosa">${_(`You take the chair. Around it, one <b>house</b> per worker — an
          <b>agent</b> — each with its own window, its own role and its own corner of your
          disk: a repository, three of them, a folder of documents, whatever it actually
          works on. The map draws them as houses that grow with the work done in them, and
          many houses are a city. They never talk to each other behind your back: you chair,
          they answer.`)}</p>
          <p class="prosa">${_('Nothing leaves this machine, there is no account, and everything is a plain file you can edit by hand afterwards.')}</p>
          <p class="prosa">${_('<b>Four questions and you are working.</b> You can skip any of them and change everything later.')}</p>
          <div class="bvBotones">
            <button class="bt ppal" data-bv="siguiente">${_('Let’s build it')}</button>
            <button class="bt" data-bv="salir">${_('I’ll set it up myself')}</button>
          </div>
          <!-- The path, quietly, under the decision rather than inside the
               sentence that has to persuade. It was set mid-paragraph and broke
               across two lines in the middle of itself, which is the most
               developer-tool thing a first screen can do — and somebody who
               wants it wants it once, not woven into prose. -->
          <p class="bvDato" title="${this.p.esc(this.p.datos)}">${_('it will live in {donde}', {
            donde: `<code>${this.p.esc(corto(this.p.datos))}</code>`,
          })}</p>
        </div>
      </div>`;
  }

  // ── 1. the domain ─────────────────────────────────────────────────────────
  private pantallaDominio(): string {
    const tarjetas = this.dominios
      .map(
        (d) => `
      <button class="bvOpcion ${this.dominio === d.id ? 'elegida' : ''}" data-bv="dominio"
        data-id="${this.p.esc(d.id)}">
        <b>${this.p.esc(d.name)}</b><span>${this.p.esc(d.summary)}</span></button>`,
      )
      .join('');
    return `
      <div class="bvPaso">
        <span class="sub">${_('question 1 of 4')}</span>
        <h1>${_('What kind of work happens here?')}</h1>
        <p class="prosa">${_(`It decides the vocabulary, the roles you will be offered and what
        counts as evidence in a decision. A clinic does not ship pull requests, and a law
        firm does not measure story points. Pick the closest one — you can change it later.`)}</p>
        <div class="bvRejilla">${tarjetas}</div>
        <div class="bvBotones">
          <button class="bt" data-bv="atras">${_('Back')}</button>
          <button class="bt ppal" data-bv="siguiente" ${this.dominio ? '' : 'disabled'}>${_('Next')}</button>
        </div>
      </div>`;
  }

  // ── 2. your chair ─────────────────────────────────────────────────────────
  private async pantallaRol(): Promise<string> {
    if (!this.roles.length || this.roles[0]?.id === undefined) {
      const r = await this.p.api<{ roles: Rol[] }>(
        '/api/roles?domain=' + encodeURIComponent(this.dominio),
      );
      this.roles = r.roles;
    }
    const tarjetas = this.roles
      .map(
        (r) => `
      <button class="bvOpcion ${this.rol === r.id ? 'elegida' : ''}" data-bv="rol"
        data-id="${this.p.esc(r.id)}">
        <b>${this.p.esc(r.name)}</b><span>${this.p.esc(r.summary || r.trade)}</span></button>`,
      )
      .join('');
    return `
      <div class="bvPaso">
        <span class="sub">${_('question 2 of 4')}</span>
        <h1>${_('And what are you, here?')}</h1>
        <p class="prosa">${_(`You chair this city whatever you answer — this is your
        <b>speciality</b>, not your authority. It shapes the perspective you bring to a
        decision and the knowledge files the city writes for you. <b>Blank</b> is a real
        answer: it means no preset knowledge.`)}</p>
        <div class="bvRejilla">${tarjetas}</div>
        <div class="bvBotones">
          <button class="bt" data-bv="atras">${_('Back')}</button>
          <button class="bt ppal" data-bv="siguiente" ${this.rol ? '' : 'disabled'}>Next</button>
        </div>
      </div>`;
  }

  // ── 3. the agents ─────────────────────────────────────────────────────────
  private pantallaAgentes(): string {
    if (!this.enCurso) return this.listaDeAgentes();
    // The form mounts itself into this hole after the step is on screen: it
    // repaints on its own as chips are ticked and the disk index arrives, and
    // that must never take the step's frame down with it.
    return `
      <div class="bvPaso">
        <span class="sub">${_('a new house')}</span>
        <h1>${_('Who lives in it?')}</h1>
        <div id="bvCasa"></div>
        <div class="bvBotones">
          <button class="bt" data-bv="cancela">${_('Cancel')}</button>
          <button class="bt ppal" data-bv="guarda" ${this.guardando ? 'disabled' : ''}>${_(
            this.guardando ? 'building…' : 'Build it',
          )}</button>
        </div>
      </div>`;
  }

  private listaDeAgentes(): string {
    const fichas = this.roster
      .map(
        (a) => `
      <div class="bvFicha">
        <b>${this.p.esc(a.nombre)}</b>
        <span>${this.p.esc(a.clase)} · ${this.p.esc(a.rol)}</span>
        <span class="de">${
          a.montajes.length
            ? this.p.esc(a.montajes.map((m) => m.split('/').pop()).join(', '))
            : _('nothing mounted yet')
        }</span>
      </div>`,
      )
      .join('');
    return `
      <div class="bvPaso">
        <span class="sub">${_('question 3 of 4')}</span>
        <h1>${_(this.roster.length ? 'Who else lives here?' : 'Who lives in your city?')}</h1>
        <p class="prosa">${_(`Every house holds one worker — an <b>agent</b> — with its own window,
        its own role and its own corner of your disk. A house is <b>not</b> a repository: one
        can answer for three services and a folder of documents at once, and a house whose
        work is documents needs no git anywhere.`)}</p>
        ${this.roster.length ? `<div class="bvFichas">${fichas}</div>` : ''}
        <div class="bvBotones">
          <button class="bt ppal" data-bv="nuevo">${_(
            this.roster.length ? 'Add another house' : 'Build the first house',
          )}</button>
          <button class="bt" data-bv="siguiente">${_(
            this.roster.length ? 'That is everyone' : 'Nobody yet — I answer alone',
          )}</button>
        </div>
        ${
          this.roster.length
            ? ''
            : `<p class="prosa apunte">${_(`A city with no houses does not delegate: the seat
              answers, and it is the only one who can. That is a real choice for a role whose
              work is other people's cities rather than folders — and it is not the usual one.
              Houses can be added later, from here or with <b>agents-city seat --agents</b>.`)}</p>`
        }
      </div>`;
  }

  // ── 4. done ───────────────────────────────────────────────────────────────
  private pantallaFinal(): string {
    return `
      <div class="bvPaso">
        <span class="sub">${_('Ready').toLowerCase()}</span>
        <h1>${_('{city} is alive', { city: this.p.esc(this.p.ciudad) })}</h1>
        <p class="prosa">${_(
          'Your seat is written and {cuantas}. Everything you just answered is a plain file you can read and edit.',
          {
            cuantas: this.roster.length
              ? plural(
                  this.roster.length,
                  '<b>{n}</b> house stands around it',
                  '<b>{n}</b> houses stand around it',
                )
              : _('the city is waiting for its first house'),
          },
        )}</p>
        <p class="prosa">${_('What people usually do next:')}</p>
        <div class="bvSiguientes">
          <button class="bt ppal" data-bv="sesion">${_('Open my session')}</button>
          <button class="bt" data-bv="ir-gente">${_('See the houses')}</button>
          <button class="bt" data-bv="ir-mapa">${_('Draw the map')}</button>
          <button class="bt" data-bv="ir-puesto">${_('Set a goal')}</button>
        </div>
        <p class="pista">${_(`A goal is optional, and the city works without one — but a round with
        no goal is a status report, because there is nothing to argue against.`)}</p>
      </div>`;
  }

  // ── wiring ────────────────────────────────────────────────────────────────
  private enlaza(lienzo: HTMLElement): void {
    const repinta = (): void => void this.pinta(lienzo);
    lienzo.querySelectorAll<HTMLElement>('[data-bv]').forEach((el) => {
      el.onclick = async (evento) => {
        evento.preventDefault();
        const que = el.dataset.bv;
        if (que === 'salir') return this.p.vete('resumen');
        if (que === 'atras') {
          this.paso = Math.max(0, this.paso - 1);
          return repinta();
        }
        if (que === 'dominio') {
          this.dominio = el.dataset.id ?? '';
          this.roles = [];
          this.rol = '';
          return repinta();
        }
        if (que === 'rol') {
          this.rol = el.dataset.id ?? '';
          return repinta();
        }
        if (que === 'nuevo') {
          this.enCurso = new FormularioDeCasa(
            { api: this.p.api, esc: this.p.esc, aviso: this.p.aviso, yo: this.p.yo },
            this.rolesDeAgente,
          );
          return repinta();
        }
        if (que === 'cancela') {
          this.enCurso = null;
          return repinta();
        }
        if (que === 'guarda') return void (await this.guardaAgente(lienzo));
        if (que === 'siguiente') return void (await this.avanza(lienzo));
        if (que === 'sesion') return void (await this.abreSesion());
        if (que === 'ir-gente') return this.p.vete('gente');
        if (que === 'ir-mapa') return this.p.vete('mapa');
        if (que === 'ir-puesto') return this.p.vete('puesto');
      };
    });
    const hueco = lienzo.querySelector<HTMLElement>('#bvCasa');
    if (hueco && this.enCurso) {
      this.enCurso.monta(hueco);
      hueco.querySelector<HTMLInputElement>('#bvNombre')?.focus();
    }
  }

  private async guardaAgente(lienzo: HTMLElement): Promise<void> {
    const forma = this.enCurso;
    if (!forma) return;
    this.guardando = true;
    await this.pinta(lienzo);
    try {
      // The seat has to exist before an agent can join it: agents live on the
      // owner's card. Writing it here is why this step can come before the goal.
      await this.aseguraFicha();
      const hecho = await forma.guarda();
      if (!hecho) return;
      this.roster.push({ ...forma.datos, nombre: hecho.nombre });
      this.enCurso = null;
      this.p.aviso(_('{name} joined the city', { name: hecho.nombre }));
      await this.p.refresca();
    } finally {
      this.guardando = false;
      await this.pinta(lienzo);
    }
  }

  private async aseguraFicha(): Promise<void> {
    await this.p.api<{ ok?: boolean; error?: string }>('/api/ficha', {
      method: 'POST',
      body: JSON.stringify({ domain: this.dominio || 'software', role: this.rol || 'blank' }),
    });
  }

  private async avanza(lienzo: HTMLElement): Promise<void> {
    // The step moves FIRST, and only then does anything touch the server.
    // Refreshing the Hall repaints this view, and a repaint that lands after a
    // slow write would otherwise redraw the step the person just left — the
    // guide silently bouncing back one screen.
    const escribeLaFicha = this.paso === 2;
    this.paso = Math.min(PASOS.length - 1, this.paso + 1);
    await this.pinta(lienzo);
    if (escribeLaFicha) {
      // The chair is written the moment it is answered, so leaving halfway
      // still leaves a usable city behind rather than nothing.
      await this.aseguraFicha();
      await this.p.refresca();
    }
  }

  private async abreSesion(): Promise<void> {
    try {
      const r = await this.p.api<{ ok?: boolean; attach?: string; error?: string }>('/api/sesion', {
        method: 'POST',
        body: JSON.stringify({ user: this.p.yo }),
      });
      this.p.aviso(
        r.ok && r.attach ? `Session built — attach with: ${r.attach}` : (r.error ?? 'Could not'),
        !r.ok,
      );
    } catch (e) {
      this.p.aviso(String(e), true);
    }
  }
}
