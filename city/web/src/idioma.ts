/**
 * Two languages, one page.
 *
 * The READMEs shipped in Spanish and English from the start and the product did
 * not, which is the wrong way round: a person reads the documentation once and
 * lives in the interface every day. So the Hall speaks both.
 *
 * The dictionary is keyed by the ENGLISH sentence, not by an invented id. That
 * matters here: an untranslated string falls back to the source and the page
 * stays usable while coverage grows, instead of showing `hall.agents.title` to
 * somebody. It also means the code still reads as English prose, so a
 * contributor who speaks neither can follow it.
 */

type Diccionario = Record<string, string>;

const ES: Diccionario = {};

/**
 * The lookup key: the source sentence with its whitespace flattened.
 *
 * A paragraph in a template literal is indented to match the code around it,
 * and that indentation is invisible in HTML but fatal to an exact-match
 * dictionary — every translated paragraph would have to be re-indented in
 * lockstep with the file it came from. Flattening both sides means prose can be
 * written where it reads best and translated as one line.
 */
const CLAVES = new Map<string, string>();

function clave(fuente: string): string {
  const hecha = CLAVES.get(fuente);
  if (hecha !== undefined) return hecha;
  const nueva = _clave(fuente);
  // Bounded by the number of distinct source literals in the bundle, which is
  // a few hundred: this runs per string per render, and the strings are
  // constants.
  CLAVES.set(fuente, nueva);
  return nueva;
}

function _clave(fuente: string): string {
  // Typographic apostrophes too: prose is written with ’ in one file and ' in
  // another by whoever typed it, and a dictionary that can tell them apart
  // silently serves English for a sentence that WAS translated. That happened
  // to the whole mounts paragraph, in the middle of an otherwise Spanish page.
  return fuente
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/** Register translations. Split across files so each screen carries its own. */
export function anota(pares: Diccionario): void {
  for (const [fuente, texto] of Object.entries(pares)) ES[clave(fuente)] = texto;
}

type Lengua = 'es' | 'en';

let ELEGIDO: Lengua | '' = '';

/** The language showing right now: the stored choice, else this browser's. */
export function idioma(): 'es' | 'en' {
  if (ELEGIDO === 'es' || ELEGIDO === 'en') return ELEGIDO;
  try {
    const guardado = localStorage.getItem('hall-idioma');
    if (guardado === 'es' || guardado === 'en') {
      ELEGIDO = guardado;
      return ELEGIDO;
    }
  } catch {
    /* a browser with site data blocked still gets a working page */
  }
  const suyo = (navigator.language || 'en').toLowerCase();
  ELEGIDO = suyo.startsWith('es') ? 'es' : 'en';
  return ELEGIDO;
}

export function ponIdioma(cual: 'es' | 'en'): void {
  ELEGIDO = cual;
  try {
    localStorage.setItem('hall-idioma', cual);
  } catch {
    /* not being able to remember it is not a reason to refuse the switch */
  }
  document.documentElement.lang = cual;
}

/**
 * One string in the showing language.
 *
 * `t` takes the English source: `t('Your cities')`. Interpolation is by
 * `{name}` placeholders so a translator can move them — Spanish does not put
 * numbers and nouns where English does.
 */
export function t(fuente: string, valores?: Record<string, string | number>): string {
  const texto = idioma() === 'es' ? (ES[clave(fuente)] ?? fuente) : fuente;
  if (!valores) return texto;
  return texto.replace(/\{(\w+)\}/g, (_, clave) =>
    valores[clave] === undefined ? `{${clave}}` : String(valores[clave]),
  );
}

/** Plural without a library: two forms, which is all these two languages need. */
export function plural(n: number, una: string, varias: string): string {
  return t(n === 1 ? una : varias, { n: String(n) });
}
