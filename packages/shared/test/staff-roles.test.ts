// What each staff role may do: a moderator reviews and blocks for a while, an
// administrator also sees the numbers and where people came from, and only a
// superadmin gives roles. Nobody else may do anything.

import test from 'node:test';
import assert from 'node:assert/strict';
import { Value } from 'typebox/value';
import {
  isStaffRole,
  roleAllows,
  roleRank,
  STAFF_PERMISSIONS,
  STAFF_ROLES,
  StaffPermissionSchema,
  StaffRoleSchema
} from '../src/contracts/staff.ts';

test('each role may do what its rank brings, and more rank never takes anything away', () => {
  assert.equal(roleAllows('moderator', 'reports.review'), true);
  assert.equal(roleAllows('moderator', 'accounts.moderate'), true);
  assert.equal(roleAllows('moderator', 'origin.view'), false);
  assert.equal(roleAllows('moderator', 'stats.view'), false);
  assert.equal(roleAllows('admin', 'origin.view'), true);
  assert.equal(roleAllows('admin', 'accounts.manage'), true);
  assert.equal(roleAllows('admin', 'staff.manage'), false);
  for (const permission of STAFF_PERMISSIONS) {
    assert.equal(roleAllows('superadmin', permission), true, permission);
    assert.equal(roleAllows(null, permission), false, permission);
    if (roleAllows('moderator', permission)) assert.equal(roleAllows('admin', permission), true, permission);
  }
  assert.ok(roleRank('moderator') < roleRank('admin') && roleRank('admin') < roleRank('superadmin'));
});

test('only the three roles are roles', () => {
  for (const role of ['moderator', 'admin', 'superadmin']) assert.equal(isStaffRole(role), true);
  for (const value of ['owner', '', null, 1]) assert.equal(isStaffRole(value), false);
});

test('the role and permission schemas accept exactly the listed values', () => {
  for (const role of STAFF_ROLES) assert.equal(Value.Check(StaffRoleSchema, role), true, role);
  for (const permission of STAFF_PERMISSIONS) assert.equal(Value.Check(StaffPermissionSchema, permission), true);
  assert.equal(Value.Check(StaffRoleSchema, 'owner'), false);
  assert.equal(Value.Check(StaffPermissionSchema, 'rooms.manage'), false);
});
