/**
 * The people on site.
 *
 * The architect draws the plan, the foremen answer for a property, and the workers
 * dig. A worker is ONE window of ONE person: the seat window, one per repo, and
 * one per worktree — same repo, different branches, different workers.
 *
 * Careful what this counts: crew size says what is happening, not how well anyone
 * is doing. More workers is more work open at once, not more work finished — what
 * measures finishing is floors.
 */
import { Container, Graphics, Text, TextStyle } from 'pixi.js';
import { TH, tono } from './draw';

const CREMA = 0xe8e2d4;

/**
 * How big the people are drawn, against a 62×31 tile.
 *
 * They used to be drawn at 1: about thirteen pixels tall, which at the zoom
 * where the whole city fits is a speck. A map about who is working cannot have
 * the people be the least visible thing on it.
 */
export const ESCALA_GENTE = 1.6;

/** A stable colour per person: the same foreman is always the same colour. */
const PALETA = [0xf5c451, 0x6ee7b7, 0xf59ec4, 0x93c5fd, 0xfca868, 0xc4b5fd, 0x86efac, 0xfda4af];
export const colorDe = (u: string) => {
  let n = 0;
  const s = String(u ?? ''); // a missing name is a colour, not a crash
  for (let i = 0; i < s.length; i++) n = (n * 31 + s.charCodeAt(i)) | 0;
  return PALETA[Math.abs(n) % PALETA.length];
};

function casco(col: number, r = 3.1) {
  return new Graphics()
    .ellipse(0, 0, r, r * 0.78)
    .fill({ color: col })
    .rect(-r - 1, -0.2, (r + 1) * 2, 1.1)
    .fill({ color: tono(col, -0.25) });
}

/** A worker: digs, and every strike kicks up dust. */
export function obrero(usuario: string, agente: string, orden = 0) {
  const c = new Container();
  const col = colorDe(usuario);

  c.addChild(new Graphics().ellipse(0, 1, 5, 2).fill({ color: 0x000000, alpha: 0.3 }));
  c.addChild(
    new Graphics()
      .rect(-1.6, -11, 3.2, 11)
      .fill({ color: CREMA, alpha: 0.95 })
      .rect(-1.6, -5.5, 3.2, 1.4)
      .fill({ color: tono(col, -0.3), alpha: 0.9 }),
  ); // el chaleco
  const cab = casco(col);
  cab.position.set(0, -13);
  c.addChild(cab);

  const pico = new Graphics()
    .moveTo(0, -8)
    .lineTo(7, -13)
    .stroke({ color: 0xd9cdb4, width: 1.7 })
    .moveTo(6, -14.4)
    .lineTo(9, -12)
    .stroke({ color: 0x9aa7b8, width: 1.7 });
  pico.pivot.set(0, -8);
  c.addChild(pico);

  // Dust: three motes that rise and fade on each strike. It is what makes
  // "digging" read as digging rather than as a figure standing still.
  const polvo: Graphics[] = [];
  for (let i = 0; i < 3; i++) {
    const p = new Graphics().circle(0, 0, 1.1 + i * 0.4).fill({ color: 0xd9cdb4, alpha: 0.5 });
    p.visible = false;
    polvo.push(p);
    c.addChild(p);
  }

  let t = Math.random() * 6;
  c.onRender = () => {
    t += 0.14;
    pico.rotation = Math.sin(t) * 0.6;
    const golpe = Math.sin(t) > 0.94;
    polvo.forEach((p, i) => {
      if (golpe && !p.visible) {
        p.visible = true;
        p.position.set(7 + i * 2, -6);
        p.alpha = 0.55;
      }
      if (p.visible) {
        p.y -= 0.5;
        p.x += 0.16;
        p.alpha -= 0.035;
        if (p.alpha <= 0) {
          p.visible = false;
        }
      }
    });
  };

  // Several workers at the same house: the labels stack vertically, or they sit
  // on top of each other and none of them can be read.
  const cartel = etiqueta(usuario, `/${agente}`, col);
  cartel.position.set(0, -28 - orden * 15);
  c.addChild(cartel);
  (c as any).__cartel = cartel;
  (c as any).__agente = (cartel as any).__segunda;
  return acaba(c, usuario, cartel);
}

/**
 * Foreman: answers for a property and carries a crew. Drawn with a clipboard
 * instead of a pick — they do not dig — and with their current crew size.
 */
export function perito(usuario: string, oficio: string, cuantos?: number) {
  const c = new Container();
  const col = colorDe(usuario);

  c.addChild(new Graphics().ellipse(0, 1, 6, 2.4).fill({ color: 0x000000, alpha: 0.32 }));
  c.addChild(
    new Graphics()
      .rect(-2, -14, 4, 14)
      .fill({ color: CREMA })
      .rect(-2, -8, 4, 2)
      .fill({ color: tono(col, -0.2) }),
  );
  const cab = casco(col, 3.6);
  cab.position.set(0, -16.5);
  c.addChild(cab);
  // the clipboard
  c.addChild(
    new Graphics()
      .rect(2.4, -10, 5, 6.5)
      .fill({ color: 0xf2ecdd })
      .rect(2.4, -10, 5, 1.2)
      .fill({ color: tono(col, -0.3) }),
  );

  // No crew, no counter: a "×0" says nothing and adds noise.
  const cartel = etiqueta(usuario, oficio, col, cuantos && cuantos > 0 ? cuantos : undefined);
  cartel.position.set(0, -32);
  c.addChild(cartel);
  (c as any).__cartel = cartel;
  (c as any).__agente = (cartel as any).__segunda;
  return acaba(c, usuario, cartel);
}

/** The architect: does not dig and has no crew. Carries the plan. */
export function arquitecto(usuario: string) {
  const c = new Container();
  const col = colorDe(usuario);
  c.addChild(new Graphics().ellipse(0, 1, 7, 2.8).fill({ color: 0x000000, alpha: 0.34 }));
  c.addChild(new Graphics().rect(-2.2, -16, 4.4, 16).fill({ color: CREMA }));
  const cab = casco(0xffffff, 4);
  cab.position.set(0, -18.5);
  c.addChild(cab);
  // the plan under one arm
  c.addChild(
    new Graphics()
      .rect(-9, -11, 9, 2.6)
      .fill({ color: 0xf2ecdd })
      .rect(-9, -11, 2, 2.6)
      .fill({ color: col }),
  );
  const cartel = etiqueta(usuario, 'Architect', col);
  cartel.position.set(0, -34);
  c.addChild(cartel);
  (c as any).__cartel = cartel;
  (c as any).__agente = (cartel as any).__segunda;
  return acaba(c, usuario, cartel);
}

/**
 * What every figure gets before it leaves here: the size they are drawn at, a
 * generous hit area — a person is a dozen pixels wide and a mouse is not — and
 * the user they belong to, so a click can open their card.
 *
 * The label is scaled back down: at 1.6 the type would be bigger than the
 * banners, and the figure has to read as a person, not as a sign.
 */
function acaba(c: Container, usuario: string, cartel: Container) {
  c.scale.set(ESCALA_GENTE);
  cartel.scale.set(1 / ESCALA_GENTE);
  c.eventMode = 'static';
  c.cursor = 'pointer';
  (c as any).__usuario = usuario;
  return c;
}

/** A two-part label: who, and what they are. Plus a count if they have a crew. */
function etiqueta(principal: string, segunda: string, col: number, cuantos?: number) {
  const c = new Container();
  const a = new Text({
    text: principal,
    style: new TextStyle({
      fontFamily: 'IBM Plex Mono, monospace',
      fontSize: 9,
      fontWeight: '500',
      fill: 0x131a24,
    }),
  });
  const b = new Text({
    text: segunda,
    style: new TextStyle({
      fontFamily: 'IBM Plex Mono, monospace',
      fontSize: 9,
      fill: 0x131a24,
    }),
  });
  b.alpha = 0.7;
  const extra =
    cuantos !== undefined
      ? new Text({
          text: `×${cuantos}`,
          style: new TextStyle({
            fontFamily: 'Chakra Petch, sans-serif',
            fontSize: 10,
            fontWeight: '700',
            fill: 0x131a24,
          }),
        })
      : null;

  const ancho = a.width + b.width + 3 + (extra ? extra.width + 7 : 0);
  a.position.set(-ancho / 2, -6.5);
  b.position.set(-ancho / 2 + a.width + 3, -6.5);
  const fondo = new Graphics()
    .roundRect(-ancho / 2 - 5, -8.5, ancho + 10, 15, 2.5)
    .fill({ color: col, alpha: 0.94 });
  c.addChild(fondo, a, b);
  if (extra) {
    extra.position.set(ancho / 2 - extra.width, -7);
    c.addChild(
      new Graphics()
        .roundRect(ancho / 2 - extra.width - 4, -8.5, extra.width + 9, 15, 2.5)
        .fill({ color: tono(col, -0.4), alpha: 0.95 }),
    );
    extra.style.fill = 0xffffff;
    c.addChild(extra);
  }
  (c as any).__segunda = b;
  return c;
}
