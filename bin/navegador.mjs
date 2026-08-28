#!/usr/bin/env node
/* Drive a real Chrome against a running Hall, over the DevTools protocol.
 *
 * Why this exists: every other suite in this repo can pass while the page is
 * dead. Instruction editors and a zip upload once shipped rendered, typechecked
 * and fully tested on the server side — and wired to nothing. `tsc` cannot see
 * an event handler that was never attached, and neither can a DOM-free test.
 * Only a browser that clicks can.
 *
 * No dependency: Node 22 has a global WebSocket, and CDP is JSON over one. A
 * headless browser is heavy enough without a driver library on top.
 *
 *   node bin/navegador.mjs <url>
 *
 * Prints one line per check and exits non-zero if any failed.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CANDIDATOS = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/snap/bin/chromium',
].filter(Boolean);

function dondeEstaChrome() {
  return CANDIDATOS.find((p) => existsSync(p)) || '';
}

/** Chrome prints its DevTools endpoint on stderr; that is the handshake. */
function esperaEndpoint(proceso, limite = 20000) {
  return new Promise((listo, falla) => {
    let visto = '';
    const reloj = setTimeout(() => falla(new Error('chrome never announced its port')), limite);
    proceso.stderr.on('data', (trozo) => {
      visto += trozo.toString();
      const m = visto.match(/ws:\/\/[^\s]+/);
      if (m) {
        clearTimeout(reloj);
        listo(m[0]);
      }
    });
    proceso.on('exit', (codigo) => {
      clearTimeout(reloj);
      falla(new Error(`chrome exited with ${codigo}: ${visto.slice(-400)}`));
    });
  });
}

class Cdp {
  constructor(socket) {
    this.socket = socket;
    this.n = 0;
    this.pendientes = new Map();
    socket.addEventListener('message', (evento) => {
      const mensaje = JSON.parse(evento.data);
      const espera = this.pendientes.get(mensaje.id);
      if (!espera) return;
      this.pendientes.delete(mensaje.id);
      mensaje.error ? espera.falla(new Error(JSON.stringify(mensaje.error))) : espera.listo(mensaje.result);
    });
  }

  static async abre(url) {
    const socket = new WebSocket(url);
    await new Promise((listo, falla) => {
      socket.addEventListener('open', listo, { once: true });
      socket.addEventListener('error', () => falla(new Error('cannot reach chrome')), { once: true });
    });
    return new Cdp(socket);
  }

  manda(metodo, params = {}) {
    const id = ++this.n;
    this.socket.send(JSON.stringify({ id, method: metodo, params }));
    return new Promise((listo, falla) => this.pendientes.set(id, { listo, falla }));
  }

  /** Evaluate in the page and return the value, awaiting promises. */
  async evalua(expresion) {
    const r = await this.manda('Runtime.evaluate', {
      expression: expresion,
      awaitPromise: true,
      returnByValue: true,
    });
    if (r.exceptionDetails) {
      throw new Error(r.exceptionDetails.exception?.description ?? 'page threw');
    }
    return r.result.value;
  }
}

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

let fallos = 0;
function comprueba(texto, bien, detalle = '') {
  console.log(`${bien ? '  ok  ·' : '  FAIL·'} ${texto}${bien || !detalle ? '' : `\n        ${detalle}`}`);
  if (!bien) fallos += 1;
}

async function main() {
  const url = process.argv[2];
  const ciudadVacia = process.argv[3] || '';
  if (!url) {
    console.error('usage: navegador.mjs <hall url>');
    process.exit(2);
  }
  const chrome = dondeEstaChrome();
  if (!chrome) {
    if (process.env.CITY_BROWSER_REQUIRED === '1') {
      console.error('  no Chrome on this machine, and CITY_BROWSER_REQUIRED=1');
      process.exit(1);
    }
    console.log('  no Chrome here — browser checks skipped');
    process.exit(0);
  }
  const perfil = await mkdtemp(join(tmpdir(), 'agents-city-chrome-'));
  const proceso = spawn(chrome, [
    '--headless=new',
    '--remote-debugging-port=0',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    `--user-data-dir=${perfil}`,
    'about:blank',
  ]);
  try {
    // Talk to the PAGE's own socket rather than the browser's: no sessions to
    // thread through every message, which is where a hand-rolled driver goes
    // wrong first.
    const endpoint = await esperaEndpoint(proceso);
    const base = new URL(endpoint.replace(/^ws/, 'http'));
    const pestanas = await (await fetch(`http://${base.host}/json/list`)).json();
    const pagina = pestanas.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    if (!pagina) throw new Error('chrome opened no page to drive');
    const cdp = await Cdp.abre(pagina.webSocketDebuggerUrl);

    await cdp.manda('Page.enable');
    await cdp.manda('Runtime.enable');
    await cdp.manda('Page.navigate', { url });
    for (let i = 0; i < 60; i += 1) {
      const listo = await cdp.evalua('!!document.getElementById("rail") && !!window.PASE');
      if (listo) break;
      await dormir(250);
    }

    comprueba(
      'the hall loads and reads its city',
      await cdp.evalua(
        '(async () => { for (let i = 0; i < 40; i++) { if (document.querySelectorAll("nav li").length) return true; await new Promise(r => setTimeout(r, 250)); } return false; })()',
      ),
    );

    // The skin, both ways, and remembered.
    const tema = await cdp.evalua(`(() => {
      const b = document.getElementById('temaBoton');
      if (!b) return { falta: true };
      const antes = document.documentElement.getAttribute('data-tema');
      b.click();
      const despues = document.documentElement.getAttribute('data-tema');
      return { antes, despues, guardado: localStorage.getItem('hall-tema'), etiqueta: b.textContent.trim() };
    })()`);
    comprueba(
      'the day/night switch flips the page and remembers the choice',
      !!tema && !tema.falta && tema.despues && tema.guardado === tema.despues,
      JSON.stringify(tema),
    );

    // The agents view: this is where dead controls shipped once.
    const abierto = await cdp.evalua(`(async () => {
      const ir = [...document.querySelectorAll('nav li')].find(l => /houses/i.test(l.textContent));
      if (!ir) return { falta: 'no houses entry' };
      ir.click();
      for (let i = 0; i < 40; i++) {
        if (document.querySelector('.fichaRPG')) break;
        await new Promise(r => setTimeout(r, 250));
      }
      const boton = (sel) => { const e = document.querySelector(sel); return e ? !!(e.onclick || e.onchange) : null; };
      return {
        fichas: document.querySelectorAll('.fichaRPG').length,
        alta: boton('#altaAgente'),
        instrucciones: boton('.rpgIns'),
        subir: boton('.rpgSubir input'),
        monta: boton('.rpgMonta'),
        dado: boton('.rpgDado'),
        test: boton('.rpgTest'),
      };
    })()`);
    comprueba('the houses view renders its sheets', (abierto?.fichas ?? 0) > 0, JSON.stringify(abierto));
    for (const [control, etiqueta] of [
      ['alta', 'the build-a-house button'],
      ['instrucciones', 'the CLAUDE.md / AGENTS.md editors'],
      ['subir', 'the skill zip upload'],
      ['monta', 'the + folder mount button'],
      ['dado', 'the avatar reroll'],
      ['test', 'the engine test button'],
    ]) {
      comprueba(
        `${etiqueta} is wired to a handler, not just drawn`,
        abierto?.[control] === true,
        `${control}=${JSON.stringify(abierto?.[control])}`,
      );
    }

    // And one of them actually does something when clicked.
    const modal = await cdp.evalua(`(async () => {
      const b = document.querySelector('.rpgIns');
      if (!b) return { falta: true };
      b.click();
      for (let i = 0; i < 40; i++) {
        const m = document.getElementById('editorIns');
        if (m && !m.hidden) return { abierto: true, titulo: document.getElementById('edTitulo')?.textContent ?? '' };
        await new Promise(r => setTimeout(r, 250));
      }
      return { abierto: false };
    })()`);
    comprueba(
      'clicking CLAUDE.md opens the editor on that agent',
      modal?.abierto === true && /CLAUDE\.md/.test(modal.titulo ?? ''),
      JSON.stringify(modal),
    );

    // The guided first run, checked against a city with nobody in it: that is
    // the only state where it appears, and it is the screen that used to say
    // "Not drawn yet" to somebody arriving for the first time.
    if (ciudadVacia) {
      await cdp.manda('Page.navigate', {
        url: url + '&city=' + encodeURIComponent(ciudadVacia),
      });
      for (let i = 0; i < 60; i += 1) {
        const listo = await cdp.evalua('!!document.getElementById("rail") && !!window.PASE');
        if (listo) break;
        await dormir(250);
      }
    }
    const guia = await cdp.evalua(`(async () => {
      for (let i = 0; i < 40; i++) {
        if (document.querySelector('.bvPasos')) break;
        await new Promise(r => setTimeout(r, 250));
      }
      const pasos = [...document.querySelectorAll('.bvPunto')].map(p => p.textContent.trim());
      const b = document.querySelector('[data-bv="siguiente"]');
      if (b) b.click();
      await new Promise(r => setTimeout(r, 900));
      return {
        pasos,
        titulo: document.querySelector('.bvPaso h1')?.textContent?.trim() ?? '',
        opciones: document.querySelectorAll('.bvOpcion').length,
      };
    })()`);
    comprueba(
      'a city with no agents opens the guide, not an empty map',
      (guia?.pasos?.length ?? 0) >= 4,
      JSON.stringify(guia),
    );
    comprueba(
      'and its first question offers the work domains to choose from',
      /work happens here/i.test(guia?.titulo ?? '') && (guia?.opciones ?? 0) > 3,
      JSON.stringify(guia),
    );

    // The house form: the disk search and the three engine questions. Both
    // shipped missing once — the picker offered twelve repositories with no way
    // to search past them, and nowhere to say what runs the agent, so somebody
    // building five houses had to go and set all of it again afterwards.
    const casa = await cdp.evalua(`(async () => {
      const espera = async (sel, n = 40) => {
        for (let i = 0; i < n; i++) {
          const el = document.querySelector(sel);
          if (el) return el;
          await new Promise(r => setTimeout(r, 250));
        }
        return null;
      };
      // domain -> next -> role -> next -> the roster question
      (document.querySelector('.bvOpcion'))?.click();
      await new Promise(r => setTimeout(r, 200));
      document.querySelector('[data-bv="siguiente"]')?.click();
      await new Promise(r => setTimeout(r, 700));
      (await espera('.bvOpcion'))?.click();
      await new Promise(r => setTimeout(r, 200));
      document.querySelector('[data-bv="siguiente"]')?.click();
      await new Promise(r => setTimeout(r, 900));
      (await espera('[data-bv="nuevo"]'))?.click();
      await new Promise(r => setTimeout(r, 400));
      const motores = ['#bvRuntime', '#bvModelo', '#bvEsfuerzo'].map(s => !!document.querySelector(s));
      const opcionesMotor = [...(document.querySelector('#bvModelo')?.options ?? [])].map(o => o.value);
      // The picker walks: it must list a folder, and going into one must change
      // where it says you are. Nothing is offered before you ask for it.
      await espera('.exp .expLista .expFila');
      const filas = document.querySelectorAll('.expFila').length;
      // Picking a row records it — no scan happened, nothing was suggested.
      document.querySelector('.expFila .expMas')?.click();
      await new Promise(r => setTimeout(r, 300));
      const elegidas = document.querySelectorAll('.expElegidas .bvChip').length;
      // And going into a folder must change where it says you are.
      const dondeAntes = document.querySelector('.expMigas')?.textContent ?? '';
      [...document.querySelectorAll('.expFila.dir .expNombre')][0]?.click();
      for (let i = 0; i < 40; i++) {
        if ((document.querySelector('.expMigas')?.textContent ?? '') !== dondeAntes) break;
        await new Promise(r => setTimeout(r, 250));
      }
      const dondeDespues = document.querySelector('.expMigas')?.textContent ?? '';
      return { motores, opcionesMotor, filas, dondeAntes, dondeDespues, elegidas,
               sube: !!document.querySelector('.expSubir'),
               tomaAqui: !!document.querySelector('.expTomaAqui') };
    })()`);
    comprueba(
      'the house form walks the disk — nothing offered, you pick what you want',
      (casa?.filas ?? 0) > 0 && !!casa?.sube && !!casa?.tomaAqui &&
        casa.dondeDespues !== casa.dondeAntes && (casa?.elegidas ?? 0) > 0,
      JSON.stringify(casa),
    );
    comprueba(
      'and asks what runs the agent — provider, engine and effort',
      (casa?.motores ?? []).every(Boolean) && (casa?.opcionesMotor ?? []).includes('opus'),
      JSON.stringify(casa),
    );

    // Cities: a person must be able to start and retire one without a terminal.
    const ciudades = await cdp.evalua(`(async () => {
      const ir = [...document.querySelectorAll('nav li')].find(l => /cities/i.test(l.textContent));
      if (!ir) return { falta: true };
      ir.click();
      await new Promise(r => setTimeout(r, 700));
      return {
        crear: !!document.getElementById('creaCiudad'),
        campo: !!document.getElementById('nuevaCiudad'),
        filas: document.querySelectorAll('.lista .fila').length,
      };
    })()`);
    const reinicio = await cdp.evalua(`(async () => {
      const b = document.getElementById('reiniciaCiudad');
      if (!b) return { falta: true };
      // Nothing is clicked here: this asks the server what a reset WOULD do,
      // which is the same call the button makes before it dares ask anything.
      const r = await fetch('/api/ciudad-reinicia?PASE=' + window.PASE, {
        method: 'POST',
        headers: { 'X-City-Pase': window.PASE, 'Content-Type': 'application/json' },
        body: '{}',
      }).then((x) => x.json());
      return { cableado: !!b.onclick, ok: r.ok, previa: r.preview, error: r.error };
    })()`);
    comprueba(
      'the danger button exists and is wired',
      reinicio?.cableado === true,
      JSON.stringify(reinicio),
    );
    comprueba(
      // Two acceptable answers, one forbidden: a preview of what would happen,
      // or a refusal (this fixture's city lives outside the owner's folder and
      // reset declines to touch such a thing). What must NEVER come back from a
      // call with no typed name is ok:true — that would be a reset on one click.
      'without the typed name it previews or refuses, but never resets',
      reinicio?.ok !== true &&
        (Array.isArray(reinicio?.previa?.loses) || typeof reinicio?.error === 'string'),
      JSON.stringify(reinicio),
    );

    comprueba(
      'the Cities section can start a new city',
      ciudades?.crear === true && ciudades?.campo === true,
      JSON.stringify(ciudades),
    );

    // The app's own dialogs. Every one of these was a `window.prompt` box, and
    // a headless browser answers those with null — which is how three dead
    // buttons could have passed a browser suite that only counted clicks.
    const dlg = await cdp.evalua(`(async () => {
      const espera = async (sel, n = 40) => {
        for (let i = 0; i < n; i++) {
          const el = document.querySelector(sel);
          if (el) return el;
          await new Promise(r => setTimeout(r, 250));
        }
        return null;
      };
      const nueva = document.getElementById('alWizard');
      nueva?.click();
      const caja = await espera('.dlgFondo .dlg');
      if (!caja) return { falta: true };
      const acepta = caja.querySelector('[data-dlg="si"]');
      const campo = caja.querySelector('input[data-campo="name"]');
      const bloqueado = !!acepta?.disabled;
      if (campo) {
        campo.value = 'x';
        campo.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise(r => setTimeout(r, 100));
      }
      const libre = !acepta?.disabled;
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await new Promise(r => setTimeout(r, 200));
      return {
        titulo: caja.querySelector('h2')?.textContent?.trim() ?? '',
        campo: !!campo, bloqueado, libre,
        cerrado: !document.querySelector('.dlgFondo'),
      };
    })()`);
    comprueba(
      'creating a city asks in the app, not through a browser prompt box',
      !!dlg && !dlg.falta && dlg.campo && dlg.bloqueado && dlg.libre && dlg.cerrado,
      JSON.stringify(dlg),
    );

    // Building a house from the houses view: the guide's form, in a dialog.
    const alta = await cdp.evalua(`(async () => {
      const ir = [...document.querySelectorAll('nav li')].find(l => /houses|casas/i.test(l.textContent));
      ir?.click();
      await new Promise(r => setTimeout(r, 700));
      document.getElementById('altaAgente')?.click();
      for (let i = 0; i < 40; i++) {
        if (document.querySelector('.dlgFondo .exp .expFila')) break;
        await new Promise(r => setTimeout(r, 250));
      }
      const caja = document.querySelector('.dlgFondo .dlg');
      const hay = s => !!caja?.querySelector(s);
      const fuera = {
        nombre: hay('#bvNombre'), clase: hay('[data-bv="clase"]'), rol: hay('#bvRol'),
        motor: hay('#bvRuntime') && hay('#bvModelo') && hay('#bvEsfuerzo'),
        explora: hay('.exp .expLista'),
      };
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await new Promise(r => setTimeout(r, 200));
      return fuera;
    })()`);
    comprueba(
      'and building a house opens the same form the guide uses, not three prompts',
      !!alta && alta.nombre && alta.clase && alta.rol && alta.motor && alta.explora,
      JSON.stringify(alta),
    );

    // The demo shelf: three cards, and a player that actually advances.
    const demo = await cdp.evalua(`(async () => {
      const espera = async (sel, n = 40) => {
        for (let i = 0; i < n; i++) {
          const el = document.querySelector(sel);
          if (el) return el;
          await new Promise(r => setTimeout(r, 250));
        }
        return null;
      };
      const ir = [...document.querySelectorAll('nav li')].find(l => /demos/i.test(l.textContent));
      if (!ir) return { falta: true };
      ir.click();
      const carta = await espera('.demoCarta');
      const cartas = document.querySelectorAll('.demoCarta').length;
      carta?.click();
      await espera('.demoPlayer');
      // Fastest speed, so the check does not sit here for half a minute.
      document.querySelector('[data-demo="vel"][data-ms="350"]')?.click();
      await new Promise(r => setTimeout(r, 200));
      const alPrincipio = document.querySelectorAll('#demoLista .liveTurn').length;
      for (let i = 0; i < 60; i++) {
        if (document.querySelectorAll('#demoLista .liveTurn').length > alPrincipio + 1) break;
        await new Promise(r => setTimeout(r, 250));
      }
      const jugando = document.querySelectorAll('#demoLista .liveTurn').length;
      document.querySelector('[data-demo="pausa"]')?.click();
      await new Promise(r => setTimeout(r, 700));
      const enPausa = document.querySelectorAll('#demoLista .liveTurn').length;
      await new Promise(r => setTimeout(r, 700));
      const sigueEnPausa = document.querySelectorAll('#demoLista .liveTurn').length;
      document.querySelector('[data-demo="replay"]')?.click();
      await new Promise(r => setTimeout(r, 150));
      const trasReplay = document.querySelectorAll('#demoLista .liveTurn').length;
      document.querySelector('[data-demo="pausa"]')?.click();
      return { cartas, alPrincipio, jugando, enPausa, sigueEnPausa, trasReplay,
               dice: (document.querySelector('.demoPlayer .pista')?.textContent ?? '') };
    })()`);
    comprueba(
      'the demo shelf offers one story per domain and plays it turn by turn',
      (demo?.cartas ?? 0) === 3 && demo.jugando > demo.alPrincipio,
      JSON.stringify(demo),
    );
    comprueba(
      'and pause holds, and replay starts it over',
      demo?.sigueEnPausa === demo?.enPausa && (demo?.trasReplay ?? 99) < (demo?.enPausa ?? 0),
      JSON.stringify(demo),
    );
    comprueba(
      'and it says out loud that it is a recording, not a live committee',
      /recording|grabaci/i.test(demo?.dice ?? ''),
      JSON.stringify(demo?.dice),
    );

    // Spanish and English, on a switch. The READMEs shipped bilingual and the
    // product did not; a language button that does not actually change the page
    // is worse than none at all.
    const lengua = await cdp.evalua(`(async () => {
      const b = document.getElementById('idiomaBoton');
      if (!b) return { falta: true };
      const rail = () => document.getElementById('rail')?.textContent ?? '';
      const antes = rail();
      const etiquetaAntes = b.textContent.trim();
      b.click();
      for (let i = 0; i < 40; i++) {
        if (rail() !== antes) break;
        await new Promise(r => setTimeout(r, 250));
      }
      return {
        antes,
        despues: rail(),
        etiquetaAntes,
        etiqueta: b.textContent.trim(),
        guardado: localStorage.getItem('hall-idioma'),
        lang: document.documentElement.lang,
        marca: document.querySelector('.marca p')?.textContent?.trim() ?? '',
      };
    })()`);
    comprueba(
      'the language switch really translates the page, and remembers it',
      !!lengua && !lengua.falta && lengua.despues !== lengua.antes &&
        /casas|resumen|mapa/i.test(lengua.despues) && lengua.guardado === lengua.lang &&
        lengua.etiqueta !== lengua.etiquetaAntes,
      JSON.stringify(lengua),
    );
    comprueba(
      'including the chrome that lives in the page rather than in a view',
      /ciudad|ayuntamiento/i.test(lengua?.marca ?? ''),
      JSON.stringify(lengua?.marca),
    );

    const errores = await cdp.evalua('window.__erroresDePagina ? window.__erroresDePagina.length : 0');
    comprueba('the page raised no uncaught errors while we drove it', errores === 0, String(errores));
  } finally {
    proceso.kill('SIGKILL');
  }
  console.log(`\n  ${fallos ? `${fallos} failed` : 'browser ok'} — 16 checks\n`);
  process.exit(fallos ? 1 : 0);
}

main().catch((e) => {
  console.error(`  browser checks could not run: ${e.message}`);
  process.exit(1);
});
