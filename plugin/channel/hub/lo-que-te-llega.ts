/**
 * What a city says reaches its seat — read from that city's own role file.
 *
 * Knowing a `ux` is on the bus does not tell you whether what you changed
 * concerns them. The answer to that is written in their `roles/<role>.md`,
 * under "What reaches you" — and until now that file never left the city that
 * owned it. Each seat judged against its own copy of a catalogue, which is a
 * guess wearing a document's clothes.
 *
 * So it travels, with three rules it cannot break:
 *
 *  · The city that OWNS the role publishes it. Nobody describes somebody else.
 *  · It is bounded before it is published and again before it is read. Two
 *    processes, two chances to be wrong, and only one of them is ours.
 *  · It is a CLAIM, never an instruction. It ends up in another seat's model
 *    context, so it is neutralised the way road messages are.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { stripSpecialTokens } from '../untrusted.js';

/** Long enough for a sentence or two of remit, short enough that nobody can
 * paste a document into somebody else's context. */
export const LIMITE = 400;

/** The heading that names it, in the format the shipped role files use. */
const SECCION = /^##\s+What reaches you\s*$/i;

/**
 * The "What reaches you" section of a role file, as one bounded line.
 *
 * Returns '' for anything it cannot read confidently — a missing file, a role
 * with no such section, a section that is empty. Silence is the honest answer:
 * "this role did not say" is a fact a reader can act on, and an invented
 * summary is not.
 */
export function loQueLlega(dataDir: string, seatRole: string): string {
  if (!/^[a-z0-9-]{1,80}$/.test(seatRole)) return '';
  let texto: string;
  try {
    texto = readFileSync(join(dataDir, 'roles', `${seatRole}.md`), 'utf8');
  } catch {
    return '';
  }
  return limpia(seccion(texto));
}

/** The body under the heading, up to the next heading or the end. */
function seccion(texto: string): string {
  const lineas = texto.split('\n');
  const desde = lineas.findIndex((l) => SECCION.test(l));
  if (desde < 0) return '';
  const cuerpo: string[] = [];
  for (const linea of lineas.slice(desde + 1)) {
    if (/^##\s/.test(linea)) break;
    cuerpo.push(linea);
  }
  return cuerpo.join(' ');
}

/**
 * One line, bounded, with chat-template delimiters defanged and control
 * characters removed.
 *
 * The neutralising happens on the way OUT as well as on the way in. A city
 * publishes this about itself, so a city with a tampered role file would
 * otherwise be handing a forged turn to every neighbour that reads it — and
 * "the reader will sanitise it" is not a property this side gets to assume.
 */
export function limpia(bruto: string): string {
  const plano = stripSpecialTokens(String(bruto ?? ''))
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!plano) return '';
  return plano.length <= LIMITE ? plano : plano.slice(0, LIMITE - 1) + '…';
}
