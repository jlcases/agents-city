/**
 * The app's own way of asking a question.
 *
 * Everything here used to be `window.prompt` and `window.confirm`. Those are
 * fine for a debug build and wrong for a product: they are unstyled, they cannot
 * hold two fields, they cannot explain what a destructive answer costs, they
 * ignore the page's language and theme entirely, and on some browsers a page can
 * be told to suppress them — at which point a button silently does nothing. A
 * product that has designed its own onboarding and then asks for a city name
 * through a grey system box is telling on itself.
 *
 * One dialog, promise-shaped: it resolves with the answers, or with `null` when
 * the person backs out. Escape and the backdrop cancel; Enter accepts from any
 * single-line field. Focus moves in on open and back out on close.
 */

export interface Campo {
  /** Key this field's value appears under in the answer. */
  id: string;
  etiqueta: string;
  valor?: string;
  pista?: string;
  /** A `<select>` instead of an input, when the answer is one of a few things. */
  opciones?: Array<{ valor: string; texto: string }>;
  requerido?: boolean;
}

export interface Peticion {
  titulo: string;
  /** Plain sentences under the title. Rendered as text, never as markup. */
  cuerpo?: string[];
  campos?: Campo[];
  aceptar?: string;
  cancelar?: string;
  /** Red confirm button, for anything that loses work. */
  peligro?: boolean;
  /** Only enable the confirm button once this exact string is typed in the
   * first field: the guard a destructive action deserves. */
  exige?: string;
  /** Extra markup owned by the caller — the house form goes here. */
  contenido?: string;
  /** Wire that markup once it is in the DOM. `cierra` accepts on its behalf. */
  enlaza?: (raiz: HTMLElement, cierra: (respuesta: Record<string, string> | null) => void) => void;
  ancho?: number;
}

function esc(s: unknown): string {
  return String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  );
}

let abierto: HTMLElement | null = null;

/** Ask. Resolves with the answers keyed by field id, or null if cancelled. */
export function pregunta(p: Peticion): Promise<Record<string, string> | null> {
  // One at a time. A second dialog over the first would leave the first's
  // promise hanging for the life of the page.
  abierto?.remove();

  const campos = p.campos ?? [];
  const fondo = document.createElement('div');
  fondo.className = 'dlgFondo';
  fondo.innerHTML = `
    <div class="dlg" role="dialog" aria-modal="true" aria-label="${esc(p.titulo)}"
      style="${p.ancho ? `max-width:${p.ancho}px` : ''}">
      <h2>${esc(p.titulo)}</h2>
      ${(p.cuerpo ?? []).map((l) => `<p class="dlgProsa">${esc(l)}</p>`).join('')}
      ${campos
        .map(
          (c) => `<div class="campo"><label for="dlg-${esc(c.id)}">${esc(c.etiqueta)}</label>
        ${
          c.opciones
            ? `<select id="dlg-${esc(c.id)}" data-campo="${esc(c.id)}">${c.opciones
                .map(
                  (o) =>
                    `<option value="${esc(o.valor)}"${
                      o.valor === (c.valor ?? '') ? ' selected' : ''
                    }>${esc(o.texto)}</option>`,
                )
                .join('')}</select>`
            : `<input id="dlg-${esc(c.id)}" data-campo="${esc(c.id)}" type="text"
                value="${esc(c.valor ?? '')}" placeholder="${esc(c.pista ?? '')}"
                autocomplete="off" spellcheck="false">`
        }</div>`,
        )
        .join('')}
      ${p.contenido ?? ''}
      <div class="dlgBotones">
        <button type="button" class="bt" data-dlg="no">${esc(p.cancelar ?? 'Cancel')}</button>
        <button type="button" class="bt ${p.peligro ? 'malo' : 'ppal'}" data-dlg="si">${esc(
          p.aceptar ?? 'OK',
        )}</button>
      </div>
    </div>`;
  document.body.appendChild(fondo);
  abierto = fondo;

  const devolvia = document.activeElement as HTMLElement | null;
  const caja = fondo.querySelector<HTMLElement>('.dlg') as HTMLElement;
  const si = fondo.querySelector<HTMLButtonElement>('[data-dlg="si"]') as HTMLButtonElement;

  return new Promise((resuelve) => {
    let cerrado = false;
    const cierra = (respuesta: Record<string, string> | null): void => {
      if (cerrado) return;
      cerrado = true;
      document.removeEventListener('keydown', tecla, true);
      fondo.remove();
      if (abierto === fondo) abierto = null;
      devolvia?.focus?.();
      resuelve(respuesta);
    };
    const lee = (): Record<string, string> => {
      const fuera: Record<string, string> = {};
      fondo.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-campo]').forEach((el) => {
        fuera[el.dataset.campo ?? ''] = el.value;
      });
      return fuera;
    };
    const acepta = (): void => {
      const valores = lee();
      if (campos.some((c) => c.requerido && !valores[c.id]?.trim())) return;
      cierra(valores);
    };
    const revisa = (): void => {
      const valores = lee();
      const falta = campos.some((c) => c.requerido && !valores[c.id]?.trim());
      const mal = p.exige !== undefined && (valores[campos[0]?.id ?? ''] ?? '').trim() !== p.exige;
      si.disabled = falta || mal;
    };

    si.onclick = acepta;
    (fondo.querySelector('[data-dlg="no"]') as HTMLButtonElement).onclick = () => cierra(null);
    fondo.onclick = (e) => {
      if (e.target === fondo) cierra(null);
    };
    caja.addEventListener('input', revisa);
    caja.addEventListener('change', revisa);
    fondo.querySelectorAll<HTMLInputElement>('input').forEach((el) => {
      el.onkeydown = (e) => {
        if (e.key === 'Enter' && !si.disabled) {
          e.preventDefault();
          acepta();
        }
      };
    });
    const tecla = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        cierra(null);
      }
    };
    document.addEventListener('keydown', tecla, true);

    p.enlaza?.(caja, cierra);
    revisa();
    (
      caja.querySelector<HTMLElement>('input,select,textarea') ?? (si.disabled ? caja : si)
    ).focus?.();
  });
}

/** Yes or no, with no fields. Resolves true only on an explicit yes. */
export async function confirma(
  titulo: string,
  cuerpo: string[] = [],
  opciones: { aceptar?: string; peligro?: boolean } = {},
): Promise<boolean> {
  const r = await pregunta({
    titulo,
    cuerpo,
    aceptar: opciones.aceptar ?? 'Yes',
    peligro: opciones.peligro,
  });
  return r !== null;
}
