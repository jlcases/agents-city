/**
 * The harness declaration, in the runtimes' own language.
 *
 * `arnes.json` is the single source of truth for what this product adds to
 * somebody else's CLI. The connectors read their policy values from here rather
 * than spelling them inline, so `agents-city doctor --config` can print the
 * same table and be believed: there is one place to change, and both move.
 */
import declaracion from './arnes.json' with { type: 'json' };

export interface Trato {
  clave: string;
  valor: string;
  via: string;
  porque: string;
  /** Their own config key, when this one is a default they can outrank. */
  suyo?: string;
  /** The other value this key takes, when the choice is ours to compute. */
  alterno?: string;
}

interface Motor {
  binario: string;
  config: string[];
  trato: Trato[];
  hereda: Array<{ suyo: string; cuando: string }>;
  respeta: string[];
  avisa?: Array<{ cuando: string; dice: string }>;
}

const MOTORES = (declaracion as { motores: Record<string, Motor> }).motores;

/** The same value in the app-server's camelCase spelling: `workspace-write`
 * and `workspaceWrite` are one decision written twice, and only one of them
 * gets to be the source. */
export function camello(valor: string): string {
  return valor.replace(/-([a-z])/g, (_, letra: string) => letra.toUpperCase());
}

/** One declared value, by runtime and key. Throws rather than guess: a missing
 * entry means the declaration and the code have parted ways, which is the one
 * thing this file exists to prevent. */
export function trato(nombre: string, clave: string): Trato {
  const encontrado = MOTORES[nombre]?.trato.find((t) => t.clave === clave);
  if (!encontrado) throw new Error(`arnes.json declares no ${clave} for ${nombre}`);
  return encontrado;
}
