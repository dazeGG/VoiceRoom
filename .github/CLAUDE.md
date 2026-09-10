# .github

- Pull requests into `develop` and `main` must run policy, check, build, and test gates.
- Pushes to `develop` and `main` run verification only; no workflow deploys. Dev and production are rolled out by hand (see `../README.md`).
- If a deploy job is ever added, make it depend on every required verification job and keep production deploys serialized.
- Workflow changes must preserve least-privilege permissions and must not print secrets.
- Release automation must follow `../docs/GIT_FLOW.md`: release branch to `main`, version/tag validation, then back-merge to `develop`.
