/**
 * A thing that lives inside an element and can be asked to leave.
 *
 * Four classes had grown their own spelling of "render into a host and repaint"
 * — `Explorador`, `FormularioDeCasa`, `Demos` and `Bienvenida` — and *repaint*
 * meant something different in three of them. The duplicated lines are few;
 * what was actually missing is the second half of the contract, and the router
 * was paying for it by hand:
 *
 *     if (SECCION !== 'demos') demos?.para();
 *
 * A view dispatcher that knows one view's name and one of its teardown methods
 * has to grow a line like that for every view that owns a timer, an interval or
 * a socket. `desmonta` is that line, once, in the only place that knows a view
 * is being left.
 */
export interface Vista {
  /** Render into `host` and wire it. Calling it again is the repaint. */
  monta(host: HTMLElement): void;
  /** Stop anything still running. Optional: most views own nothing. */
  desmonta?(): void;
}

/**
 * The shared half: remember the host, render, wire, repeat.
 *
 * Deliberately small. A subclass says what it draws (`html`) and what it wires
 * (`enlaza`); anything it must do on first mount — start a fetch, walk to a
 * folder — it does by overriding `monta` and calling `super.monta` first.
 */
export abstract class Montada implements Vista {
  protected host: HTMLElement | null = null;

  monta(host: HTMLElement): void {
    this.host = host;
    this.dibuja();
  }

  /**
   * Put the markup in and wire it. Final in spirit: `monta` calls THIS and not
   * `repinta`, because a subclass whose repaint has to rebuild something
   * nested — the house form remounts its folder picker — overrides `repinta`
   * to call `monta`, and a base that repainted on mount would then call itself
   * until the stack ran out. It did.
   */
  private dibuja(): void {
    if (!this.host) return;
    this.host.innerHTML = this.html();
    this.enlaza(this.host);
  }

  protected repinta(): void {
    this.dibuja();
  }

  protected abstract html(): string;
  protected abstract enlaza(raiz: HTMLElement): void;
}
