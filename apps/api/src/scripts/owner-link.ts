#!/usr/bin/env node
import { readPersonalOwnerConfig } from '../app/config.ts';
import { createOwnerCapability } from '../domains/rooms/meet-owner.service.ts';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && args[0] !== '--rotate')) {
    process.stderr.write('Usage: node apps/api/src/scripts/owner-link.ts [--rotate]\n');
    process.exitCode = 1;
    return;
  }
  const { origin, ownerFile } = readPersonalOwnerConfig();
  const link = await createOwnerCapability(ownerFile).printLink({ origin, rotate: args[0] === '--rotate' });
  if (!link) {
    process.stderr.write('The owner link was used. Pass --rotate to issue a fresh link and revoke earlier access.\n');
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`${link}\n`);
}

main().catch(() => {
  process.stderr.write('Unable to print owner link. Check PERSONAL_ORIGIN and the writable owner volume.\n');
  process.exitCode = 1;
});
