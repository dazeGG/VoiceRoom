type KeyLister = { listAvatarKeys(): Promise<string[]> };

async function reconcileAvatarStorage({
  storage,
  userStore,
  roomStore
}: {
  storage: { listKeys(): Promise<string[]>; remove(key: string): Promise<unknown> };
  userStore: KeyLister;
  roomStore: KeyLister;
}): Promise<{ orphaned: string[]; removed: number }> {
  const [storedKeys, userKeys, roomKeys] = await Promise.all([
    storage.listKeys(),
    userStore.listAvatarKeys(),
    roomStore.listAvatarKeys()
  ]);
  const referenced = new Set([...userKeys, ...roomKeys]);
  const orphaned = storedKeys.filter((key) => !referenced.has(key));
  await Promise.all(orphaned.map((key) => storage.remove(key)));
  return { orphaned, removed: orphaned.length };
}

export { reconcileAvatarStorage };
