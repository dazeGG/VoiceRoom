# Widget deployment implementation status

Remote deployment requires Python 3 in addition to the existing Bash, Docker,
Git, flock and PostgreSQL client in the database container. The deployment
checks `python3` before changing the checkout or environment and never installs
host packages automatically.

`scripts/cd/widget-boundary-preflight.py` is pinned under the deployment backup
directory before checkout changes. Its database query reads the monotonic
`widget_boundary_activation.widget_boundary_required` floor. Database failure,
missing floor rows or malformed output refuse transition. A legacy schema is
accepted only when neither widget schema nor activation table is present.

Once activated, candidate and automatic rollback API/worker/web images must all
have immutable repository digests listed in the host-owned
`deploy-backups/ci/widget-release-capabilities.json`:

```json
{
  "releases": {
    "registry.example/voiceroom-api@sha256:<64 lowercase hex digits>": ["widget-boundary-v1"]
  }
}
```

Each image needs its own entry. The API Docker target declares
`org.voiceroom.capabilities=widget-boundary-v1`, inherited by the worker target;
the web target declares the same capability. The ordinary release pipeline
builds those targets. Deployment pins `widget-release-capabilities.py` from the
candidate release, inspects the pulled candidate and rollback images and writes
this digest-bound manifest. Missing labels never imply compatibility. Release
tests and reviews must support the declaration; the label alone is not a
security audit or deployment authorization.

Tags or environment variables alone are not
compatibility evidence. The manifest is release evidence, not an authorization
capability. The helper rechecks the persisted floor in the ERR trap before
restoring checkout, environment or containers.

## Second-stage activation and recovery

First deploy the boundary release with admission off. Keep a second compatible
release as the rollback checkpoint before activation. Then explicitly run:

```sh
bash scripts/cd/activate-widget.sh /srv/voiceroom /srv/voiceroom/deploy-backups/ci/env-COMPATIBLE-CHECKPOINT
```

This operation holds the deployment locks, verifies both releases' six image
digests, checks that API/gate/all five workers/web actually run the current
expected image IDs, and acquires the recovery advisory lock while atomically
persisting the monotonic floor and admission enablement. It then enables the
environment flag and recreates the compatible stack. A flag alone cannot
activate the database. No public launch is authorized by this command; browser,
capacity and legal release obligations remain separate.

Widget activation and recovery support exactly one serving Compose API and one
serving Compose gate. Multiple or missing API/gate containers are refused; this
is not a distributed widget deployment protocol. Before activation, the local
operator must prove both live owners quiescent at the same persisted recovery
generation. The final transaction verifies their exact owner UUIDs, generation
acknowledgements and exclusive PostgreSQL session advisory locks (namespace
870113, role keys 1 and 2) in this database before enabling admission. Worker
image checks remain independent of those two widget runtime owners.

ERR rollback after activation first invokes the local API operator script
`apps/api/src/scripts/widget-recovery.ts recover` and `verify-disabled`. Both
must return verified admission-disable, credential-revocation and empty widget
media and API occupancy proofs, plus matching API/gate quiescence, owner UUIDs
and recovery generation. The `recover` and `verify-disabled` receipts must agree;
missing fields or changed generation/owner identities refuse restoration. A
final database fence rechecks the acknowledged generation and live owner locks
after both receipts. Only then may environment/checkout/containers be restored to the
validated compatible target, with `WIDGET_ENABLED=false` forced in the restored
environment. Failed recovery leaves the last stack in place and reports
operator repair; it never claims successful termination. The persisted floor
is retained even when widget rows are removed. The operator script has no
public HTTP endpoint. API/gate/SFU or database unavailability fails closed.

Activation failure similarly forces the flag off and attempts verified
recovery. A failed recovery is explicitly unproven, not a success.

`npm test` includes the Linux wrapper for nineteen Python regressions. On Windows the
wrapper skips; the same suite can run in a disposable Linux container with
Python 3, Bash, coreutils, findutils and util-linux. Tests exercise the actual
remote-deploy ERR trap with fake Docker/Git commands, not production services.
