// web-push ships no types; this covers the two calls push-service.ts makes.
declare module 'web-push' {
  type PushSubscription = { endpoint: string; keys: { p256dh: string; auth: string } };
  const webPush: {
    setVapidDetails(subject: string, publicKey: string, privateKey: string): void;
    sendNotification(subscription: PushSubscription, payload: string, options?: { TTL: number }): Promise<unknown>;
  };
  export default webPush;
}
