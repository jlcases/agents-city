/**
 * The town hall: where a committee is something you can watch.
 *
 * The committee is the most elaborate machine in the product — isolated
 * positions, a synthesis, a moderated floor, a verified decision — and until
 * now the map said nothing about it. This draws the machine as an event in the
 * city: positions fly in face down from each member's house, the synthesis
 * turns them over, the floor is a request you can see granted or denied, and
 * closing files the act. Everything here is driven by the same activity events
 * the Hall already relays; nothing is invented at render time.
 *
 * One session on stage at a time: a second `committee.opened` replaces the
 * scene. The transcript is the Hall's job — this is the town noticing that its
 * committee is sitting.
 */
import { Container, Graphics, Text, TextStyle } from 'pixi.js';
import { TH, TW, tono } from './draw';
import { colorDe } from './people';
import type { ActivityEvent } from './activity';

const PIEDRA = 0xb9a67c; // civic stone: warmer than any district, owned by none
const CREMA = 0xe8e2d4;
const AMBAR = 0xf5c451;
const VENTANA = 0xffd98a;
const BIEN = 0x3fb8a0;
const MAL = 0xe2604f;

export interface Ancla {
  x: number;
  y: number;
}

/** What each committee event does to the badge over the door. The kinds are
 * the engine's own — the same list `isSpeechEvent` filters on. */
const FASES: Record<string, { texto: string; color: number }> = {
  'committee.opened': { texto: 'IN SESSION · COLLECTING', color: AMBAR },
  'committee.position.submitted': { texto: 'IN SESSION · COLLECTING', color: AMBAR },
  'committee.position.revealed': { texto: 'REVIEW · POSITIONS OPEN', color: AMBAR },
  'committee.positions.revealed': { texto: 'REVIEW · POSITIONS OPEN', color: AMBAR },
  'committee.synthesis.published': { texto: 'SYNTHESIS', color: AMBAR },
  'committee.floor.requested': { texto: 'FLOOR REQUESTED', color: AMBAR },
  'committee.floor.granted': { texto: 'FLOOR GRANTED', color: BIEN },
  'committee.floor.denied': { texto: 'FLOOR DENIED', color: MAL },
  'committee.floor.spoke': { texto: 'FLOOR · SPOKEN', color: AMBAR },
  'committee.decision.recorded': { texto: 'DECIDED', color: AMBAR },
  'committee.verification.assigned': { texto: 'VERIFYING', color: AMBAR },
  // The activity feed says `.pass`/`.fail`; the internal deliveries say
  // `.passed`/`.failed`. The stage answers to both so a rename upstream can
  // never silently unhook the stamp.
  'committee.verification.pass': { texto: 'VERIFIED ✓', color: BIEN },
  'committee.verification.fail': { texto: 'VERIFICATION FAILED', color: MAL },
  'committee.verification.passed': { texto: 'VERIFIED ✓', color: BIEN },
  'committee.verification.failed': { texto: 'VERIFICATION FAILED', color: MAL },
  'committee.replanned': { texto: 'REPLANNING', color: AMBAR },
  'committee.closed': { texto: 'CLOSED · ACT FILED', color: CREMA },
  'committee.cancelled': { texto: 'CANCELLED', color: MAL },
};

export class Ayuntamiento {
  /** The building itself, in world coordinates, under the people layer. */
  readonly edificio = new Container();
  /** The badge, in the banner layer, so the zoom keeps it readable. */
  readonly cartel = new Container();

  private readonly luces: Graphics;
  private readonly halo: Graphics;
  private fase: Text;
  private quien: Text;
  private chapa: Graphics;
  private hilo: string | null = null;
  private naipes = new Map<string, Container>();
  private encendido = false;
  private manoChip: Container | null = null;
  private manoActor: string | null = null;

  constructor(
    private readonly capaVuelo: Container,
    private readonly pos: Ancla,
    private readonly casaDe: (actor: string) => Ancla | null,
    private readonly anima: (f: (dt: number) => boolean) => void,
    private readonly sinMovimiento: boolean,
  ) {
    const { edificio } = this;
    edificio.position.set(pos.x, pos.y);
    const w = TW * 0.82,
      d = TH * 0.82,
      alto = 72;

    // The paved forecourt: what makes the hall read as a landmark when nothing
    // is happening, instead of one more hut past the square.
    edificio.addChild(
      new Graphics()
        .poly([0, -d * 2.1, w * 2.1, 0, 0, d * 2.1, -w * 2.1, 0])
        .fill({ color: 0xc8b48a, alpha: 0.05 })
        .poly([0, -d * 2.1, w * 2.1, 0, 0, d * 2.1, -w * 2.1, 0])
        .stroke({ color: tono(PIEDRA, 0.1), width: 1, alpha: 0.35 }),
    );

    // The same three-tone prism as every house: the hall is of the city, not a
    // UI element floating over it.
    edificio.addChild(
      new Graphics().ellipse(0, d * 0.55, w * 1.4, d * 0.95).fill({ color: 0x000000, alpha: 0.32 }),
    );
    const cuerpo = new Graphics();
    cuerpo
      .poly([0, d, -w, 0, -w, -alto, 0, d - alto])
      .fill({ color: tono(PIEDRA, -0.28) })
      .poly([0, d, w, 0, w, -alto, 0, d - alto])
      .fill({ color: tono(PIEDRA, -0.52) })
      .poly([0, -d - alto, w, -alto, 0, d - alto, -w, -alto])
      .fill({ color: tono(PIEDRA, 0.24) });
    edificio.addChild(cuerpo);

    // Columns and a door on the left face — what says "civic" instead of
    // "one more house". The pediment is the top face's near edge, lifted.
    const cara = new Graphics();
    for (const u of [0.22, 0.78]) {
      const px = -w + u * w,
        py = u * d;
      cara.rect(px - 1.8, py - alto * 0.72, 3.6, alto * 0.66).fill({ color: tono(PIEDRA, 0.12) });
    }
    cara
      .rect(-w * 0.5 - 4, d * 0.5 - 19, 8, 19)
      .fill({ color: 0x0b1119, alpha: 0.85 })
      .poly([-w - 3, -alto, 0, d - alto, 0, d - alto - 12, -w - 3, -alto - 12])
      .stroke({ color: tono(PIEDRA, 0.3), width: 1.1, alpha: 0.6 });
    edificio.addChild(cara);

    // Two door lamps, always lit — the same faint civic warmth the street lamps
    // give the districts, so the hall is never a black box even between sessions.
    for (const [px, py] of [
      [-w * 0.78, d * 0.72],
      [-w * 0.16, d * 1.04],
    ] as const) {
      const luz = new Graphics().ellipse(px, py, 11, 5).fill({ color: VENTANA, alpha: 0.09 });
      luz.blendMode = 'add';
      const poste = new Graphics()
        .moveTo(px, py)
        .lineTo(px, py - 14)
        .stroke({ color: 0x8d99a8, width: 0.9, alpha: 0.75 })
        .circle(px, py - 15, 1.6)
        .fill({ color: VENTANA, alpha: 0.95 });
      edificio.addChild(luz, poste);
    }

    // The flag: up while the committee sits, at rest otherwise.
    const asta = new Graphics()
      .moveTo(0, -d - alto)
      .lineTo(0, -d - alto - 16)
      .stroke({ color: 0x8d99a8, width: 1.1, alpha: 0.8 });
    const bandera = new Graphics()
      .poly([0, -d - alto - 16, 11, -d - alto - 12.5, 0, -d - alto - 9])
      .fill({ color: AMBAR });
    edificio.addChild(asta, bandera);

    // Two window rows per lit face, off until a session opens: the committee
    // sitting is exactly the kind of thing lit windows exist to say.
    this.luces = new Graphics();
    for (const fila of [0.32, 0.56]) {
      for (const u of [0.36, 0.6]) {
        const px = -w + u * w,
          py = u * d - alto * fila;
        this.luces.rect(px - 1.6, py - 3.4, 3.2, 4.6).fill({ color: VENTANA, alpha: 0.95 });
      }
      for (const u of [0.3, 0.62]) {
        const px = u * w,
          py = d - u * d - alto * fila;
        this.luces.rect(px - 1.6, py - 3.4, 3.2, 4.6).fill({ color: VENTANA, alpha: 0.75 });
      }
    }
    this.halo = new Graphics()
      .ellipse(0, -alto * 0.45, w * 0.9, alto * 0.6)
      .fill({ color: VENTANA, alpha: 0.12 });
    this.halo.blendMode = 'add';
    this.luces.visible = false;
    this.halo.visible = false;
    edificio.addChild(this.halo, this.luces);

    // The badge: phase in the display face, actor in the data face. It lives in
    // the banner layer so it keeps its size on screen at every zoom.
    this.fase = new Text({
      text: 'TOWN HALL',
      style: new TextStyle({
        fontFamily: 'Chakra Petch, sans-serif',
        fontSize: 11,
        fontWeight: '700',
        letterSpacing: 1.2,
        fill: 0x131a24,
      }),
    });
    this.quien = new Text({
      text: '',
      style: new TextStyle({ fontFamily: 'IBM Plex Mono, monospace', fontSize: 9, fill: 0x8d99a8 }),
    });
    this.chapa = new Graphics();
    this.cartel.addChild(this.chapa, this.fase, this.quien);
    this.cartel.position.set(pos.x, pos.y - d - alto - 34);
    this.rotula('TOWN HALL', CREMA, '');
  }

  /** What the building would say if you asked it — which is what clicking it
   * does. The full transcript stays the Hall's job. */
  estado(): { fase: string; actor: string; posiciones: number; activo: boolean } {
    return {
      fase: this.fase.text,
      actor: this.quien.text,
      posiciones: this.naipes.size,
      activo: this.encendido,
    };
  }

  /** Feed every activity event through here; anything non-committee is ignored. */
  recibe(evento: ActivityEvent): void {
    if (!evento.kind.startsWith('committee.')) return;
    const fase = FASES[evento.kind];
    if (!fase) return;

    if (evento.kind === 'committee.opened') {
      this.limpia();
      this.hilo = evento.thread;
      this.enciende(true);
    } else if (this.hilo !== null && evento.thread !== null && evento.thread !== this.hilo) {
      // Another thread's event while a session is on stage: the stage is not a
      // multiplexer. The Hall's rail carries every thread; here one sits.
      return;
    }

    this.rotula(fase.texto, fase.color, evento.actor !== 'system' ? evento.actor : '');

    switch (evento.kind) {
      case 'committee.position.submitted':
        // Sealed: the card arrives face down. That the chair cannot see it yet
        // is the committee's one hard rule, so the map shows the rule.
        this.llegaNaipe(evento.actor, false);
        break;
      case 'committee.position.revealed':
        this.llegaNaipe(evento.actor, true);
        this.voltea(evento.actor);
        break;
      case 'committee.positions.revealed':
      case 'committee.synthesis.published':
        this.voltea();
        break;
      case 'committee.floor.requested':
        this.mano(evento.actor, 'palabra?', AMBAR, false);
        break;
      // Granting is the chair's act, so the actor is the seat: the chip stays
      // where the hand went up, found through the target or remembered.
      case 'committee.floor.granted':
        this.mano(evento.target ?? this.manoActor ?? evento.actor, 'concedida', BIEN, true);
        break;
      case 'committee.floor.denied':
        this.mano(evento.target ?? this.manoActor ?? evento.actor, 'denegada', MAL, true);
        break;
      case 'committee.verification.pass':
      case 'committee.verification.passed':
        this.sello(true);
        break;
      case 'committee.verification.fail':
      case 'committee.verification.failed':
        this.sello(false);
        break;
      case 'committee.closed':
        this.archiva(true);
        break;
      case 'committee.cancelled':
        this.archiva(false);
        break;
    }
  }

  /** Badge text and plate, sized to the text — the same shape as a banner. */
  private rotula(texto: string, color: number, actor: string): void {
    this.fase.text = texto;
    this.quien.text = actor;
    const ancho = Math.max(this.fase.width, this.quien.width) + 16;
    this.fase.position.set(-this.fase.width / 2, -9);
    this.quien.position.set(-this.quien.width / 2, 7);
    this.chapa
      .clear()
      .roundRect(-ancho / 2, -13, ancho, actor ? 32 : 22, 3)
      .fill({ color, alpha: 0.92 })
      .roundRect(-ancho / 2, -13, ancho, actor ? 32 : 22, 3)
      .stroke({ color: 0x131a24, width: 1, alpha: 0.25 });
    this.quien.style.fill = 0x131a24;
    this.quien.alpha = 0.75;
    this.quien.visible = Boolean(actor);
  }

  private enciende(si: boolean): void {
    const ya = this.encendido;
    this.encendido = si;
    this.luces.visible = si;
    this.halo.visible = si;
    if (!si || ya) return; // off, or the breath is already running
    let t = 0;
    this.anima((dt) => {
      if (!this.encendido) {
        this.halo.alpha = 1;
        return false;
      }
      t += 0.045 * dt;
      this.halo.alpha = 0.7 + Math.sin(t) * 0.3; // the slow breath of a lit room
      return true;
    });
  }

  /**
   * A member's position arrives as a card, face down, flying from their house.
   * Face down is the point: isolated positions are the committee's one hard
   * rule, and the map should show the rule, not just the traffic.
   */
  private llegaNaipe(actor: string, bocarriba: boolean): void {
    if (this.naipes.has(actor)) return;
    const color = colorDe(actor);
    const naipe = new Container();
    const dorso = new Graphics()
      .roundRect(-6, -8.5, 12, 17, 2)
      .fill({ color: 0x1b2431 })
      .roundRect(-6, -8.5, 12, 17, 2)
      .stroke({ color: 0x39465a, width: 1 })
      .moveTo(-3, -4.5)
      .lineTo(3, 4.5)
      .moveTo(3, -4.5)
      .lineTo(-3, 4.5)
      .stroke({ color: 0x39465a, width: 1 });
    const cara = new Graphics()
      .roundRect(-6, -8.5, 12, 17, 2)
      .fill({ color })
      .roundRect(-6, -8.5, 12, 17, 2)
      .stroke({ color: tono(color, 0.3), width: 1 });
    for (let i = 0; i < 3; i++) {
      cara
        .moveTo(-3.4, -4 + i * 4)
        .lineTo(3.4, -4 + i * 4)
        .stroke({ color: 0x121821, width: 1, alpha: 0.55 });
    }
    // A card the map only met after its reveal arrives already open: showing it
    // sealed would claim a secrecy that no longer exists.
    cara.visible = bocarriba;
    dorso.visible = !bocarriba;
    naipe.addChild(dorso, cara);
    (naipe as unknown as { __cara: Graphics; __dorso: Graphics }).__cara = cara;
    (naipe as unknown as { __cara: Graphics; __dorso: Graphics }).__dorso = dorso;

    const sitio = this.naipes.size;
    this.naipes.set(actor, naipe);
    // Parked in a fan to the hall's right, clear of the badge above the roof —
    // the badge scales with the zoom and would cover a row parked under it.
    const destino = { x: this.pos.x + 46 + sitio * 20, y: this.pos.y - TH - 36 };
    const de = this.casaDe(actor) ?? { x: this.pos.x - 120, y: this.pos.y + 40 };
    naipe.position.set(de.x, de.y - 30);
    this.capaVuelo.addChild(naipe);

    let t = 0;
    const p0 = { x: naipe.x, y: naipe.y };
    this.anima((dt) => {
      if (!naipe.parent) return false;
      t = Math.min(1, t + 0.02 * dt);
      const s = t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t);
      naipe.x = p0.x + (destino.x - p0.x) * s;
      naipe.y = p0.y + (destino.y - p0.y) * s - Math.sin(s * Math.PI) * 52;
      naipe.rotation = Math.sin(t * 9) * 0.18;
      if (t >= 1) {
        naipe.position.set(destino.x, destino.y);
        naipe.rotation = 0;
        this.mece(naipe, sitio);
        return false;
      }
      return true;
    });
  }

  /** Parked cards breathe a little; a frozen prop reads as a glitch. */
  private mece(naipe: Container, sitio: number): void {
    if (this.sinMovimiento) return;
    const base = naipe.y;
    let t = sitio * 1.3;
    this.anima((dt) => {
      if (!naipe.parent) return false;
      t += 0.03 * dt;
      naipe.y = base + Math.sin(t) * 2.2;
      return true;
    });
  }

  /** The reveal: a sealed position turns over — one actor's card, or the whole
   * table at once. Nobody saw anybody's hand until the chair had all of them,
   * and the flip is that rule, animated. */
  private voltea(solo?: string): void {
    for (const [actor, naipe] of this.naipes) {
      if (solo !== undefined && actor !== solo) continue;
      const partes = naipe as unknown as { __cara?: Graphics; __dorso?: Graphics };
      if (!partes.__cara || partes.__cara.visible) continue;
      const cara = partes.__cara,
        dorso = partes.__dorso!;
      let t = 0;
      this.anima((dt) => {
        if (!naipe.parent) return false;
        t = Math.min(1, t + 0.06 * dt);
        naipe.scale.x = Math.abs(Math.cos(t * Math.PI));
        if (t >= 0.5 && !cara.visible) {
          cara.visible = true;
          dorso.visible = false;
        }
        if (t >= 1) {
          naipe.scale.x = 1;
          return false;
        }
        return true;
      });
    }
  }

  /**
   * The raised hand: a floor request is the one moment a member interrupts the
   * chair's order, and it happens at THEIR house — the chip hangs over whoever
   * asked, then answers in colour when the chair rules on it.
   */
  private mano(quien: string, texto: string, color: number, resuelve: boolean): void {
    if (!resuelve) {
      this.manoChip?.parent?.removeChild(this.manoChip);
      this.manoChip?.destroy({ children: true });
      this.manoChip = null;
      this.manoActor = quien;
    }
    let chip = this.manoChip;
    if (!chip) {
      const donde = this.casaDe(quien) ?? { x: this.pos.x - 90, y: this.pos.y + 30 };
      chip = new Container();
      chip.position.set(donde.x, donde.y - 64);
      this.capaVuelo.addChild(chip);
      this.manoChip = chip;
    }
    chip.removeChildren().forEach((child) => child.destroy({ children: true }));
    const rotulo = new Text({
      text: `✋ ${texto}`,
      style: new TextStyle({
        fontFamily: 'IBM Plex Mono, monospace',
        fontSize: 10,
        fontWeight: '500',
        fill: 0x131a24,
      }),
    });
    const ancho = rotulo.width + 12;
    chip.addChild(
      new Graphics()
        .roundRect(-ancho / 2, -9, ancho, 18, 9)
        .fill({ color, alpha: 0.94 })
        .roundRect(-ancho / 2, -9, ancho, 18, 9)
        .stroke({ color: 0x131a24, width: 1, alpha: 0.25 }),
    );
    rotulo.position.set(-rotulo.width / 2, -6.5);
    chip.addChild(rotulo);

    if (!resuelve) {
      // Pop in, then hold: an open request stays visible until it is ruled on.
      let t = 0;
      const mio = chip;
      this.anima((dt) => {
        if (!mio.parent || this.manoChip !== mio) return false;
        t += 0.05 * dt;
        mio.scale.set(Math.min(1, 0.5 + t));
        if (this.sinMovimiento) return false;
        mio.y += Math.sin(t * 1.4) * 0.06 * dt;
        return true;
      });
      return;
    }
    // Ruled on: show the answer, then let it go.
    this.manoActor = null;
    const mio = chip;
    let t = 0;
    this.anima((dt) => {
      if (!mio.parent) return false;
      t += 0.008 * dt;
      if (t > 0.55) {
        mio.alpha = Math.max(0, (1 - t) / 0.45);
        mio.y -= 0.25 * dt;
      }
      if (t >= 1) {
        mio.parent?.removeChild(mio);
        mio.destroy({ children: true });
        if (this.manoChip === mio) this.manoChip = null;
        return false;
      }
      return true;
    });
  }

  /** The verifier's stamp: one clean mark over the door, then gone. */
  private sello(paso: boolean): void {
    const g = new Graphics();
    if (paso) {
      g.moveTo(-7, 0).lineTo(-2, 5).lineTo(8, -6).stroke({ color: BIEN, width: 3 });
    } else {
      g.moveTo(-6, -6).lineTo(6, 6).moveTo(6, -6).lineTo(-6, 6).stroke({ color: MAL, width: 3 });
    }
    g.position.set(this.pos.x, this.pos.y - 102);
    this.capaVuelo.addChild(g);
    let t = 0;
    this.anima((dt) => {
      t += 0.014 * dt;
      g.alpha = t > 0.7 ? Math.max(0, (1 - t) / 0.3) : 1;
      g.scale.set(t < 0.15 ? 0.6 + t * 3 : 1.05);
      if (t >= 1) {
        g.parent?.removeChild(g);
        g.destroy();
        return false;
      }
      return true;
    });
  }

  /** Closing files the act: a document rises from the hall, signed, and the
   * cards leave with it. The durable record is on disk; this is the ceremony. */
  private archiva(conActa: boolean): void {
    this.enciende(false);
    let acta: Container | null = null;
    if (conActa) {
      acta = new Container();
      const papel = new Graphics()
        .roundRect(-7, -9, 14, 18, 1.5)
        .fill({ color: 0xf2ecdd })
        .roundRect(-7, -9, 14, 18, 1.5)
        .stroke({ color: 0x131a24, width: 1, alpha: 0.6 });
      for (let i = 0; i < 4; i++) {
        papel
          .moveTo(-4, -5 + i * 3.6)
          .lineTo(4, -5 + i * 3.6)
          .stroke({ color: 0x131a24, width: 1, alpha: 0.4 });
      }
      papel.moveTo(-3, 6).lineTo(3, 6).stroke({ color: AMBAR, width: 1.6 });
      acta.addChild(papel);
      acta.position.set(this.pos.x, this.pos.y - 70);
      this.capaVuelo.addChild(acta);
    }

    const naipes = [...this.naipes.values()];
    if (this.manoChip) naipes.push(this.manoChip);
    this.manoChip = null;
    this.manoActor = null;
    this.naipes.clear();
    this.hilo = null;
    let t = 0;
    this.anima((dt) => {
      t = Math.min(1, t + 0.012 * dt);
      if (acta) {
        acta.y -= 0.5 * dt;
        acta.rotation = Math.sin(t * 7) * 0.12;
        acta.alpha = t > 0.6 ? (1 - t) / 0.4 : 1;
      }
      for (const naipe of naipes) naipe.alpha = 1 - t;
      if (t >= 1) {
        if (acta) {
          acta.parent?.removeChild(acta);
          acta.destroy({ children: true });
        }
        for (const naipe of naipes) {
          naipe.parent?.removeChild(naipe);
          naipe.destroy({ children: true });
        }
        return false;
      }
      return true;
    });
  }

  private limpia(): void {
    for (const naipe of this.naipes.values()) {
      naipe.parent?.removeChild(naipe);
      naipe.destroy({ children: true });
    }
    this.naipes.clear();
    this.manoChip?.parent?.removeChild(this.manoChip);
    this.manoChip?.destroy({ children: true });
    this.manoChip = null;
    this.manoActor = null;
  }
}
