/**
 * `agents-city orgs`: an organization, run from the terminal.
 *
 * An organization is the consent a company gives once. Its members reach each
 * other over the same end-to-end encrypted connection two people otherwise
 * approve by hand; belonging replaces that approval. The service learns who
 * belongs and who is connected, never what anybody's agents are called.
 *
 * This module imports nothing: it parses, asks through the `Ask` it is handed,
 * and prints. The signed transport lives in `cli.ts`, so the whole command
 * surface is checked without a keyring or a network.
 */

type Fields = Record<string, string | number>;
export type OrganizationAction =
  'list' | 'create' | 'invite' | 'join' | 'members' | 'connect' | 'role' | 'remove';
export type Ask = <T>(action: OrganizationAction, fields?: Fields) => Promise<T>;
export type OrganizationsDeps = {
  /** Opens the signed channel on first use; never called for a refused command. */
  open: () => Promise<Ask>;
  print?: (line: string) => void;
};

type Organization = {
  organization: string;
  name: string;
  plan: string;
  role: string;
  members: number;
};
type Member = {
  account: string;
  name: string;
  role: string;
  self: boolean;
  paired: boolean;
  connection: string | null;
};

const SLUG = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
const ACCOUNT = /^[a-z0-9_-]{1,32}$/;

export function organizationsUsage(): string {
  return `usage:
  agents-city orgs list
  agents-city orgs create <organization> [--name "Display name"]
  agents-city orgs invite <organization> [--uses N]
  agents-city orgs join <code>
  agents-city orgs members <organization>
  agents-city orgs connect <organization> <account>
  agents-city orgs role <organization> <account> admin|member
  agents-city orgs remove <organization> <account>
  agents-city orgs leave <organization>

An organization is named by a lowercase slug, 3 to 40 characters. Its owner or
an admin hands out a join code; whoever joins can open an encrypted connection
to any other member with no further approval. Removing a member, or leaving,
closes the connections the organization opened for that account. Add --json to
any command for machine-readable output. Run agents-city auth login first.`;
}

/** What the service answered, said the way a person at a terminal needs it. */
const EXPLAINED: Record<string, string> = {
  invalid_device_proof:
    'this computer is not recognised by the service; run agents-city auth login',
  organization_not_found: 'no such organization, or this account does not belong to it',
  organization_taken: 'that organization name is already taken',
  invalid_organization: 'an organization is a lowercase slug, 3 to 40 letters, digits or dashes',
  invalid_organization_name: "a display name is up to 60 letters, digits, spaces and . & ' -",
  organization_allowance_exceeded: 'one account may own three organizations',
  forbidden: 'your role in this organization does not allow that',
  organization_code_unavailable: 'that code is not valid: used up, expired, or mistyped',
  organization_code_already_used: 'this account already used that code',
  invalid_organization_code: 'that is not a join code; it starts with org_',
  member_allowance_exceeded: "the organization's plan has no seats left",
  membership_suspended: 'this membership is suspended; ask the owner',
  guest_must_be_removed_first:
    'this account is a guest there; the owner must remove it before it can join',
  member_not_found: 'no member with that account in this organization',
  second_account_required: 'a connection needs a second account',
  connection_device_required: 'the other member has not paired a computer yet',
  connection_allowance_exceeded: "the organization's plan has no connections left",
  connection_unavailable:
    'one of you closed or blocked this connection; membership does not reopen it',
  connection_request_already_pending:
    'a connection request between you two is already waiting for review',
  owner_cannot_leave: 'the owner cannot leave their own organization',
  owner_role_is_fixed: "the owner's role cannot be changed",
  organization_invitations_unavailable: 'this organization is not accepting new members',
  organization_invitation_allowance_exceeded: "today's join codes are used up for this plan",
  too_many_join_attempts: 'too many attempts; wait fifteen minutes',
};

export function explainOrganizationError(error: unknown): string {
  const code =
    (error as { name?: unknown; code?: unknown } | null)?.name === 'ConnectApiError'
      ? String((error as { code?: unknown }).code)
      : '';
  if (code) return EXPLAINED[code] ?? code;
  return error instanceof Error ? error.message : String(error);
}

function take(rest: string[], flag: string): string {
  const at = rest.indexOf(flag);
  if (at < 0) return '';
  const value = rest[at + 1];
  if (value === undefined) throw new Error(`${flag} needs a value`);
  rest.splice(at, 2);
  return value;
}

function slugOf(value: string | undefined): string {
  if (!value || !SLUG.test(value)) throw new Error(EXPLAINED.invalid_organization);
  return value;
}

function accountOf(value: string | undefined): string {
  if (!value || !ACCOUNT.test(value))
    throw new Error('an account is its handle: lowercase letters, digits, _ or -');
  return value;
}

function only(rest: string[], count: number, what: string): void {
  if (rest.length !== count) throw new Error(`${what}; see agents-city orgs --help`);
}

type Run = (rest: string[], ask: Ask) => Promise<{ value: unknown; lines: string[] }>;

const COMMANDS: Record<string, Run> = {
  async list(rest, ask) {
    only(rest, 0, 'list takes no arguments');
    const value = await ask<{ account: string; organizations: Organization[] }>('list');
    const lines = value.organizations.length
      ? value.organizations.map(
          (o) =>
            `  ${o.organization.padEnd(24)} ${o.role.padEnd(7)} ${String(o.members).padStart(4)} member(s)  ${o.plan}`,
        )
      : [`  ${value.account} belongs to no organization. Create one, or join with a code.`];
    return { value, lines };
  },
  async create(rest, ask) {
    const name = take(rest, '--name');
    only(rest, 1, 'create takes one organization');
    const organization = slugOf(rest[0]);
    const value = await ask<Organization>(
      'create',
      name ? { organization, name } : { organization },
    );
    return {
      value,
      lines: [
        `  Created ${value.organization}. You are its owner.`,
        `  Invite people: agents-city orgs invite ${value.organization} --uses 10`,
      ],
    };
  },
  async invite(rest, ask) {
    const uses = take(rest, '--uses');
    only(rest, 1, 'invite takes one organization');
    const organization = slugOf(rest[0]);
    const count = uses ? Number(uses) : 1;
    if (!Number.isSafeInteger(count) || count < 1 || count > 100) {
      throw new Error('--uses is a number from 1 to 100');
    }
    const value = await ask<{
      organization: string;
      code: string;
      uses: number;
      expiresIn: number;
    }>('invite', { organization, uses: count });
    return {
      value,
      lines: [
        `  ${value.code}`,
        `  Good for ${value.uses} ${value.uses === 1 ? 'person' : 'people'}, for 7 days. It is shown once:`,
        '  the service keeps only its hash. Whoever has it runs:',
        '    agents-city orgs join <code>',
      ],
    };
  },
  async join(rest, ask) {
    only(rest, 1, 'join takes one code');
    const value = await ask<{ organization: string; role: string; duplicate?: boolean }>('join', {
      code: rest[0] ?? '',
    });
    return {
      value,
      lines: [
        value.duplicate
          ? `  You already belong to ${value.organization}. The code was not used.`
          : `  Joined ${value.organization} as ${value.role}. See who is there: agents-city orgs members ${value.organization}`,
      ],
    };
  },
  async members(rest, ask) {
    only(rest, 1, 'members takes one organization');
    const value = await ask<{ organization: string; members: Member[] }>('members', {
      organization: slugOf(rest[0]),
    });
    const lines = value.members.map((m) => {
      const link = m.self
        ? 'you'
        : m.connection === 'active'
          ? 'connected'
          : m.connection
            ? 'connecting'
            : m.paired
              ? 'not connected yet'
              : 'no computer paired';
      return `  ${m.account.padEnd(24)} ${m.role.padEnd(7)} ${link}`;
    });
    return { value, lines };
  },
  async connect(rest, ask) {
    only(rest, 2, 'connect takes an organization and an account');
    const account = accountOf(rest[1]);
    const value = await ask<{ connection: { id: string; status: string }; duplicate?: boolean }>(
      'connect',
      { organization: slugOf(rest[0]), account },
    );
    const ready = value.connection.status === 'active';
    return {
      value,
      lines: [
        value.duplicate
          ? `  Already connected with ${account}.`
          : `  Connected with ${account}. No approval was needed: you share an organization.`,
        ...(ready ? [] : ['  The relay is still opening it; it will carry messages in a moment.']),
      ],
    };
  },
  async role(rest, ask) {
    only(rest, 3, 'role takes an organization, an account and admin or member');
    if (!['admin', 'member'].includes(rest[2] ?? '')) throw new Error('a role is admin or member');
    const value = await ask<{ account: string; role: string }>('role', {
      organization: slugOf(rest[0]),
      account: accountOf(rest[1]),
      role: rest[2]!,
    });
    return { value, lines: [`  ${value.account} is now ${value.role}.`] };
  },
  async remove(rest, ask) {
    only(rest, 2, 'remove takes an organization and an account');
    return removal(ask, slugOf(rest[0]), accountOf(rest[1]), false);
  },
  async leave(rest, ask) {
    only(rest, 1, 'leave takes one organization');
    return removal(ask, slugOf(rest[0]), '', true);
  },
};

async function removal(ask: Ask, organization: string, account: string, leaving: boolean) {
  const value = await ask<{ account: string; connections: { closed: number; closing: number } }>(
    'remove',
    account ? { organization, account } : { organization },
  );
  const { closed, closing } = value.connections;
  return {
    value,
    lines: [
      leaving ? `  You left ${organization}.` : `  Removed ${value.account} from ${organization}.`,
      `  ${closed + closing} connection(s) the organization had opened ${closing ? 'are closing' : 'are closed'}.`,
    ],
  };
}

export async function organizationsCli(args: string[], deps: OrganizationsDeps): Promise<void> {
  const rest = [...args];
  const print = deps.print ?? ((line: string) => console.log(line));
  const jsonAt = rest.indexOf('--json');
  if (jsonAt >= 0) rest.splice(jsonAt, 1);
  const command = rest.shift() ?? 'help';
  const run = COMMANDS[command];
  if (!run || rest.includes('--help') || rest.includes('-h')) {
    if (!run && !['help', '--help', '-h'].includes(command)) {
      throw new Error(`unknown orgs command: ${command}; see agents-city orgs --help`);
    }
    print(organizationsUsage());
    return;
  }
  // Arguments are checked before the service is reached, so a typo costs no
  // request and names no account to anybody.
  let ask: Ask | undefined;
  const lazy: Ask = async (action, fields) => {
    ask ??= await deps.open();
    return ask(action, fields);
  };
  const { value, lines } = await run(rest, lazy);
  if (jsonAt >= 0) print(JSON.stringify(value, null, 2));
  else for (const line of lines) print(line);
}
