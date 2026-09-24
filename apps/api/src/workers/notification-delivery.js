import { createDbPool } from '../lib/db.js';
import { readEnvBool, readEnvInt } from '../lib/config.js';
import { createPushStore } from '../lib/push-store.js';
import { createNotificationOutboxRepository } from '../domains/notifications/notification-outbox-repository.ts';
import { createNotificationPushProvider } from '../domains/notifications/push-provider.ts';
import { boundedBackoff, createLeaseRuntime } from '../platform/lease-runtime.ts';
import { recordNotificationOldestPending } from '../lib/metrics.js';
import { LOG_EVENTS } from '../lib/log-events.js';
import { createLogger } from '../lib/logger.js';

const LEASE_IDENTITY = 'notification-delivery.G63';

function wait(ms, signal) { return new Promise((resolve,reject)=>{ if(signal.aborted) return reject(signal.reason); const timer=setTimeout(done,ms); function done(){signal.removeEventListener('abort',cancel);resolve();} function cancel(){clearTimeout(timer);reject(signal.reason);}; signal.addEventListener('abort',cancel,{once:true}); }); }

function createNotificationDeliveryWorker({ outbox, provider, batchSize=50, leaseMs=120000, renewMs=30000, idleMs=250, maxAttempts=8, logger=createLogger({ name: 'worker.notification-delivery' }), observeOldestPending=recordNotificationOldestPending }={}) {
  if (!outbox || !provider) throw new TypeError('Notification outbox and provider are required');
  let disabledReason = '';
  const outcomes = [];
  function observe(ok) {
    const cutoff=Date.now()-600000; outcomes.push({at:Date.now(),ok}); while(outcomes[0]?.at<cutoff)outcomes.shift();
    const failures=outcomes.filter((item)=>!item.ok).length;
    if(failures>=10 || (outcomes.length>=100 && failures/outcomes.length>.05)) disabledReason='provider_failure_threshold';
  }
  async function processLease(guard) {
    const lease={identity:LEASE_IDENTITY,ownerId:guard.lease.ownerId,fencingToken:guard.lease.fencingToken};
    await outbox.recordHeartbeat({...lease,ready:true});
    while(guard.isOwned()) {
      guard.assertOwned();
      observeOldestPending(await outbox.oldestPendingAgeMs());
      if(disabledReason){await outbox.recordHeartbeat({...lease,ready:false});await wait(idleMs,guard.signal);continue;}
      const jobs=await outbox.claimBatch({...lease,limit:batchSize,staleClaimMs:leaseMs});
      if(!jobs.length){await wait(idleMs,guard.signal);continue;}
      for(const job of jobs){
        guard.assertOwned();
        try {
          const ageMs=Date.now()-new Date(job.createdAt).getTime();
          if(ageMs>15*60*1000){disabledReason='oldest_pending_exceeded';await outbox.reschedule(job.eventId,lease,{delayMs:60000,error:new Error(disabledReason),maxAttempts});continue;}
          if(ageMs>5*60*1000)logger.warn({evt:LOG_EVENTS.NOTIFICATION_BACKLOG_AGED,eventId:job.eventId,ageMs},'notification outbox age exceeds five minutes');
          const current=await outbox.loadCurrent(job);
          const reasons=current?.reasons||[];
          const addressed=reasons.includes('mention')||reasons.includes('reply');
          const suppressed=!current || current.retracted_at || current.dnd || current.level==='none' || (current.level==='mentions' && !addressed);
          if(suppressed){await outbox.markSuppressed(job.eventId,lease);observe(true);continue;}
          const result=await provider.deliver({...job,payload:{...job.payload,body:current.private_notifications?'Откройте VoiceRoom, чтобы посмотреть уведомление.':job.payload?.body}});
          guard.assertOwned();
          if(result?.suppressed) await outbox.markSuppressed(job.eventId,lease); else await outbox.markDelivered(job.eventId,lease);
          observe(true);
        } catch(error) {
          guard.assertOwned();
          await outbox.reschedule(job.eventId,lease,{delayMs:boundedBackoff(job.attempts,{baseMs:5000,maxMs:3600000,jitter:.2}),error,maxAttempts});
          observe(false);
          logger.warn({evt:LOG_EVENTS.NOTIFICATION_DELIVERY_FAILED,eventId:job.eventId,attempt:job.attempts,maxAttempts,err:error},'notification delivery attempt failed');
        }
      }
    }
  }
  const runtime=createLeaseRuntime({identity:LEASE_IDENTITY,leaseMs,renewMs,idleMs,logger,acquire:(x)=>outbox.acquireLease(x),renew:(x)=>outbox.renewLease(x),release:(x)=>outbox.releaseLease(x),run:processLease,onHeartbeat:(x)=>{void outbox.recordHeartbeat(x).catch(()=>{});}});
  return Object.freeze({identity:LEASE_IDENTITY,get activeLease(){return runtime.activeLease;},get disabledReason(){return disabledReason;},start:()=>runtime.start(),stop:()=>runtime.stop()});
}

async function main(env=process.env){
  if(!readEnvBool('NOTIFICATION_DELIVERY_CLAIM_ENABLED',false,env)){createLogger({env,name:'worker.notification-delivery'}).info({evt:LOG_EVENTS.WORKER_DISABLED,worker:'notification-delivery',reason:'claims_disabled'},'notification delivery claims are disabled');return;}
  const pool=createDbPool(); const outbox=createNotificationOutboxRepository({pool}); const store=createPushStore({pool}); const provider=createNotificationPushProvider({store,env});
  const worker=createNotificationDeliveryWorker({outbox,provider,batchSize:readEnvInt('NOTIFICATION_DELIVERY_BATCH_SIZE',50,1,env),leaseMs:readEnvInt('NOTIFICATION_DELIVERY_LEASE_MS',120000,1000,env),renewMs:readEnvInt('NOTIFICATION_DELIVERY_RENEW_MS',30000,100,env),maxAttempts:readEnvInt('NOTIFICATION_DELIVERY_MAX_ATTEMPTS',8,1,env)});
  let stopping; const stop=()=>stopping||(stopping=worker.stop().finally(()=>pool.end())); process.once('SIGINT',()=>void stop());process.once('SIGTERM',()=>void stop()); try{await worker.start();}finally{await stop();}
}

if(import.meta.main) main().catch((error)=>{createLogger({name:'worker.notification-delivery'}).fatal({evt:LOG_EVENTS.WORKER_FAILED,worker:'notification-delivery',err:error},'notification delivery worker failed');process.exitCode=1;});
export { LEASE_IDENTITY, createNotificationDeliveryWorker, main };
