'use strict';
const assert=require('node:assert/strict');const {Pool}=require('pg');const test=require('node:test');const {runMigrations}=require('../src/lib/migrate');const {createInboxRepository}=require('../src/domains/notifications/inbox-repository');const {createTestDatabase}=require('./db-harness');
test('G59-A01 100k inbox uses bounded cursor reads with zero writes and isolation', {skip:!process.env.TEST_DATABASE_URL,timeout:120000},async(t)=>{const db=await createTestDatabase(t);await runMigrations({databaseUrl:db.databaseUrl,logger:{log(){},info(){},warn(){},error(){}},noLock:true});const pool=new Pool({connectionString:db.databaseUrl,max:2});t.after(async()=>{await pool.end();await db.cleanup();});await pool.query(`INSERT INTO users(id,login,display_name,password_hash) VALUES ('actor','actor','Actor','x'),('recipient','recipient','Recipient','x'),('other','other','Other','x');INSERT INTO rooms(id,creator_ip) VALUES ('room','');INSERT INTO room_messages(id,room_id,text,created_at) SELECT 'm'||lpad(gs::text,63,'0'),'room','body',current_timestamp+(gs*interval '1 microsecond') FROM generate_series(1,100000) gs;INSERT INTO user_notifications(id,recipient_user_id,actor_user_id,room_id,source_message_id,reasons,revision,created_at,updated_at) SELECT 'n'||lpad(gs::text,35,'0'),'recipient','actor','room','m'||lpad(gs::text,63,'0'),ARRAY['mention'],gs,current_timestamp+(gs*interval '1 microsecond'),current_timestamp FROM generate_series(1,100000) gs`);const repo=createInboxRepository({pool});const before=(await pool.query(`SELECT max(updated_at) value FROM user_notifications`)).rows[0].value;const started=Date.now();const page=await repo.list({recipientUserId:'recipient',limit:100});assert.equal(page.length,101);assert.ok(Date.now()-started<750);assert.equal((await repo.list({recipientUserId:'other',limit:100})).length,0);const after=(await pool.query(`SELECT max(updated_at) value FROM user_notifications`)).rows[0].value;assert.equal(new Date(after).getTime(),new Date(before).getTime());});
test('G59-A02 read revision remains monotonic when highest unread is marked read', {skip:!process.env.TEST_DATABASE_URL},async(t)=>{const db=await createTestDatabase(t);await runMigrations({databaseUrl:db.databaseUrl,logger:{log(){},info(){},warn(){},error(){}},noLock:true});const pool=new Pool({connectionString:db.databaseUrl,max:2});t.after(async()=>{await pool.end();await db.cleanup();});await pool.query(`INSERT INTO users(id,login,display_name,password_hash) VALUES ('a','aa','A','x'),('r','rr','R','x');INSERT INTO rooms(id,creator_ip) VALUES ('room','');INSERT INTO room_messages(id,room_id,text) VALUES ('m','room','x');INSERT INTO user_notifications(id,recipient_user_id,actor_user_id,room_id,source_message_id,reasons,revision) VALUES ('n','r','a','room','m',ARRAY['mention'],7)`);const repo=createInboxRepository({pool});const before=await repo.unreadCount('r');await repo.markRead({recipientUserId:'r',notificationId:'n'});const after=await repo.unreadCount('r');assert.equal(before.revision,7);assert.ok(after.revision>before.revision);assert.equal(after.count,0);});

test('G59-A02 concurrent retract shares the account revision allocator with upsert and reads', {skip:!process.env.TEST_DATABASE_URL},async(t)=>{
  const db=await createTestDatabase(t);await runMigrations({databaseUrl:db.databaseUrl,logger:{log(){},info(){},warn(){},error(){}},noLock:true});const pool=new Pool({connectionString:db.databaseUrl,max:6});t.after(async()=>{await pool.end();await db.cleanup();});
  await pool.query(`
    INSERT INTO users(id,login,display_name,password_hash) VALUES ('actor','actor-race','Actor','x'),('r-upsert','r-upsert','Upsert','x'),('r-read','r-read','Read','x'),('r-all','r-all','All','x');
    INSERT INTO rooms(id,creator_ip) VALUES ('room','');
    INSERT INTO room_messages(id,room_id,text) VALUES ('m-upsert','room','x'),('m-read','room','x'),('m-all','room','x'),('m-all-2','room','x');
    INSERT INTO user_notifications(id,recipient_user_id,actor_user_id,room_id,source_message_id,reasons,body,revision) VALUES
      ('n-upsert','r-upsert','actor','room','m-upsert',ARRAY['mention'],'old',1),
      ('n-read','r-read','actor','room','m-read',ARRAY['mention'],'old',1),
      ('n-all','r-all','actor','room','m-all',ARRAY['mention'],'old',1),
      ('n-all-2','r-all','actor','room','m-all-2',ARRAY['mention'],'old',2)
  `);
  const repo=createInboxRepository({pool});
  const [upsertRetract,upsert]=await Promise.all([
    repo.retractByMessage('m-upsert'),
    repo.upsert({recipientUserId:'r-upsert',actorUserId:'actor',roomId:'room',sourceMessageId:'m-upsert',reasons:['mention'],body:'concurrent'})
  ]);
  assert.deepEqual([upsertRetract[0].revision,upsert.revision].sort((a,b)=>a-b),[2,3]);
  const later=await repo.upsert({recipientUserId:'r-upsert',actorUserId:'actor',roomId:'room',sourceMessageId:'m-upsert',reasons:['mention'],body:'later'});
  assert.equal(later.revision,4);assert.equal((await repo.unreadCount('r-upsert')).revision,4);
  const [readRetract,read]=await Promise.all([repo.retractByMessage('m-read'),repo.markRead({recipientUserId:'r-read',notificationId:'n-read'})]);
  assert.deepEqual([readRetract[0].revision,read.revision].sort((a,b)=>a-b),[2,3]);
  const [allRetract,readAll]=await Promise.all([repo.retractByMessage('m-all'),repo.markAllRead({recipientUserId:'r-all'})]);
  assert.deepEqual([allRetract[0].revision,readAll.revision].sort((a,b)=>a-b),[3,4]);assert.equal((await repo.unreadCount('r-all')).revision,4);
});
