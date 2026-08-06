'use strict';

const { transaction } = require('../../lib/db');
const { buildNotificationEnvelope, buildProviderPayload, normalizeNotificationLevel, normalizeNotificationLimit } = require('@voice-room/shared/notifications');

function createNotificationService({ pool, inbox, mentions, eligibility, outbox, cursorCodec, notificationStore } = {}) {
  if (!pool?.query || !inbox) throw new TypeError('Notification service requires pool and inbox repository');
  const encode=(item)=>cursorCodec?.encode({purpose:'notification-inbox',context:item.recipientUserId,tuple:item.cursorTuple});

  async function list({ userId, cursor, limit }={}) {
    const pageSize=normalizeNotificationLimit(limit);
    const before=cursor ? cursorCodec.decode(cursor,{purpose:'notification-inbox',context:userId}) : null;
    const [rows,unread,firstUnread]=await Promise.all([inbox.list({recipientUserId:userId,limit:pageSize,before}),inbox.unreadCount(userId),inbox.findFirstUnread?.(userId)]);
    const hasMore=rows.length>pageSize; const visible=hasMore?rows.slice(0,pageSize):rows;
    const items=visible.map((row)=>({...row,cursor:encode(row),body:row.retractedAt?'':row.body}));
    return buildNotificationEnvelope({notifications:items,nextCursor:hasMore?encode(visible.at(-1)):undefined,hasMore,unreadCount:unread.count,revision:unread.revision,firstUnread:firstUnread?{...firstUnread,cursor:encode(firstUnread)}:null});
  }
  async function count(userId){return inbox.unreadCount(userId);}
  async function markRead({userId,notificationId}){const item=await inbox.markRead({recipientUserId:userId,notificationId});if(!item)return {ok:false,code:'not_found'};const unread=await inbox.unreadCount(userId);return {ok:true,notification:item,unreadCount:unread.count,revision:unread.revision};}
  async function markAllRead({userId,through}){const result=await inbox.markAllRead({recipientUserId:userId,through});const unread=await inbox.unreadCount(userId);return {ok:true,updated:typeof result==='number'?result:result.updated,unreadCount:unread.count,revision:Math.max(unread.revision,Number(result?.revision)||0)};}
  async function resync(userId){const unread=await inbox.unreadCount(userId);return {ok:true,unreadCount:unread.count,revision:unread.revision};}
  async function createAddressedForMessage({roomId,messageId,creatorUserId,targetUserIds=[],replyTargetUserId=null,body='',client}={}) {
    const run=async(db)=>{
      const eligible=await eligibility.validate({roomId,creatorUserId,targetUserIds,client:db});
      await mentions.replaceForMessage({roomId,messageId,creatorUserId,targetUserIds:eligible,client:db});
      const recipientReasons=new Map();
      for(const userId of eligible) recipientReasons.set(userId,new Set(['mention']));
      if(replyTargetUserId && replyTargetUserId!==creatorUserId){const reasons=recipientReasons.get(replyTargetUserId)||new Set();reasons.add('reply');recipientReasons.set(replyTargetUserId,reasons);}
      const created=[];
      for(const [recipientUserId,reasons] of recipientReasons){const item=await inbox.upsert({recipientUserId,actorUserId:creatorUserId,roomId,sourceMessageId:messageId,reasons:[...reasons],body,client:db});const payload=buildProviderPayload(item);await outbox.enqueue({notificationId:item.id,recipientUserId,revision:item.revision,payload,client:db});created.push(item);}
      return created;
    };
    return client ? run(client) : transaction(pool,run);
  }
  async function getRoomLevel({userId,roomId}){if(notificationStore?.getRoomLevel)return notificationStore.getRoomLevel({userId,roomId});const prefs=await notificationStore?.getPreferences?.(userId);if(prefs?.roomLevels?.[roomId])return prefs.roomLevels[roomId];return prefs?.mutedRoomIds?.includes(roomId)?'none':'mentions';}
  async function setRoomLevel({userId,roomId,level}){const normalized=normalizeNotificationLevel(level,'');if(!normalized) return {ok:false,code:'invalid_level'};if(notificationStore?.setRoomLevel)return notificationStore.setRoomLevel({userId,roomId,level:normalized});return {ok:false,code:'not_supported'};}
  return { count,createAddressedForMessage,getRoomLevel,list,markAllRead,markRead,resync,setRoomLevel };
}

module.exports={createNotificationService};
