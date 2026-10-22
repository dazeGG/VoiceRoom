// The rooms with someone in voice now, a row each: the room, who is in it,
// how long it has gone on, its owner and what is going on (screens shown,
// microphones and sound off, the kinds of client). A row opens the list of
// its people; the clock button narrows the call history to the room.

import { ChevronDown, ChevronRight, HeadphoneOff, History, MicOff, MonitorUp } from 'lucide-react';
import type { LiveRoom, LiveRoomPeer } from '@voice-room/shared/contracts/admin';
import { formatPeople, formatSince } from '../../format.ts';
import { Avatar, AvatarStack, Pill } from '../../ui/index.tsx';
import { AccountName, ClientIcon, Origin, RoomTitle } from './room-bits.tsx';

const COLUMNS = '28px minmax(220px, 1.6fr) minmax(200px, 1.2fr) 110px minmax(130px, 0.9fr) minmax(170px, 1fr) 36px';
const PEER_COLUMNS = 'minmax(200px, 1.2fr) minmax(240px, 1.6fr) minmax(150px, 0.9fr) 90px';

/** Under a minute reads as just now, not as "0 мин". */
const since = (at: number, now: number) => (now - at < 60_000 ? 'только что' : formatSince(at, now));

function Summary({ peers }: { peers: readonly LiveRoomPeer[] }) {
  const screens = peers.filter((peer) => peer.screen).length;
  const muted = peers.filter((peer) => peer.muted).length;
  const deafened = peers.filter((peer) => peer.deafened).length;
  const clients = [...new Set(peers.map((peer) => peer.client).filter((client) => client !== null))];
  return (
    <span className="live-summary">
      {screens ? (
        <span
          className="live-chip"
          data-tone="accent"
          title="Показывают экран"
          aria-label={`показывают экран: ${screens}`}
        >
          <MonitorUp size={14} aria-hidden="true" />
          {screens}
        </span>
      ) : null}
      {muted ? (
        <span className="live-chip" data-tone="danger" title="Без микрофона" aria-label={`без микрофона: ${muted}`}>
          <MicOff size={14} aria-hidden="true" />
          {muted}
        </span>
      ) : null}
      {deafened ? (
        <span className="live-chip" data-tone="danger" title="Без звука" aria-label={`без звука: ${deafened}`}>
          <HeadphoneOff size={14} aria-hidden="true" />
          {deafened}
        </span>
      ) : null}
      {clients.map((client) => (
        <ClientIcon key={client} client={client} />
      ))}
    </span>
  );
}

function PeerRow({
  peer,
  now,
  onOpenAccount
}: {
  peer: LiveRoomPeer;
  now: number;
  onOpenAccount: (accountId: string) => void;
}) {
  return (
    <li className="live-peer" style={{ '--cols': PEER_COLUMNS }}>
      <span className="live-peer-who">
        <Avatar
          name={peer.name}
          src={peer.account?.avatarUrl ?? null}
          colorKey={peer.account?.avatarColorKey ?? peer.avatarColorKey}
          background={peer.account?.avatarAccent ?? null}
          size={28}
        />
        {peer.account ? (
          <AccountName account={peer.account} onOpen={onOpenAccount} />
        ) : (
          <>
            <span className="rooms-guest">{peer.name}</span>
            <Pill compact>гость</Pill>
          </>
        )}
      </span>
      <span className="live-peer-origin">
        {/* A role that may not see the origin still learns the kind of client. */}
        <Origin seat={peer} />
        {!peer.os && !peer.browser && !peer.location && !peer.ipKey && !peer.guestId ? (
          <ClientIcon client={peer.client} size={14} />
        ) : null}
      </span>
      <span className="live-peer-state">
        {peer.screen ? (
          <Pill tone="accent" compact>
            экран
          </Pill>
        ) : null}
        {peer.muted ? <span className="live-word">без микрофона</span> : null}
        {peer.deafened ? <span className="live-word">без звука</span> : null}
      </span>
      <span className="ui-cell-end ui-num live-peer-time">{peer.joinedAt ? since(peer.joinedAt, now) : ''}</span>
    </li>
  );
}

export function LiveCalls({
  rooms,
  now,
  open,
  onToggle,
  onShowHistory,
  onOpenAccount
}: {
  rooms: readonly LiveRoom[];
  now: number;
  open: ReadonlySet<string>;
  onToggle: (roomId: string) => void;
  onShowHistory: (room: LiveRoom) => void;
  onOpenAccount: (accountId: string) => void;
}) {
  return (
    <div className="ui-table-scroll">
      <div className="ui-table" style={{ '--table-min': '940px' }}>
        <div className="ui-tr ui-thead" style={{ '--cols': COLUMNS }} aria-hidden="true">
          <span />
          <span>Комната</span>
          <span>Участники</span>
          <span>Идёт</span>
          <span>Владелец</span>
          <span>Сейчас</span>
          <span />
        </div>
        <ul className="live-rooms" aria-label="Сейчас в звонках">
          {rooms.map((room) => {
            const expanded = open.has(room.roomId);
            const Chevron = expanded ? ChevronDown : ChevronRight;
            const peersId = `live-peers-${room.roomId}`;
            return (
              <li key={room.roomId} className="live-room" data-open={expanded}>
                {/* The whole row opens the people; the chevron is the control for the keyboard. */}
                <div
                  className="ui-tr ui-row-link live-room-row"
                  style={{ '--cols': COLUMNS }}
                  onClick={() => onToggle(room.roomId)}
                >
                  <button
                    type="button"
                    className="live-toggle"
                    aria-expanded={expanded}
                    aria-controls={peersId}
                    aria-label={`Участники: ${room.name}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      onToggle(room.roomId);
                    }}
                  >
                    <Chevron size={16} aria-hidden="true" />
                  </button>
                  <RoomTitle
                    roomId={room.roomId}
                    name={room.name}
                    isStatic={room.isStatic}
                    avatarUrl={room.avatarUrl}
                  />
                  <span className="live-people">
                    <AvatarStack
                      people={room.peers.map((peer) => ({
                        key: peer.peerId,
                        name: peer.name,
                        src: peer.account?.avatarUrl ?? null,
                        colorKey: peer.account?.avatarColorKey ?? peer.avatarColorKey,
                        background: peer.account?.avatarAccent ?? null
                      }))}
                    />
                    <span className="live-count">{formatPeople(room.peers.length)}</span>
                  </span>
                  <span className="live-since ui-num">{room.since ? since(room.since, now) : '—'}</span>
                  <span>
                    {room.owner ? (
                      <AccountName account={room.owner} onOpen={onOpenAccount} loginOnly />
                    ) : (
                      <span className="rooms-quiet">без владельца</span>
                    )}
                  </span>
                  <Summary peers={room.peers} />
                  <button
                    type="button"
                    className="live-history"
                    aria-label={`История звонков: ${room.name}`}
                    title="Показать историю звонков этой комнаты"
                    onClick={(event) => {
                      event.stopPropagation();
                      onShowHistory(room);
                    }}
                  >
                    <History size={16} aria-hidden="true" />
                  </button>
                </div>
                {expanded ? (
                  <ul id={peersId} className="live-peers" aria-label={`В звонке: ${room.name}`}>
                    {room.peers.map((peer) => (
                      <PeerRow key={peer.peerId} peer={peer} now={now} onOpenAccount={onOpenAccount} />
                    ))}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
