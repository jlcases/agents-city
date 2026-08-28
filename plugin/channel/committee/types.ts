import { ActorRole } from '../protocol.js';

export const STANCES = ['support', 'oppose', 'conditional', 'abstain'] as const;
export const FLOOR_BASES = ['new_evidence', 'contradiction', 'risk', 'dependency'] as const;
export const AUTHORITIES = ['recommend', 'decide', 'execute'] as const;
export const VERIFY_RESULTS = ['pass', 'fail'] as const;
export const TERMINAL_STATUSES = new Set(['closed', 'cancelled']);

export type DeliberationStatus =
  | 'collecting'
  | 'review'
  | 'deliberating'
  | 'verifying'
  | 'verified'
  | 'verification_failed'
  | 'closed'
  | 'cancelled';

export interface CityIdentity {
  id: string;
  address: string;
  name: string;
}

export interface Position {
  stance: (typeof STANCES)[number];
  recommendation: string;
  evidence: string[];
  expectedImpact: string;
  visibleWhen: string;
  withdrawIf: string;
  risks: string[];
  unknowns: string[];
  submittedAt: string;
}

export interface FloorRequest {
  id: string;
  actor: string;
  basis: (typeof FLOOR_BASES)[number];
  reason: string;
  evidence: string[];
  status: 'pending' | 'granted' | 'used' | 'denied';
  requestedAt: string;
  decidedAt?: string;
  decisionReason?: string;
}

export interface Decision {
  id: string;
  outcome: string;
  rationale: string;
  owner: string;
  executor: string;
  verifier: string;
  verificationQuestion: string;
  selectedEvidence: string[];
  decisiveContributors: string[];
  rejectedOptions: string[];
  dissent: string[];
  reopenIf: string[];
  decidedAt: string;
  verification?: {
    result: (typeof VERIFY_RESULTS)[number];
    evidence: string[];
    checks: string[];
    residualRisks: string[];
    verifiedBy: string;
    verifiedAt: string;
  };
}

export interface DeliberationState {
  schema: 'agents-city/deliberation@1';
  id: string;
  city: CityIdentity;
  parent: string | null;
  status: DeliberationStatus;
  createdAt: string;
  updatedAt: string;
  brief: {
    question: string;
    desiredOutcome: string;
    context: string;
    constraints: string[];
    definitionOfDone: string[];
    authority: (typeof AUTHORITIES)[number];
    participants: string[];
    maxRebuttals: number;
  };
  participantRepos: Record<string, string>;
  /** Professional perspective, distinct from the chair/member authority role. */
  participantRoles?: Record<string, string>;
  positions: Record<string, Position>;
  synthesis: null | {
    summary: string;
    agreements: string[];
    conflicts: string[];
    unknowns: string[];
    missing: string[];
    proceedWithout: string;
    publishedAt: string;
  };
  floor: {
    requests: FloorRequest[];
    active: null | { requestId: string; actor: string; grantedAt: string };
    replies: Array<{
      requestId: string;
      actor: string;
      claim: string;
      evidence: string[];
      consequence: string;
      repliedAt: string;
    }>;
  };
  decisions: Decision[];
  closure: null | {
    summary: string;
    learnings: string[];
    followups: string[];
    closedAt: string;
  };
  progress: { revision: number; failedVerifications: number };
}

export interface CommitteeEvent {
  seq: number;
  at: string;
  type: string;
  actor: string;
  role: ActorRole;
  payload: Record<string, unknown>;
}

export interface Delivery {
  kind: string;
  to: string;
  payload: Record<string, unknown>;
}

export interface TransitionResult {
  state: DeliberationState;
  deliveries: Delivery[];
}

export interface DecisionHistory {
  recent: Array<{
    deliberation: string;
    question: string;
    outcome: string;
    decisiveContributors: string[];
    verification: string;
    decidedAt: string;
    reopenIf: string[];
  }>;
  contributorCounts: Array<{ actor: string; decisions: number }>;
  note: string;
}

export type ActorDirectory = Record<
  string,
  { role: ActorRole; repo?: string; operatingRole?: string }
>;
