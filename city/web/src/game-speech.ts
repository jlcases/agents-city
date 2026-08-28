import type { Container } from 'pixi.js';
import { ActivityEvent, compactSpeech, speechRecipient } from './activity';

interface ActiveSpeech {
  element: HTMLDivElement;
  target: Container;
  timer: number;
}

/** Video-game speech over a real figure. It deliberately renders in HTML so
 * the text stays readable while the isometric world zooms underneath it. */
export class CitySpeech {
  private readonly active = new Map<string, ActiveSpeech>();

  constructor(
    private readonly host: HTMLElement,
    private readonly resolveActor: (event: ActivityEvent) => Container | null,
  ) {}

  show(event: ActivityEvent): boolean {
    const actor = event.actor.trim();
    const body = compactSpeech(event.summary);
    if (!actor || !body || actor === 'system') return false;
    const target = this.resolveActor(event);
    if (!target) return false;

    this.remove(actor);
    const element = document.createElement('div');
    element.className = 'gameSpeech';
    element.dataset.actor = actor;
    element.dataset.tone = event.tone;
    element.setAttribute('role', 'status');
    element.setAttribute('aria-label', `${actor}, para ${speechRecipient(event)}: ${body}`);

    const to = document.createElement('span');
    to.className = 'to';
    to.textContent = `Para ${speechRecipient(event)}:`;
    const text = document.createElement('span');
    text.textContent = body;
    element.append(to, text);
    this.host.appendChild(element);

    const timer = window.setTimeout(() => this.remove(actor), 7_650);
    this.active.set(actor, { element, target, timer });
    this.tick();
    return true;
  }

  tick(): void {
    for (const [actor, speech] of this.active) {
      if (!speech.target.parent) {
        this.remove(actor);
        continue;
      }
      const bounds = speech.target.getBounds();
      const half = Math.max(70, speech.element.offsetWidth / 2);
      const x = clamp((bounds.minX + bounds.maxX) / 2, half + 8, this.host.clientWidth - half - 8);
      const y = Math.max(speech.element.offsetHeight + 18, bounds.minY - 5);
      speech.element.style.left = `${Math.round(x)}px`;
      speech.element.style.top = `${Math.round(y)}px`;
    }
  }

  remove(actor: string): void {
    const speech = this.active.get(actor);
    if (!speech) return;
    clearTimeout(speech.timer);
    speech.element.remove();
    this.active.delete(actor);
  }

  dispose(): void {
    for (const actor of [...this.active.keys()]) this.remove(actor);
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}
