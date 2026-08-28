/**
 * The city gates: one per road, at the entrance, past the square.
 *
 * A road is an allowlist entry — reachability, not a channel — and this is its
 * honest drawing: not a highway to somewhere, but a gate with a name over it.
 * Everything beyond the gate is another city this map will never draw; the
 * other cities exist here exactly as much as they exist to the seat, as an
 * address you may send to. A letter for one of them flies out through its gate
 * and fades at the edge, because that is all this city ever sees of it.
 *
 * The gates come from the Hall's config message. The standalone team map never
 * receives one and draws no gates: a map must not invent connections.
 */
import { Container, Graphics, Text, TextStyle } from 'pixi.js';
import { TH, tono } from './draw';
import type { RoadInfo } from './activity';

const PIEDRA = 0xb9a67c;

export interface Ancla {
  x: number;
  y: number;
}

export class Puertas {
  /** The arches, in world coordinates, under the people layer. */
  readonly capa = new Container();
  /** The name plates, in the banner layer, zoom-stable like every label. */
  readonly carteles = new Container();

  private readonly sitios = new Map<string, Ancla>();

  constructor(
    private readonly origen: Ancla,
    private readonly anima: (f: (dt: number) => boolean) => void,
    private readonly alTocar?: (road: RoadInfo) => void,
  ) {}

  /** Draw the gates the Hall says exist. Called again when the roads change:
   * it redraws from scratch — there are never more than a handful. */
  configura(roads: RoadInfo[]): void {
    this.capa.removeChildren().forEach((child) => child.destroy({ children: true }));
    this.carteles.removeChildren().forEach((child) => child.destroy({ children: true }));
    this.sitios.clear();

    roads.forEach((road, i) => {
      // Gates line up along the near edge, to the right of the square, each a
      // step further out: the first road is the nearest gate.
      const pos = { x: this.origen.x + 340 + i * 150, y: this.origen.y - 40 - i * 26 };
      this.sitios.set(this.clave(road.address), pos);
      this.sitios.set(this.clave(road.name), pos);

      const g = new Container();
      g.position.set(pos.x, pos.y);
      // A gate is a question waiting to be clicked: where does this one go?
      g.eventMode = 'static';
      g.cursor = 'pointer';
      g.on('pointertap', () => this.alTocar?.(road));

      // The stub of road the gate stands on: it starts here and leaves the map.
      const camino = new Graphics()
        .poly([-46, 16, 96, -14, 96, 2, -46, 32])
        .fill({ color: 0x1b2532, alpha: 0.9 });
      camino.moveTo(-38, 22).lineTo(88, -4).stroke({ color: 0xc8b48a, width: 0.9, alpha: 0.3 });
      g.addChild(camino);

      // Two pillars flanking the road, a lintel across: the arch of the mock-up.
      for (const [px, py] of [
        [-12, 6],
        [16, 22],
      ] as const) {
        g.addChild(
          new Graphics()
            .ellipse(px, py + 3, 6, 2.6)
            .fill({ color: 0x000000, alpha: 0.3 })
            .poly([px, py, px - 5, py - 2.5, px - 5, py - 34, px, py - 31.5])
            .fill({ color: tono(PIEDRA, -0.28) })
            .poly([px, py, px + 5, py - 2.5, px + 5, py - 34, px, py - 31.5])
            .fill({ color: tono(PIEDRA, -0.5) })
            .poly([px, py - 36.5, px + 5, py - 34, px, py - 31.5, px - 5, py - 34])
            .fill({ color: tono(PIEDRA, 0.24) }),
        );
      }
      g.addChild(
        new Graphics()
          .moveTo(-12, -30)
          .lineTo(16, -14)
          .stroke({ color: tono(PIEDRA, 0.25), width: 3.5, alpha: 0.95 }),
      );
      this.capa.addChild(g);

      // The plate: the address is the point of the gate. `owner/city` is how the
      // roads file names the far end, and how the seat addresses it.
      const cartel = new Container();
      const nombre = new Text({
        text: road.name,
        style: new TextStyle({
          fontFamily: 'Chakra Petch, sans-serif',
          fontSize: 10,
          fontWeight: '700',
          letterSpacing: 0.8,
          fill: 0x131a24,
        }),
      });
      const dir = new Text({
        text: road.address,
        style: new TextStyle({
          fontFamily: 'IBM Plex Mono, monospace',
          fontSize: 8.5,
          fill: 0x8d99a8,
        }),
      });
      const ancho = Math.max(nombre.width, dir.width) + 14;
      cartel.addChild(
        new Graphics()
          .roundRect(-ancho / 2, -12, ancho, 18, 3)
          .fill({ color: PIEDRA, alpha: 0.94 }),
      );
      nombre.position.set(-nombre.width / 2, -10);
      dir.position.set(-dir.width / 2, 8);
      cartel.addChild(nombre, dir);
      cartel.position.set(pos.x + 2, pos.y - 52);
      this.carteles.addChild(cartel);
    });
  }

  hay(): boolean {
    return this.sitios.size > 0;
  }

  /** The gate a recipient leaves through — matched by address or name, and the
   * first gate when the address is external but unknown: a letter that must
   * leave the city leaves by A gate, not by teleport. */
  puerta(destino: string): Ancla | null {
    if (!this.sitios.size) return null;
    const clave = this.clave(destino);
    const exacta = this.sitios.get(clave);
    if (exacta) return exacta;
    for (const [k, v] of this.sitios) {
      if (clave.includes(k) || k.includes(clave)) return v;
    }
    return this.sitios.values().next().value ?? null;
  }

  /** A letter crossing the arch, outward or inward, fading at the map's edge. */
  vuela(puerta: Ancla, color: number, sale: boolean): void {
    const carta = new Graphics()
      .rect(-4, -3, 8, 6)
      .fill({ color: 0xf2ecdd })
      .rect(-4, -3, 8, 2)
      .fill({ color });
    const g = new Container();
    g.addChild(new Graphics().circle(0, 0, 5).fill({ color, alpha: 0.16 }), carta);
    this.capa.parent?.addChild(g);
    const dentro = { x: puerta.x - 4, y: puerta.y - 18 };
    const fuera = { x: puerta.x + 120, y: puerta.y - 44 };
    const p0 = sale ? dentro : fuera;
    const p1 = sale ? fuera : dentro;
    let t = 0;
    this.anima((dt) => {
      t += 0.03 * dt;
      const s = Math.min(1, t);
      g.x = p0.x + (p1.x - p0.x) * s;
      g.y = p0.y + (p1.y - p0.y) * s - Math.sin(s * Math.PI) * 10;
      // Outward it fades leaving; inward it arrives already faint and firms up.
      g.alpha = sale ? (s > 0.6 ? (1 - s) / 0.4 : 1) : s < 0.4 ? s / 0.4 : 1;
      carta.rotation = Math.sin(t * 6) * 0.25;
      if (t >= 1) {
        g.parent?.removeChild(g);
        g.destroy({ children: true });
        return false;
      }
      return true;
    });
  }

  private clave(valor: string): string {
    return valor.trim().toLowerCase();
  }
}
