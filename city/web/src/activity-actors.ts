import { Container } from 'pixi.js';
import { ActivityEvent } from './activity';
import { arquitecto, perito } from './people';

export interface ActorPosition {
  x: number;
  y: number;
}

/** Materialises only speakers that the map's older presence feed does not know
 * about yet. Each figure is backed by a real activity event and placed beside
 * its repo; no random NPC conversation is invented. */
export class ActivityActors {
  private created = new Map<string, Container>();

  constructor(
    private readonly layer: Container,
    private readonly findExisting: (actor: string) => Container | null,
    private readonly positionFor: (event: ActivityEvent) => ActorPosition,
    private readonly decorate?: (figure: Container, actor: string) => void,
  ) {}

  resolve = (event: ActivityEvent): Container => {
    const actor = event.actor.trim();
    const existing = this.findExisting(actor);
    if (existing) {
      const synthetic = this.created.get(actor);
      if (synthetic) {
        synthetic.parent?.removeChild(synthetic);
        synthetic.destroy({ children: true });
        this.created.delete(actor);
      }
      this.decorate?.(existing, actor);
      return existing;
    }

    const known = this.created.get(actor);
    if (known) return known;
    const figure = event.role === 'chair' ? arquitecto(actor) : perito(actor, 'repo agent');
    const point = this.positionFor(event);
    figure.position.set(point.x, point.y);
    this.layer.addChild(figure);
    this.created.set(actor, figure);
    this.decorate?.(figure, actor);
    return figure;
  };
}
