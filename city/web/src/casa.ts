/**
 * Building one house: name, work, role, engine and everything it works on.
 *
 * This lived inside the first-run guide, and the Hall had its own version of the
 * same question made of three chained `window.prompt` boxes — name, then kind,
 * then role, with no engine and no way to pick a folder. Two implementations of
 * one question, and the worse one was the one people met after the first day.
 *
 * So it is one form, mounted wherever it is needed: inside the guide as a step,
 * inside a dialog from the houses view. It owns its own state and repaints
 * itself; the host owns the frame around it and decides what the buttons say.
 */

import { plural, t as _ } from './idioma';
import { Explorador } from './explorador';
import { ESFUERZOS, RUNTIMES, motorDe, opciones } from './motores';
import { Montada } from './vista';

export interface Rol {
  id: string;
  name: string;
  summary: string;
  trade: string;
}

export interface DatosDeCasa {
  nombre: string;
  clase: string;
  rol: string;
  montajes: string[];
  /** Which CLI runs it, and — on Claude — the engine and how hard it thinks.
   * Empty means the owner's default, which is a real answer and the one most
   * people should give. */
  runtime: string;
  modelo: string;
  esfuerzo: string;
}

/** What the form needs from whoever is hosting it. */
export interface Puerta {
  api: <T>(ruta: string, opts?: RequestInit) => Promise<T>;
  esc: (s: unknown) => string;
  aviso: (texto: string, malo?: boolean) => void;
  yo: string;
}

export const CLASES: Array<[string, string, string]> = [
  [
    'code',
    'It writes code',
    'Its house grows with the pull requests it merges. Mounts repositories and worktrees.',
  ],
  [
    'knowledge',
    'It keeps knowledge',
    'Its house grows with the documents it writes. Needs no git at all.',
  ],
  ['coordinator', 'It coordinates', 'Its house grows with the decisions it records.'],
];

export class FormularioDeCasa extends Montada {
  readonly datos: DatosDeCasa = {
    nombre: '',
    clase: 'code',
    rol: 'blank',
    montajes: [],
    runtime: '',
    modelo: '',
    esfuerzo: '',
  };
  private roles: Rol[] = [];
  private rolesPedidos = false;
  constructor(
    private readonly p: Puerta,
    roles: Rol[] = [],
  ) {
    super();
    this.roles = roles;
  }

  override monta(host: HTMLElement): void {
    void this.aseguraRoles();
    super.monta(host);
    // The picker is a view of its own, living in a hole this one leaves for it.
    const hueco = host.querySelector<HTMLElement>('.casaExp');
    if (hueco) this.explora().monta(hueco);
  }

  protected override repinta(): void {
    // A repaint here rebuilds the hole too, so the picker has to be remounted
    // into the new one — which is what `monta` does.
    if (this.host) this.monta(this.host);
  }

  /** Asked once, ever. `monta` runs on every repaint, so a guard on "did we get
   * any roles back" would refetch — and repaint, and refetch — forever the day
   * the catalogue comes back empty. */
  private async aseguraRoles(): Promise<void> {
    if (this.rolesPedidos) return;
    this.rolesPedidos = true;
    try {
      const r = await this.p.api<{ roles: Rol[] }>('/api/roles?scope=agent');
      this.roles = r.roles ?? [];
      if (this.roles.length) this.repinta();
    } catch {
      this.roles = []; // the role list is a convenience; blank is always valid
    }
  }

  /** The folder picker, built once so walking survives a repaint. */
  private explorador: Explorador | null = null;

  private explora(): Explorador {
    if (!this.explorador)
      this.explorador = new Explorador(
        this.p,
        (ruta) => {
          const ya = this.datos.montajes.indexOf(ruta);
          if (ya >= 0) this.datos.montajes.splice(ya, 1);
          else this.datos.montajes.push(ruta);
          // Only the strip of chosen chips changes here. Repainting the whole
          // form tore the picker down and rebuilt it mid-click — one tick
          // rendered two thousand rows twice, and lost the person's place.
          this.pintaElegidas();
        },
        () => this.datos.montajes,
      );
    return this.explorador;
  }

  protected html(): string {
    const a = this.datos;
    const esc = this.p.esc;
    const clases = CLASES.map(
      ([id, titulo, porque]) => `
      <button type="button" class="bvOpcion ${a.clase === id ? 'elegida' : ''}"
        data-bv="clase" data-id="${id}">
        <b>${_(titulo)}</b><span>${_(porque)}</span></button>`,
    ).join('');
    const roles = this.roles
      .map(
        (r) =>
          `<option value="${esc(r.id)}"${r.id === a.rol ? ' selected' : ''}>${esc(r.name)}</option>`,
      )
      .join('');
    const motor = motorDe(a.runtime);
    return `
      <div class="campo"><label>${_('What do you call it?')}</label>
        <input type="text" id="bvNombre" value="${esc(a.nombre)}"
          placeholder="${_('urgencias, api, the handbook — whatever you would say out loud')}"></div>
      <label class="bvEtiqueta">${_('What kind of work does it do?')}</label>
      <div class="bvRejilla bvTres">${clases}</div>
      <div class="campo"><label>${_('Its role — its speciality, never authority')}</label>
        <select id="bvRol">${roles}</select></div>
      <label class="bvEtiqueta">${_('What runs it?')}</label>
      <p class="pista">${_(
        'Leave all three on default and it runs the way you do. Whatever you set here is written once on the card, and the launcher hands it to whichever CLI runs this house.',
      )}</p>
      <div class="bvMotor">
        <div class="campo"><label>${_('provider')}</label>
          <select id="bvRuntime">${opciones(RUNTIMES, a.runtime, esc, 'claude')}</select></div>
        <div class="campo"><label>${_('engine')}</label>
          ${
            motor.modelos.length
              ? `<select id="bvModelo">${opciones(
                  [''].concat(motor.modelos),
                  a.modelo,
                  esc,
                  _('default'),
                )}</select>`
              : `<input type="text" id="bvModelo" value="${esc(a.modelo)}"
                  placeholder="${_('default')}" autocomplete="off" spellcheck="false">`
          }</div>
        <div class="campo"><label>${_('effort')}</label>
          <select id="bvEsfuerzo" ${motor.esfuerzo ? '' : 'disabled'}
            title="${motor.esfuerzo ? '' : _('This CLI has no effort setting.')}">${opciones(
              [''].concat(ESFUERZOS),
              motor.esfuerzo ? a.esfuerzo : '',
              esc,
              _('default'),
            )}</select></div>
      </div>
      <p class="pista">${esc(_(motor.pista))}</p>
      <label class="bvEtiqueta">${_('What does it work on?')}</label>
      <p class="pista">${_(`Walk your disk and pick whatever you like: a repository, a
      worktree, a folder of documents, one exact file. As many as you want. Nothing is
      copied — each one is linked into this agent's own home.`)}</p>
      <div class="casaExp"></div>
      <div id="casaElegidas">${this.elegidas()}</div>`;
  }

  /** The mounts chosen so far, as chips you can take back off. Rendered on its
   * own so ticking a row does not rebuild the picker underneath the cursor. */
  private elegidas(): string {
    const esc = this.p.esc;
    const montajes = this.datos.montajes;
    if (!montajes.length)
      return `<p class="pista">${_('Nothing chosen yet — an agent with no mounts is fine too.')}</p>`;
    return `<div class="expElegidas"><label class="bvEtiqueta">${_('Working on')}</label>
      ${montajes
        .map(
          (m) => `<button type="button" class="bvChip elegida" data-bv="quita"
            data-ruta="${esc(m)}" title="${esc(m)}">${esc(
              m.split('/').pop() || m,
            )}<i class="expQuita">✕</i></button>`,
        )
        .join('')}</div>`;
  }

  private pintaElegidas(): void {
    const hueco = this.host?.querySelector<HTMLElement>('#casaElegidas');
    if (!hueco) return;
    hueco.innerHTML = this.elegidas();
    this.enlaza(hueco);
  }

  protected enlaza(raiz: HTMLElement): void {
    raiz.querySelectorAll<HTMLElement>('[data-bv]').forEach((el) => {
      el.onclick = (evento) => {
        evento.preventDefault();
        const que = el.dataset.bv;
        this.recoge();
        if (que === 'clase') this.datos.clase = el.dataset.id ?? 'code';
        else if (que === 'quita') {
          const ya = this.datos.montajes.indexOf(el.dataset.ruta ?? '');
          if (ya >= 0) this.datos.montajes.splice(ya, 1);
        }
        this.repinta();
      };
    });
    raiz.querySelector<HTMLSelectElement>('#bvRuntime')?.addEventListener('change', () => {
      this.recoge();
      this.repinta();
    });
  }

  /** Keep what is typed when a click forces a repaint.
   *
   * Always from the form's own root, never from whatever element the click
   * came through: the chosen-chips strip re-uses this wiring, and reading the
   * fields relative to that strip would find none of them and quietly throw
   * away everything the person had typed. */
  private recoge(): void {
    const raiz = this.host;
    if (!raiz) return;
    const nombre = raiz.querySelector<HTMLInputElement>('#bvNombre');
    const rol = raiz.querySelector<HTMLSelectElement>('#bvRol');
    if (nombre) this.datos.nombre = nombre.value;
    if (rol) this.datos.rol = rol.value;
    for (const [id, campo] of [
      ['#bvRuntime', 'runtime'],
      ['#bvModelo', 'modelo'],
      ['#bvEsfuerzo', 'esfuerzo'],
    ] as const) {
      const sel = raiz.querySelector<HTMLSelectElement | HTMLInputElement>(id);
      if (sel) this.datos[campo] = sel.value.trim();
    }
  }

  /**
   * Build it. Returns the new agent's slug, or null when nothing was written.
   *
   * Three endpoints by necessity, not by sloppiness: `/api/agentes` owns who is
   * on the roster, `/api/montaje` owns what an agent can reach, and
   * `/api/agente` owns how one is run. None of them is allowed to learn
   * another's job just to save a round trip.
   */
  async guarda(): Promise<{ slug: string; nombre: string } | null> {
    this.recoge();
    const a = this.datos;
    const nombre = a.nombre.trim();
    if (!nombre) {
      this.p.aviso(_('Give it a name — it is how you will call it in its window'), true);
      return null;
    }
    try {
      const r = await this.p.api<{ ok?: boolean; agent?: string; error?: string }>('/api/agentes', {
        method: 'POST',
        body: JSON.stringify({ name: nombre, kind: a.clase, role: a.rol }),
      });
      if (!r.ok || !r.agent) {
        this.p.aviso(r.error || _('Could not add that agent'), true);
        return null;
      }
      // The mounts are independent of each other; awaiting them one at a time
      // put six serialised round trips on the critical path of "Build it".
      const montados = await Promise.all(
        a.montajes.map((ruta) =>
          this.p
            .api<{ ok?: boolean; error?: string }>('/api/montaje', {
              method: 'POST',
              body: JSON.stringify({ agent: r.agent, add: ruta }),
            })
            .then((m) => (m.ok ? '' : `${ruta}: ${m.error ?? _('could not mount')}`))
            .catch((e) => `${ruta}: ${String(e)}`),
        ),
      );
      for (const fallo of montados.filter(Boolean)) this.p.aviso(fallo, true);
      const motor: Record<string, string> = {};
      if (a.runtime) motor.runtime = a.runtime;
      if (a.modelo) motor.model = a.modelo;
      if (a.esfuerzo) motor.effort = a.esfuerzo;
      if (Object.keys(motor).length) {
        const m = await this.p.api<{ ok?: boolean; error?: string }>('/api/agente', {
          method: 'POST',
          body: JSON.stringify({ agent: r.agent, ...motor }),
        });
        if (!m.ok) this.p.aviso(m.error ?? _('Could not set its engine'), true);
      }
      return { slug: r.agent, nombre };
    } catch (e) {
      this.p.aviso(String(e), true);
      return null;
    }
  }

  /** How this house reads on a list, once it is built. */
  resumen(): string {
    const a = this.datos;
    return a.montajes.length
      ? plural(a.montajes.length, '{n} mount', '{n} mounts')
      : _('nothing mounted yet');
  }
}
