# .github

- Pull requests into `develop` and `main` must run policy, check, build, and test gates.
- `ci.yml` verifies pull requests and pushes to `develop`, then publishes and deploys to dev. Each `release-*.yml` workflow validates its own tag and relies on `main` branch protection for the repository checks.
- API and Web deploy through `deploy.yml`. Admin and Widget use `deploy-client.yml` and share the same environment rollout queue. Meet builds the personal bundle and publishes it as Latest.
- Deploy credentials live in the `dev` and `production` environments, never at repository level, and the host key is checked against the environment's `SSH_FINGERPRINT`.
- Workflow changes must preserve least-privilege permissions and must not print secrets.
- Release automation must follow `../docs/GIT_FLOW.md`: release branch to `main`, version/tag validation, then back-merge to `develop`.
