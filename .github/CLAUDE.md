# .github

- Pull requests into `develop` and `main` must run policy, check, build, and test gates.
- Pushes to `develop` run verification only. Production deployment is allowed only for a successful push to `main`.
- Keep deploy jobs dependent on every required verification job and keep production deploys serialized.
- Workflow changes must preserve least-privilege permissions and must not print secrets.
- Release automation must follow `../docs/GIT_FLOW.md`: release branch to `main`, version/tag validation, then back-merge to `develop`.
