// `/api/livekit-token` only admits peers the room roster already knows (the
// realtime join puts them there). Tests that drive the token route through
// app.inject() have no realtime connection, so they report the peer from the
// store instead: the API merges store-side peers into its presence roster.
function withRosterPeer(store: { getRoom(roomId: string): Promise<any> }, peer: { id: string; [key: string]: unknown }) {
  const getRoom = store.getRoom.bind(store);
  store.getRoom = async (roomId: string) => {
    const room = await getRoom(roomId);
    if (room) room.peers = new Map([[peer.id, { name: '', ...peer }]]);
    return room;
  };
  return store;
}

export { withRosterPeer };
