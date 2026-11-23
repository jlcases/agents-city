import type { ControlEnv } from './control-plane';

/**
 * The seam where an operator who sells access plugs in a payment provider.
 *
 * The open service charges nobody: no subscription row is ever written, so
 * these are never asked to do anything. They exist so that deleting an account
 * refuses, rather than orphans, a paid subscription on a deployment whose
 * operator added billing and forgot to replace this module.
 */
export const canCancelSubscriptions = (_env: ControlEnv): boolean => false;

export const cancelSubscription = async (_env: ControlEnv, _subscriptionId: string): Promise<void> => {
  throw new Error('billing_not_configured');
};
