# Contribution Guidelines

## Branching & Workflow
- Create a new branch for every change.
- Use descriptive branch names (e.g. `feature/add-login`, `fix/navbar-bug`).
- Never commit directly to `master`.
- All changes must go through a branch before being merged.

## Quality Gates (Before Merge to Master)
- Linting must run automatically before push.
- All lint errors must be automatically fixed when possible (e.g. via `--fix`).
- No lint errors may remain after automatic fixes.
- Run all relevant tests and ensure they pass.
- Do not merge to `master` if any checks fail.
- Prefer automated checks (e.g. CI) when available.

## Push & CI Workflow (follow this order every time)
1. Make sure you are on a feature branch — never commit to `master` directly.
   If on `master`, stash changes, create the branch, then pop:
   `git stash && git checkout -b <branch> && git stash pop`
2. Commit and push: `git push -u origin <branch>`
   The Husky pre-push hook runs `eslint --fix` automatically; if it modifies
   files it aborts and asks you to commit the fixes first.
3. GitHub Actions runs lint + auto-merge (`.github/workflows/lint.yml`).
4. If CI fails: check with `gh run list --branch <branch>` then
   `gh run view <run-id> --log-failed`, fix, commit, push again.
5. When lint passes the `auto-merge` job:
   - Creates a PR using `gh pr create` and captures the returned PR URL.
   - Calls `gh pr merge --auto --merge <PR-URL>` (URL, not branch name —
     branch names with `/` are unreliable with `gh pr merge`).
   - The branch is merged to `master` automatically. No manual action needed.
6. Never manually create PRs or merge branches; let CI handle it.

## Pre-Push Requirements
- Automatically run linting with auto-fix (e.g. `eslint --fix`).
- Prevent push if:
  - Lint errors remain after auto-fix
  - Tests fail
- This should be enforced via hooks (e.g. Husky, pre-commit, or similar).

## Commits
- Follow the Conventional Commits specification.
- Keep commits small, focused, and atomic.
- Suggest a commit message only when explicitly asked.
- Never commit or push without explicit user instruction.
- Reference relevant GitHub issues when applicable.
- Do not include any "Co-Authored-By" attribution to Claude in commit messages.

## Versioning & Releases
- Use semantic versioning (SemVer).
- Tag and release versions using the format: `1.0.0`.
- Only perform tagging and release steps when explicitly requested.

## Changelog
- Maintain a `CHANGELOG.md` file.
- Update the changelog only when preparing a commit, tag, or release.
- Follow a consistent format (e.g. Keep a Changelog).
- Group changes under:
  - Added
  - Changed
  - Fixed
  - Removed

## Documentation
- Update `README.md` only when explicitly requested or when preparing a commit, tag, or release.

## General Principles
- Avoid unnecessary work during normal development flow.
- Prefer clarity and consistency over cleverness.
- Ensure changes are easy to review and understand.