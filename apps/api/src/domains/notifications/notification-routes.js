'use strict';

function send(reply,status,payload){return reply.code(status).header?.('Cache-Control','no-store').send(payload) ?? reply.code(status).send(payload);}
function registerNotificationRoutes({app,service,resolveUser,enabled=()=>true}={}){
  if(!app||!service||typeof resolveUser!=='function')throw new TypeError('app, service and resolveUser are required');
  const auth=async(request,reply)=>{if(!await enabled(request)){send(reply,404,{ok:false,error:'Not found'});return null;}const user=await resolveUser(request);if(!user)send(reply,401,{ok:false,error:'Authentication required'});return user;};
  app.get('/api/notifications/inbox',async(request,reply)=>{const user=await auth(request,reply);if(!user)return;try{return send(reply,200,await service.list({userId:user.id,cursor:request.query?.cursor,limit:request.query?.limit}));}catch(error){if(error?.code==='invalid_cursor')return send(reply,400,{ok:false,code:'invalid_cursor'});throw error;}});
  app.get('/api/notifications/inbox/unread-count',async(request,reply)=>{const user=await auth(request,reply);if(!user)return;return send(reply,200,{ok:true,...await service.count(user.id)});});
  app.post('/api/notifications/inbox/:notificationId/read',async(request,reply)=>{const user=await auth(request,reply);if(!user)return;const result=await service.markRead({userId:user.id,notificationId:request.params.notificationId});return send(reply,result.ok?200:404,result);});
  app.post('/api/notifications/inbox/read-all',async(request,reply)=>{const user=await auth(request,reply);if(!user)return;return send(reply,200,await service.markAllRead({userId:user.id,through:request.body?.through||null}));});
  app.get('/api/notifications/inbox/resync',async(request,reply)=>{const user=await auth(request,reply);if(!user)return;return send(reply,200,await service.resync(user.id));});
  app.get('/api/notifications/room/:roomId/level',async(request,reply)=>{const user=await auth(request,reply);if(!user)return;return send(reply,200,{ok:true,level:await service.getRoomLevel({userId:user.id,roomId:request.params.roomId})});});
  app.put('/api/notifications/room/:roomId/level',async(request,reply)=>{const user=await auth(request,reply);if(!user)return;const result=await service.setRoomLevel({userId:user.id,roomId:request.params.roomId,level:request.body?.level});return send(reply,result.ok===false?400:200,result);});
}
module.exports={registerNotificationRoutes};
