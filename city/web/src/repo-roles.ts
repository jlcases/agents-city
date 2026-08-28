/** Pure rendering/data helpers for one operating role per repo support agent. */
export interface RepoRoleOption {
  id: string;
  name: string;
  summary: string;
  trade: string;
  domains: string[];
}

export type RepoRoleAssignments = Record<string, string>;

export function selectedRepoRoles(
  repos: Iterable<string>,
  assignments: RepoRoleAssignments,
): RepoRoleAssignments {
  return Object.fromEntries([...repos].sort().map((repo) => [repo, assignments[repo] || 'blank']));
}

export function renderRepoRoleEditor(
  repos: Iterable<string>,
  assignments: RepoRoleAssignments,
  roles: RepoRoleOption[],
  escape: (value: unknown) => string,
): string {
  const selected = [...repos].sort();
  if (!selected.length) {
    return '<p class="prosa">No repo agents in this city.</p>';
  }
  return `<div class="agenteRoles">${selected
    .map((repo) => {
      const current = assignments[repo] || 'blank';
      const choices = roles.some((role) => role.id === current)
        ? roles
        : [
            {
              id: current,
              name: `${current} (city-defined)`,
              summary: 'Role defined in this city rather than the built-in catalogue.',
              trade: current,
              domains: [],
            },
            ...roles,
          ];
      return `<div class="agenteRol">
        <div><code>${escape(repo)}</code><span>support agent · member</span></div>
        <select data-repo-role="${escape(repo)}" aria-label="Operating role for ${escape(repo)}">
          ${choices
            .map((role) => {
              const family = role.domains.filter((domain) => domain !== 'custom').join(', ');
              const suffix = family ? ` · ${family}` : '';
              return `<option value="${escape(role.id)}"${role.id === current ? ' selected' : ''}
                title="${escape(role.summary)}">${escape(role.name)}${escape(suffix)}</option>`;
            })
            .join('')}
        </select>
      </div>`;
    })
    .join('')}</div>`;
}
