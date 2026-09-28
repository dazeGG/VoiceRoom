// `/api/livekit-token` only admits peers the room roster already knows (the
// realtime join puts them there). Tests that drive the token route through
// app.inject() have no realtime connection, so they report the peer from the
// store instead: the API merges store-side peers into its presence roster.
function withRosterPeer<Store extends { getRoom?: (roomId: string) => unknown }>(
  store: Store,
  peer: { id: string; [key: string]: unknown }
): Store {
  const getRoom = store.getRoom?.bind(store);
  return Object.assign(store, {
    async getRoom(roomId: string) {
      const room = (await getRoom?.(roomId)) as { peers?: Map<string, unknown> } | null | undefined;
      if (room) room.peers = new Map([[peer.id, { name: '', ...peer }]]);
      return room;
    }
  });
}

export { withRosterPeer };
