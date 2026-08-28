import { ActorRole } from '../protocol.js';
import { committeeActivities } from '../committee/activity.js';
import { requireChair } from '../committee/guards.js';
import { committeeService } from '../committee/service.js';
import type { ActivityDraft } from './activity-feed.js';
import { EnvelopeRouter } from './envelopes.js';

type CommitteeService = ReturnType<typeof committeeService>;

export function committeeController(
  service: CommitteeService,
  router: EnvelopeRouter,
  observe: (event: ActivityDraft) => void = () => {},
) {
  const command = (
    name: string,
    thread: string | undefined,
    payload: Record<string, unknown>,
    actor: string,
    role: ActorRole,
  ): unknown => {
    if (name === 'committee.history') {
      requireChair(actor, role);
      return service.history(thread);
    }
    if (name === 'committee.list') {
      return service
        .list()
        .filter(
          (state) =>
            role === 'chair' ||
            state.brief.participants.includes(actor) ||
            state.decisions.at(-1)?.verifier === actor,
        )
        .map((state) => ({
          id: state.id,
          status: state.status,
          question: state.brief.question,
          participants: state.brief.participants,
          received: Object.keys(state.positions).length,
          createdAt: state.createdAt,
          updatedAt: state.updatedAt,
        }));
    }
    if (name === 'committee.get') {
      if (!thread) throw new Error('thread is required');
      return service.view(thread, actor, role);
    }
    const result = service.transition(name, thread, payload, actor, role);
    for (const delivery of result.deliveries) {
      router.internal(delivery.kind, actor, role, delivery.to, result.state.id, delivery.payload);
    }
    for (const event of committeeActivities(name, result.state, payload, actor, role)) {
      observe(event);
    }
    return service.view(result.state.id, actor, role);
  };

  return { command };
}
