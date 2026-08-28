/**
 * What runs an agent: the provider, the engine and how hard it thinks.
 *
 * One list, imported by both the character sheet and the first-run guide. They
 * used to be the sheet's private constants, which meant the guide could not ask
 * the question at all — somebody built five houses and then went hunting for
 * three dropdowns to set what they had already decided in their head. A curated
 * list is never allowed to hold a card hostage, so `opciones` always keeps a
 * value that is already written even when it is not one of these.
 */

export const RUNTIMES = ['claude', 'codex', 'opencode', 'kimi'];

/**
 * What each provider actually takes.
 *
 * Both fields used to be greyed out for anything but Claude, with a tooltip
 * saying the other CLIs carry their own flags. That was half true and wholly
 * unhelpful: the native gateways parse `--model` — and Codex `--effort` — out of
 * the command string and send them with the turn, so the card can say it once
 * for any of the four and the launcher renders it for whoever is running.
 *
 * `efuerzo: false` is the honest half. OpenCode and Kimi have no such setting,
 * and offering a control nothing reads is worse than not offering it.
 *
 * `modelos` is only listed where the names are known well enough to put in a
 * menu. Elsewhere the field is free text, because inventing model names that a
 * provider does not have is the fastest way to make a product look fake.
 */
export interface Motor {
  modelos: string[];
  esfuerzo: boolean;
  pista: string;
}

export const MOTOR: Record<string, Motor> = {
  claude: {
    modelos: ['haiku', 'sonnet', 'opus', 'fable'],
    esfuerzo: true,
    pista: 'An alias the Claude CLI resolves when the window opens.',
  },
  codex: {
    modelos: [],
    esfuerzo: true,
    pista: 'The model name your Codex uses — the one in ~/.codex/config.toml.',
  },
  opencode: {
    modelos: [],
    esfuerzo: false,
    pista: 'OpenCode names a model provider/model, like anthropic/claude-sonnet-4.',
  },
  kimi: { modelos: [], esfuerzo: false, pista: 'The model name your Kimi CLI uses.' },
};

/** The provider a value means when nothing is chosen: Claude runs the city. */
export function motorDe(runtime: string): Motor {
  return MOTOR[runtime || 'claude'] ?? MOTOR.claude;
}

export const MODELOS = MOTOR.claude.modelos;
export const NIVEL_ESFUERZO: Record<string, number> = {
  low: 1,
  medium: 2,
  high: 3,
  xhigh: 4,
  max: 5,
};
export const ESFUERZOS = Object.keys(NIVEL_ESFUERZO);

/** `<option>`s from known values plus the current one when it is off the list. */
export function opciones(
  valores: string[],
  actual: string,
  esc: (s: unknown) => string,
  porDefecto = 'default',
): string {
  return valores
    .concat(actual && !valores.includes(actual) ? [actual] : [])
    .map(
      (v) =>
        `<option value="${esc(v)}"${v === actual ? ' selected' : ''}>${esc(v || porDefecto)}</option>`,
    )
    .join('');
}

/** The engine's honest power reading. An alias maps to its tier; empty means
 * the owner's default — unknown here, so it reads "default" rather than
 * inventing a number. */
export function nivelDeMotor(model: string): { ancho: number; texto: string; defecto: boolean } {
  const alias = model.toLowerCase();
  if (!alias) return { ancho: 0.5, texto: 'default', defecto: true };
  for (const [clave, ancho] of [
    ['fable', 1],
    ['opus', 0.8],
    ['sonnet', 0.55],
    ['haiku', 0.35],
  ] as const) {
    if (alias.includes(clave)) return { ancho, texto: alias, defecto: false };
  }
  return { ancho: 0.6, texto: alias, defecto: false };
}
