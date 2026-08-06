import {expect,test} from '@playwright/test';import {readFileSync} from 'node:fs';
const prefs=readFileSync(new URL('../src/lib/shared/notifications/preferences.svelte.ts',import.meta.url),'utf8');const api=readFileSync(new URL('../src/lib/api/notifications.ts',import.meta.url),'utf8');
test('G62-A01 room policy API exposes all mentions none',async()=>{expect(api).toContain("'all' | 'mentions' | 'none'");expect(api).toContain('setRoomNotificationLevel');});
test('G62-A02 settings retain server reconciliation and explicit privacy/DND state',async()=>{expect(prefs).toContain('applyRealtimeNotificationPreferences');expect(prefs).toContain('privateNotifications');expect(prefs).toContain('doNotDisturb');});
