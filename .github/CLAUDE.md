# .github

- Pull requests into `develop` and `main` must run policy, check, build, and test gates.
- Pushes to `develop`, `main` and `v*` tags publish images to GHCR only after every verification job is green.
- A push to `develop` deploys dev; a `v*` tag on `main` deploys production after approval in the `production` environment. Keep both behind `deploy.yml`, serialized per environment.
- Deploy credentials live in the `dev` and `production` environments, never at repository level, and the host key is checked against the environment's `SSH_FINGERPRINT`.
- Workflow changes must preserve least-privilege permissions and must not print secrets.
- Release automation must follow `../docs/GIT_FLOW.md`: release branch to `main`, version/tag validation, then back-merge to `develop`.
