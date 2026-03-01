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
1. Commit changes on a feature branch and push: `git push -u origin <branch>`
2. GitHub Actions runs lint automatically (`.github/workflows/lint.yml`).
3. If lint fails: check the logs with `gh run list --branch <branch>` and
   `gh run view <run-id> --log-failed`, fix the errors, commit, and push again.
4. When lint passes, the `auto-merge` job creates a PR (if none exists) and
   enables auto-merge — the branch is merged to `master` automatically.
5. Never manually merge or create PRs; let the CI handle it.

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