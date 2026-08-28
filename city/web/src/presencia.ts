/**
 * Live presence: the lights say what is happening NOW.
 *
 * The windows a house is born with come from thirty days of history — a photo.
 * This layer is the pulse on top of it: a house whose agent is mid-turn glows
 * and breathes, one that just stopped cools down over a couple of minutes, and
 * one with no session shows nothing extra. All of it is derived from events the
 * feed already emits — a turn is `conversation.user` with no `conversation.agent`
 * after it — so the map never claims more than the hooks reported.
 *
 * Houses and worker figures are rebuilt constantly (the replay redraws houses,
 * the crew reconciles every state push), so nothing here holds a display object
 * as truth: each frame re-resolves where the glow and the dots should live and
 * re-parents them when the world changed underneath.
 */
import { Container, Graphics } from 'pixi.js';
import { TH, TW } from './draw';
import type { ActivityEvent } from './activity';

const VENTANA = 0xffd98a;

/** The one slice of the map's house record this layer needs. */
export interface CasaEnVivo {
  g: Container;
  h?: { alto: number };
}

type Fase = 'turno' | 'enfria';

interface Estado {
  fase: Fase;
  actores: Set<string>;
  halo: Graphics;
  puntos: Graphics[];
  puntosEn: Container | null;
  t: number; // the breath
  resto: number; // cooling time left, in ticker units
}

/** Cooling lasts about two minutes at 60fps: long enough that "it just stopped"
 * is visible, short enough that an evening of stopped agents reads as quiet. */
const ENFRIAMIENTO = 60 * 120;

export class Presencia {
  private readonly casas = new Map<string, Estado>();
  private readonly actorCasa = new Map<string, string>();

  constructor(
    private readonly vivaDe: (actor: string) => { id: string; casa: CasaEnVivo } | null,
    private readonly porId: (id: string) => CasaEnVivo | null,
    private readonly figuraDe: (actor: string) => Container | null,
    private readonly sinMovimiento: boolean,
  ) {}

  recibe(evento: ActivityEvent): void {
    const actor = evento.actor.trim();
    if (!actor || actor === 'system') return;
    if (evento.kind === 'conversation.user') this.empieza(actor);
    else if (evento.kind === 'conversation.agent') this.para(actor, false);
    else if (evento.kind === 'runtime.session.ended') this.para(actor, true);
  }

  /** How many houses are mid-turn right now — the HUD's number. */
  enTurno(): number {
    let n = 0;
    for (const e of this.casas.values()) if (e.fase === 'turno') n++;
    return n;
  }

  private empieza(actor: string): void {
    const viva = this.vivaDe(actor);
    if (!viva) return;
    this.actorCasa.set(actor, viva.id);
    let estado = this.casas.get(viva.id);
    if (!estado) {
      const halo = new Graphics();
      halo.blendMode = 'add';
      estado = {
        fase: 'turno',
        actores: new Set(),
        halo,
        puntos: [],
        puntosEn: null,
        t: 0,
        resto: 0,
      };
      this.casas.set(viva.id, estado);
    }
    estado.fase = 'turno';
    estado.actores.add(actor);
  }

  private para(actor: string, seco: boolean): void {
    const id = this.actorCasa.get(actor);
    if (!id) return;
    const estado = this.casas.get(id);
    if (!estado) return;
    estado.actores.delete(actor);
    if (estado.actores.size > 0) return; // somebody else is still mid-turn here
    if (seco) {
      // The session died: no afterglow for a light that was switched off.
      this.apaga(id, estado);
      return;
    }
    estado.fase = 'enfria';
    estado.resto = ENFRIAMIENTO;
  }

  /** One tick for the whole layer, from the map's single ticker. */
  tick(dt: number): void {
    for (const [id, estado] of this.casas) {
      const viva = this.porId(id);
      if (!viva) {
        this.apaga(id, estado);
        continue;
      }
      const alto = viva.h?.alto ?? 40;

      // The world redraws houses under us; the glow follows its house.
      if (estado.halo.parent !== viva.g) {
        estado.halo.parent?.removeChild(estado.halo);
        estado.halo
          .clear()
          .ellipse(0, TH / 2 - alto * 0.45, TW * 0.32, alto * 0.46)
          .fill({ color: VENTANA, alpha: 1 });
        viva.g.addChild(estado.halo);
      }

      if (estado.fase === 'turno') {
        estado.t += 0.042 * dt;
        estado.halo.alpha = this.sinMovimiento ? 0.24 : 0.16 + (Math.sin(estado.t) + 1) * 0.07;
      } else {
        estado.resto -= dt;
        if (estado.resto <= 0 || this.sinMovimiento) {
          this.apaga(id, estado);
          continue;
        }
        estado.halo.alpha = 0.18 * (estado.resto / ENFRIAMIENTO);
      }

      this.puntea(estado, viva, alto);
    }
  }

  /**
   * The thinking dots: three motes breathing over whoever is mid-turn. Over the
   * worker figure when the crew feed knows one, over the house's roof when it
   * does not — the signal must not depend on a second feed agreeing.
   */
  private puntea(estado: Estado, viva: CasaEnVivo, alto: number): void {
    const pensando = estado.fase === 'turno';
    if (!pensando) {
      this.quitaPuntos(estado);
      return;
    }
    const actor = [...estado.actores][0] ?? '';
    const figura = this.figuraDe(actor);
    const destino = figura ?? viva.g;
    if (estado.puntosEn !== destino) {
      this.quitaPuntos(estado);
      for (let i = 0; i < 3; i++) {
        const p = new Graphics().circle(0, 0, 1.4).fill({ color: 0xe8e2d4 });
        if (figura) p.position.set(-4 + i * 4, -19);
        else p.position.set(-5 + i * 5, TH / 2 - alto - 9);
        destino.addChild(p);
        estado.puntos.push(p);
      }
      estado.puntosEn = destino;
    }
    estado.puntos.forEach((p, i) => {
      p.alpha = this.sinMovimiento
        ? 0.8
        : 0.25 + Math.max(0, Math.sin(estado.t * 1.6 - i * 0.9)) * 0.75;
    });
  }

  private quitaPuntos(estado: Estado): void {
    for (const p of estado.puntos) {
      p.parent?.removeChild(p);
      p.destroy();
    }
    estado.puntos = [];
    estado.puntosEn = null;
  }

  private apaga(id: string, estado: Estado): void {
    estado.halo.parent?.removeChild(estado.halo);
    estado.halo.destroy();
    this.quitaPuntos(estado);
    this.casas.delete(id);
    for (const [actor, casa] of this.actorCasa) if (casa === id) this.actorCasa.delete(actor);
  }
}
