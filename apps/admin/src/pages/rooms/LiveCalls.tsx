// The rooms with someone in voice now, a row each: the room, who is in it,
// how long it has gone on, its owner and what is going on (screens shown,
// cameras, the kinds of client). A row opens the list of its people: who,
// how their voice goes and where they came from, whose ip· and # narrow the
// call history; the clock button narrows the history to the room and the
// arrow opens the call's page.

import { ArrowUpRight, ChevronDown, ChevronRight, History, MonitorUp, Video } from 'lucide-react';
import type { LiveRoom, LiveRoomPeer } from '@voice-room/shared/contracts/admin';
import type { OriginPick } from './CallFilters.tsx';
import { formatPeople, formatSince } from '../../format.ts';
import { Avatar, AvatarStack, Pill, type Tone } from '../../ui/index.tsx';
import { AccountName, ClientIcon, Origin, RoomTitle, sharedIpKeys } from './room-bits.tsx';
import { CAUSE_LABELS, NETWORK_LABELS } from './network-bar.tsx';

const COLUMNS = '28px minmax(220px, 1.6fr) minmax(200px, 1.2fr) 110px minmax(130px, 0.9fr) minmax(200px, 1.1fr) 76px';
/** Without the owner's column, for rooms nobody owns. */
const UNOWNED_COLUMNS = '28px minmax(200px, 1.3fr) minmax(200px, 1.2fr) 110px minmax(200px, 1.1fr) 76px';
const PEER_COLUMNS = 'minmax(210px, 1.2fr) minmax(190px, 1fr) minmax(250px, 1.4fr) 84px';

/** Under a minute reads as just now, not as "0 мин". */
const since = (at: number, now: number) => (now - at < 60_000 ? 'только что' : formatSince(at, now));

/** How many in a room have a voice worse than the norm, in the tone of the worst; null when nobody has. */
export function troubleOf(peers: readonly LiveRoomPeer[]): { count: number; tone: Tone } | null {
  const bad = peers.filter((peer) => peer.network === 'bad').length;
  const unstable = peers.filter((peer) => peer.network === 'unstable').length;
  if (!bad && !unstable) return null;
  return { count: bad + unstable, tone: bad ? 'danger' : 'warning' };
}

function Summary({ peers }: { peers: readonly LiveRoomPeer[] }) {
  const trouble = troubleOf(peers);
  const screens = peers.filter((peer) => peer.screen).length;
  const cameras = peers.filter((peer) => peer.camera).length;
  const clients = [...new Set(peers.map((peer) => peer.client).filter((client) => client !== null))];
  return (
    <span className="live-summary">
      {trouble ? (
        <Pill tone={trouble.tone} dot compact>
          {`${trouble.count} со связью`}
        </Pill>
      ) : null}
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
      {cameras ? (
        <span className="live-chip" data-tone="accent" title="С камерой" aria-label={`с камерой: ${cameras}`}>
          <Video size={14} aria-hidden="true" />
          {cameras}
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
  onOpenAccount,
  pick,
  shared
}: {
  peer: LiveRoomPeer;
  now: number;
  onOpenAccount: (accountId: string) => void;
  pick?: OriginPick | undefined;
  shared: boolean;
}) {
  const net = peer.network ?? 'unknown';
  const overloaded = peer.cpuPressure === 'critical';
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
        <span className="live-peer-name">
          <span className="live-peer-name-line">
            {peer.account ? (
              <AccountName account={peer.account} onOpen={onOpenAccount} />
            ) : (
              <>
                <span className="rooms-guest">{peer.name}</span>
                <Pill compact>гость</Pill>
              </>
            )}
          </span>
          {peer.screen || peer.camera ? (
            <span className="live-peer-media">
              {peer.screen ? (
                <span className="live-chip" title="Показывает экран">
                  <MonitorUp size={13} aria-hidden="true" />
                  экран
                </span>
              ) : null}
              {peer.camera ? (
                <span className="live-chip" title="Камера включена">
                  <Video size={13} aria-hidden="true" />
                  камера
                </span>
              ) : null}
            </span>
          ) : null}
        </span>
      </span>
      <span className="live-voice">
        <span className="live-voice-level" data-net={net}>
          <span className="net-dot" data-net={net} aria-hidden="true" />
          {peer.network ? NETWORK_LABELS[peer.network] : 'нет данных'}
        </span>
        {peer.cause ? <span className="live-voice-cause">{CAUSE_LABELS[peer.cause]}</span> : null}
        {overloaded || peer.relieved ? (
          <span className="live-voice-flags">
            {overloaded ? (
              <Pill tone="danger" compact>
                система загружена
              </Pill>
            ) : null}
            {peer.relieved ? (
              <Pill tone="info" compact>
                облегчённый шумодав
              </Pill>
            ) : null}
          </span>
        ) : null}
      </span>
      <span className="live-peer-origin">
        <Origin seat={peer} pick={pick} shared={shared} />
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
  onOpenCall,
  onOpenAccount,
  pick,
  showOwner = true,
  label = 'Сейчас в звонках'
}: {
  rooms: readonly LiveRoom[];
  now: number;
  open: ReadonlySet<string>;
  onToggle: (roomId: string) => void;
  /** Narrows the call history to the room; without it the row has no such button. */
  onShowHistory?: ((room: LiveRoom) => void) | undefined;
  onOpenCall: (room: LiveRoom) => void;
  onOpenAccount: (accountId: string) => void;
  /** The call history's filters, toggled by each participant's ip· and #. */
  pick?: OriginPick | undefined;
  /** Rooms nobody owns (the widget rooms) leave the owner's column out. */
  showOwner?: boolean;
  label?: string;
}) {
  const columns = showOwner ? COLUMNS : UNOWNED_COLUMNS;
  return (
    <div className="ui-table-scroll">
      <div className="ui-table" style={{ '--table-min': showOwner ? '980px' : '900px' }}>
        <div className="ui-tr ui-thead" style={{ '--cols': columns }} aria-hidden="true">
          <span />
          <span>Комната</span>
          <span>Участники</span>
          <span>Идёт</span>
          {showOwner ? <span>Владелец</span> : null}
          <span>Сейчас</span>
          <span />
        </div>
        <ul className="live-rooms" aria-label={label}>
          {rooms.map((room) => {
            const expanded = open.has(room.roomId);
            const Chevron = expanded ? ChevronDown : ChevronRight;
            const peersId = `live-peers-${room.roomId}`;
            const shared = sharedIpKeys(room.peers.map((peer) => ({ key: peer.peerId, ipKey: peer.ipKey })));
            return (
              <li key={room.roomId} className="live-room" data-open={expanded}>
                {/* The whole row opens the people; the chevron is the control for the keyboard. */}
                <div
                  className="ui-tr ui-row-link live-room-row"
                  style={{ '--cols': columns }}
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
                    kind={room.kind}
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
                  {showOwner ? (
                    <span>
                      {room.owner ? (
                        <AccountName account={room.owner} onOpen={onOpenAccount} loginOnly />
                      ) : (
                        <span className="rooms-quiet">без владельца</span>
                      )}
                    </span>
                  ) : null}
                  <Summary peers={room.peers} />
                  <span className="live-actions">
                    {onShowHistory ? (
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
                    ) : null}
                    <button
                      type="button"
                      className="live-history"
                      aria-label={`Подробно о звонке: ${room.name}`}
                      title="Подробно о звонке"
                      onClick={(event) => {
                        event.stopPropagation();
                        onOpenCall(room);
                      }}
                    >
                      <ArrowUpRight size={16} aria-hidden="true" />
                    </button>
                  </span>
                </div>
                {expanded ? (
                  <div id={peersId} className="live-peers">
                    <div className="live-peers-head" style={{ '--cols': PEER_COLUMNS }} aria-hidden="true">
                      <span>Кто</span>
                      <span>Голос</span>
                      <span>Откуда</span>
                      <span className="ui-cell-end">В звонке</span>
                    </div>
                    <ul className="live-peers-list" aria-label={`В звонке: ${room.name}`}>
                      {room.peers.map((peer) => (
                        <PeerRow
                          key={peer.peerId}
                          peer={peer}
                          now={now}
                          onOpenAccount={onOpenAccount}
                          pick={pick}
                          shared={Boolean(peer.ipKey && shared.has(peer.ipKey))}
                        />
                      ))}
                    </ul>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
