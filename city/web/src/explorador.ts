/**
 * A folder picker. You walk, you choose.
 *
 * What was here before scanned the whole disk and offered what it had decided
 * you probably wanted: your repositories, ranked. That is the wrong shape for
 * this question. A person choosing what an agent works on already knows where
 * their work is; being handed a guessed list of two hundred things is not help,
 * it is a second list to read before you can do what you came to do. And it
 * could only ever offer what it knew how to look for — a repository, a folder
 * of markdown — never *that* file, in *that* folder, which is a perfectly
 * ordinary thing to want.
 *
 * So: a folder, its contents, and a way up and down. Nothing is offered in
 * advance and nothing is filtered out. Folders are marked `git` or `wt` when
 * they are, because that is worth knowing — never because it changes what you
 * are allowed to pick.
 */

import { plural, t as _ } from './idioma';

export interface Entrada {
  nombre: string;
  ruta: string;
  dir: boolean;
  /** `repo` · `worktree` · `` — a label, never a filter. */
  git: string;
  enlace: boolean;
}

interface Listado {
  ruta: string;
  arriba: string;
  atajos: Array<{ nombre: string; ruta: string }>;
  entradas: Entrada[];
  recortada: boolean;
  error?: string;
}

export interface PuertaExp {
  api: <T>(ruta: string, opts?: RequestInit) => Promise<T>;
  esc: (s: unknown) => string;
}

const MARCA: Record<string, string> = { repo: 'git', worktree: 'wt' };

export class Explorador {
  private aqui = '';
  private listado: Listado | null = null;
  private cargando = false;
  private fallo = '';
  private host: HTMLElement | null = null;

  constructor(
    private readonly p: PuertaExp,
    /** Called with a path when a row's + is pressed. */
    private readonly elige: (ruta: string) => void,
    /** Which paths are already chosen, so their rows read as chosen. */
    private readonly yaElegidas: () => string[],
  ) {}

  /** Render into `host` and wire it. Safe to call again: that is the repaint. */
  monta(host: HTMLElement): void {
    this.host = host;
    if (!this.listado && !this.cargando) void this.ve(this.aqui || '~');
    host.innerHTML = this.html();
    this.enlaza(host);
  }

  private repinta(): void {
    if (!this.host) return;
    this.host.innerHTML = this.html();
    this.enlaza(this.host);
  }

  /** Walk to a folder. An unreadable one is said out loud, not swallowed. */
  async ve(ruta: string): Promise<void> {
    this.cargando = true;
    this.fallo = '';
    // Only when there is nothing on screen yet. Otherwise this rendered markup
    // byte-identical to what was already there — the loading branch only draws
    // when there is no listing — which made every step into a folder cost two
    // full renders instead of one.
    if (!this.listado) this.repinta();
    try {
      const r = await this.p.api<Listado>('/api/carpeta?path=' + encodeURIComponent(ruta));
      if (r.error) this.fallo = r.error;
      else {
        this.listado = r;
        this.aqui = r.ruta;
      }
    } catch (e) {
      this.fallo = String(e);
    } finally {
      this.cargando = false;
      this.repinta();
    }
  }

  private migas(): string {
    const esc = this.p.esc;
    const l = this.listado;
    if (!l) return '';
    const partes = l.ruta.split('/').filter(Boolean);
    let acumulado = '';
    const trozos = partes.map((parte) => {
      acumulado += '/' + parte;
      return `<button type="button" class="expMiga" data-exp="ve" data-ruta="${esc(
        acumulado,
      )}">${esc(parte)}</button>`;
    });
    return (
      `<button type="button" class="expMiga" data-exp="ve" data-ruta="/">/</button>` +
      trozos.join('<i>/</i>')
    );
  }

  html(): string {
    const esc = this.p.esc;
    const l = this.listado;
    const elegidas = new Set(this.yaElegidas());
    // Out of the loop: two fixed labels, translated once instead of per row.
    const yaEsta = _('Already chosen');
    const anade = _('Add this');
    const filas = (l?.entradas ?? [])
      .map((e) => {
        const puesta = elegidas.has(e.ruta);
        return `<div class="expFila ${e.dir ? 'dir' : 'fich'} ${puesta ? 'puesta' : ''}">
        <button type="button" class="expNombre" ${
          e.dir ? `data-exp="ve" data-ruta="${esc(e.ruta)}"` : 'disabled'
        } title="${esc(e.ruta)}">
          <i class="expIcono">${e.dir ? '▸' : '·'}</i>${esc(e.nombre)}${
            e.git ? `<em class="expMarca">${esc(MARCA[e.git] ?? e.git)}</em>` : ''
          }${e.enlace ? '<em class="expMarca">link</em>' : ''}</button>
        <button type="button" class="expMas" data-exp="toma" data-ruta="${esc(e.ruta)}"
          title="${esc(puesta ? yaEsta : anade)}">${puesta ? '✓' : '+'}</button>
      </div>`;
      })
      .join('');
    const atajos = (l?.atajos ?? [])
      .map(
        (a) =>
          `<button type="button" class="expAtajo ${
            a.ruta === l?.ruta ? 'aqui' : ''
          }" data-exp="ve" data-ruta="${esc(a.ruta)}">${esc(a.nombre)}</button>`,
      )
      .join('');
    return `
      <div class="exp">
        <div class="expAtajos">${atajos}</div>
        <div class="expBarra">
          <button type="button" class="expSubir" data-exp="ve"
            data-ruta="${esc(l?.arriba ?? '~')}" ${l?.arriba ? '' : 'disabled'}
            title="${_('Up one folder')}">↑</button>
          <div class="expMigas">${this.migas()}</div>
        </div>
        ${this.cuenta(l)}
        ${
          this.fallo
            ? `<p class="pista malo">${esc(this.fallo)}</p>`
            : this.cargando && !l
              ? `<p class="cargando">${_('reading that folder')}</p>`
              : filas
                ? `<div class="expLista">${filas}</div>`
                : `<p class="pista">${_('This folder is empty.')}</p>`
        }
        ${l?.recortada ? `<p class="pista">${_('Only the first 2000 shown.')}</p>` : ''}
        <button type="button" class="bt bvMini expTomaAqui" data-exp="toma"
          data-ruta="${esc(l?.ruta ?? '')}" ${l ? '' : 'disabled'}>${_('Add this folder')}</button>
      </div>`;
  }

  /**
   * What is in this folder, said before you scroll.
   *
   * Folders sort first, as every file picker has done for forty years — which
   * means in a folder with eight of them the files start below the fold, and a
   * list that does not say they are there reads as a folder-only picker. This
   * line is the difference between "there are no files here" and "keep going".
   */
  private cuenta(l: Listado | null): string {
    if (!l || !l.entradas.length) return '';
    const carpetas = l.entradas.filter((e) => e.dir).length;
    const ficheros = l.entradas.length - carpetas;
    const trozos = [];
    if (carpetas) trozos.push(plural(carpetas, '{n} folder', '{n} folders'));
    if (ficheros) trozos.push(plural(ficheros, '{n} file', '{n} files'));
    return `<p class="expCuenta">${this.p.esc(trozos.join(' · '))}${
      ficheros ? ` — ${_('files are below the folders')}` : ''
    }</p>`;
  }

  /**
   * One listener on the root, not one per row.
   *
   * A folder with two thousand entries has four thousand buttons in it, and
   * binding a closure to each of them on every repaint is most of what a
   * repaint costs. Delegation also survives the repaint, so the handler is
   * attached exactly once for the life of the picker.
   */
  private enlaza(raiz: HTMLElement): void {
    if (raiz.dataset.expEnlazado === '1') return;
    raiz.dataset.expEnlazado = '1';
    raiz.addEventListener('click', (evento) => {
      const el = (evento.target as HTMLElement | null)?.closest<HTMLElement>('[data-exp]');
      if (!el || !raiz.contains(el)) return;
      evento.preventDefault();
      evento.stopPropagation();
      const ruta = el.dataset.ruta ?? '';
      if (!ruta) return;
      // A row's own tick is this picker's business — the Hall's mount dialog
      // has no other way to show it. What the host must NOT do is repaint
      // itself around us on every click; that is what rendered the listing
      // twice per tick, and it is fixed on the host's side.
      if (el.dataset.exp === 've') void this.ve(ruta);
      else {
        this.elige(ruta);
        this.repinta();
      }
    });
  }
}
