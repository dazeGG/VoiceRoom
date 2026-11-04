# .github

- Pull requests into `develop` and `main` must run policy, check, build, and test gates.
- `ci.yml` verifies pull requests and pushes to `develop`, then publishes images and deploys dev. `release.yml` publishes images for `main` and `v*` tags without verifying again, relying on branch protection for `main`. Keep the verification jobs out of `release.yml`: a skipped job counts as passed for that protection.
- A push to `develop` deploys dev; a `v*` tag on `main` deploys production straight away (the `production` environment only restricts deploys to `v*` tags; it has no required reviewer). Keep both behind `deploy.yml`, serialized per environment.
- Deploy credentials live in the `dev` and `production` environments, never at repository level, and the host key is checked against the environment's `SSH_FINGERPRINT`.
- Workflow changes must preserve least-privilege permissions and must not print secrets.
- Release automation must follow `../docs/GIT_FLOW.md`: release branch to `main`, version/tag validation, then back-merge to `develop`.
