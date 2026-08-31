/**
 * What the page shows when the town hall is not there.
 *
 * Before this, it showed nothing: a request failed, the browser reported
 * "Failed to fetch" into a console nobody has open, and the page sat there
 * looking healthy while every button did nothing. For somebody who does not
 * know that a web page can have a server behind it on their own machine, that
 * is not an error — it is the product having quietly stopped being real, with
 * no way back that does not involve a terminal.
 *
 * Three things it has to do, and they are Nielsen 1 and 9 almost word for word.
 * Say what state the system is in. Say it in the person's language, not the
 * network's. And offer the way out rather than describing it.
 *
 * The way out is the part that had to be earned elsewhere: the hall now keeps
 * the same address between runs, so "try again" can actually work. Without a
 * stable address this screen could only ever have been an apology.
 */

import { t as _ } from './idioma';

/** Why the page lost its server. The two are different problems and a person
 *  should not have to tell them apart. */
export type Motivo = 'cerrado' | 'caducado';

let montado: HTMLElement | null = null;
let reintento: number | null = null;

/** Is the hall answering again? One cheap request, no token needed to fail. */
async function responde(): Promise<boolean> {
  try {
    const r = await fetch('/api/estado' + location.search, { cache: 'no-store' });
    return r.ok;
  } catch {
    return false;
  }
}

function html(motivo: Motivo): string {
  const cerrado = motivo === 'cerrado';
  return `
    <div class="fueraCaja" role="alertdialog" aria-modal="true">
      <h1>${_(cerrado ? 'The town hall is closed' : 'This page is out of date')}</h1>
      <p class="prosa">${
        cerrado
          ? _(`It runs on this computer, not on the internet — so it stops when you stop it,
             and nothing was lost. Your city, your agents and everything you wrote are
             files on your disk, exactly as you left them.`)
          : _(`The hall is running, but this tab is holding an address it no longer accepts.
             Nothing is wrong with your city — this page is just old.`)
      }</p>
      <p class="prosa"><b>${_('To open it again, in a terminal:')}</b></p>
      <pre class="fueraOrden">agents-city hall</pre>
      <div class="fueraBotones">
        <button class="bt ppal" data-fuera="reintentar">${_('Try again')}</button>
        <span class="fueraEstado" data-fuera="estado">${_('Checking every few seconds…')}</span>
      </div>
    </div>`;
}

function reintenta(): void {
  void responde().then((ok) => {
    if (ok) location.reload();
  });
}

/**
 * Show it, once. Calling again while it is up does nothing: a page that lost
 * its server loses it for every request in flight, and stacking one screen per
 * failed request would bury the button under itself.
 */
export function muestra(motivo: Motivo): void {
  if (montado) return;
  const caja = document.createElement('div');
  caja.className = 'fueraFondo';
  caja.innerHTML = html(motivo);
  document.body.appendChild(caja);
  montado = caja;
  caja
    .querySelector<HTMLButtonElement>('[data-fuera="reintentar"]')
    ?.addEventListener('click', () => {
      const estado = caja.querySelector<HTMLElement>('[data-fuera="estado"]');
      if (estado) estado.textContent = _('Looking…');
      reintenta();
    });
  // And without being asked. Somebody who restarts the hall in another window
  // should find this page working when they come back to it, not a button they
  // have to notice.
  reintento = window.setInterval(reintenta, 4000);
  caja.querySelector<HTMLButtonElement>('[data-fuera="reintentar"]')?.focus();
}

/** For tests and for a page that recovers without a reload. */
export function esconde(): void {
  if (reintento !== null) window.clearInterval(reintento);
  reintento = null;
  montado?.remove();
  montado = null;
}

export function visible(): boolean {
  return montado !== null;
}
