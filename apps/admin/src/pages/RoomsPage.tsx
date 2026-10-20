// Who is in which room's voice right now, a card per room, refreshed every few
// seconds, and the finished stays before, the latest first. Names, accounts,
// times and the kind of client only: nothing said in a room. An account opens
// its card; a room's name narrows the history to it.

import {
  AppWindow,
  ChevronLeft,
  ChevronRight,
  Globe,
  HeadphoneOff,
  MicOff,
  MonitorUp,
  Smartphone,
  X,
  type LucideIcon
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  LiveRoom,
  LiveRoomPeer,
  RoomAccount,
  RoomHistoryQuery,
  RoomStay
} from '@voice-room/shared/contracts/admin';
import { fetchLiveRooms, fetchRoomHistory } from '../api/admin.ts';
import { formatCount, formatDuration, formatSince, formatTimeSpan } from '../format.ts';
import { loadFailure, type LoadFailure } from '../load-state.ts';
import { Notice } from '../Notice.tsx';
import { deviceLabel, shortGuestId, shortIpKey } from '../origin.ts';
import { AccountBadge, Avatar, Button } from '../ui/index.tsx';
import './RoomsPage.css';

const REFRESH_MS = 5000;

interface HistoryRoom {
  id: string;
  name: string | null;
}

const CLIENTS: Record<NonNullable<LiveRoomPeer['client']>, { label: string; icon: LucideIcon }> = {
  desktop_app: { label: 'приложение', icon: AppWindow },
  browser: { label: 'браузер', icon: Globe },
  mobile: { label: 'телефон', icon: Smartphone }
};

const nameOf = (account: RoomAccount) => account.displayName || account.login;

function AccountLink({ account, onOpen }: { account: RoomAccount; onOpen: (accountId: string) => void }) {
  return (
    <button type="button" className="rooms-account" onClick={() => onOpen(account.id)}>
      {nameOf(account)}
      <AccountBadge userId={account.id} />
      <span className="rooms-login">@{account.login}</span>
    </button>
  );
}

/** The device and the place, never the address: equal ip· keys are the same address. */
function Origin({ seat }: { seat: Pick<RoomStay, 'client' | 'os' | 'browser' | 'guestId' | 'ipKey' | 'location'> }) {
  const device = deviceLabel(seat);
  if (!device && !seat.location && !seat.ipKey && !seat.guestId) return null;
  return (
    <span className="rooms-origin">
      {device ? <span>{device}</span> : null}
      {seat.location ? <span>{seat.location}</span> : null}
      {seat.ipKey ? (
        <span className="rooms-code" title={`Ключ адреса ${seat.ipKey}`}>
          {shortIpKey(seat.ipKey)}
        </span>
      ) : null}
      {seat.guestId ? (
        <span className="rooms-code" title={`Браузер гостя ${seat.guestId}`}>
          {shortGuestId(seat.guestId)}
        </span>
      ) : null}
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
  const client = peer.client ? CLIENTS[peer.client] : null;
  const ClientIcon = client?.icon;
  return (
    <li className="rooms-peer">
      <Avatar
        name={peer.name}
        src={peer.account?.avatarUrl ?? null}
        colorKey={peer.account?.avatarColorKey ?? peer.avatarColorKey}
        background={peer.account?.avatarAccent ?? null}
        size={28}
      />
      {peer.account ? (
        <AccountLink account={peer.account} onOpen={onOpenAccount} />
      ) : (
        <>
          <span className="rooms-guest">{peer.name}</span>
          <span className="rooms-chip">гость</span>
        </>
      )}
      {client && ClientIcon ? (
        <span className="rooms-client">
          <ClientIcon size={13} aria-hidden="true" />
          {client.label}
        </span>
      ) : null}
      <Origin seat={peer} />
      <span className="rooms-peer-state">
        {peer.muted ? (
          <span title="Микрофон выключен" aria-label="Микрофон выключен">
            <MicOff size={14} aria-hidden="true" />
          </span>
        ) : null}
        {peer.deafened ? (
          <span title="Звук выключен" aria-label="Звук выключен">
            <HeadphoneOff size={14} aria-hidden="true" />
          </span>
        ) : null}
        {peer.screen ? (
          <span title="Показывает экран" aria-label="Показывает экран" data-tone="accent">
            <MonitorUp size={14} aria-hidden="true" />
          </span>
        ) : null}
        {peer.joinedAt ? (
          <span className="rooms-quiet">
            {now - peer.joinedAt < 60_000 ? 'только что' : formatSince(peer.joinedAt, now)}
          </span>
        ) : null}
      </span>
    </li>
  );
}

export function RoomsPage({ onOpenAccount }: { onOpenAccount: (accountId: string) => void }) {
  const [rooms, setRooms] = useState<LiveRoom[] | null>(null);
  const [liveFailure, setLiveFailure] = useState<LoadFailure | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const [stays, setStays] = useState<RoomStay[]>([]);
  // The cursor each page opens with, the first one's empty; the API pages by
  // cursor, so a page already passed is only reached again through its own.
  const [pageCursors, setPageCursors] = useState<(string | undefined)[]>([undefined]);
  const [pageIndex, setPageIndex] = useState(0);
  const [keepDays, setKeepDays] = useState<number | null>(null);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [historyFailure, setHistoryFailure] = useState<LoadFailure | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyRoom, setHistoryRoom] = useState<HistoryRoom | null>(null);
  const historyRequest = useRef(0);
  const historySection = useRef<HTMLElement>(null);

  const liveInFlight = useRef(false);

  const loadLive = useCallback(() => {
    // A slow answer is waited for, not piled on: one request at a time keeps answers in order.
    if (liveInFlight.current) return;
    liveInFlight.current = true;
    fetchLiveRooms()
      .then(
        (loaded) => {
          setRooms(loaded.rooms);
          setLiveFailure(null);
        },
        (cause: unknown) => setLiveFailure(loadFailure(cause, 'Не удалось загрузить комнаты'))
      )
      .finally(() => {
        liveInFlight.current = false;
        setNow(Date.now());
      });
  }, []);

  const loadHistory = useCallback((room: HistoryRoom | null, cursors: (string | undefined)[], index: number) => {
    // An answer for a room or page already left behind is dropped.
    historyRequest.current += 1;
    const mine = historyRequest.current;
    const after = index > 0 ? cursors[index] : undefined;
    const query: RoomHistoryQuery = { ...(room ? { roomId: room.id } : {}), ...(after ? { after } : {}) };
    fetchRoomHistory(query)
      .then(
        (page) => {
          if (mine !== historyRequest.current) return;
          // The filter changes with its answer, so the chip never stands over another room's stays.
          setHistoryRoom(room);
          setStays(page.stays);
          setPageIndex(index);
          setPageCursors([...cursors.slice(0, index + 1), ...(page.next ? [page.next] : [])]);
          setKeepDays(page.keepDays);
          setHistoryLoaded(true);
          setHistoryFailure(null);
        },
        (cause: unknown) => {
          if (mine === historyRequest.current) setHistoryFailure(loadFailure(cause, 'Не удалось загрузить историю'));
        }
      )
      .finally(() => {
        if (mine === historyRequest.current) setHistoryLoading(false);
      });
  }, []);

  // A page asked for by the person: the pager waits for its answer.
  function showHistoryPage(room: HistoryRoom | null, cursors: (string | undefined)[], index: number): void {
    setHistoryLoading(true);
    loadHistory(room, cursors, index);
  }

  // A live room's name brings its history into view; a room already in the
  // history is narrowed in place.
  function showRoomHistory(room: HistoryRoom | null, scroll = false): void {
    showHistoryPage(room, [undefined], 0);
    if (scroll) historySection.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  }

  useEffect(() => {
    loadLive();
    loadHistory(null, [undefined], 0);
    // A hidden tab does not ask; it catches up the moment it shows again.
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') loadLive();
    }, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [loadLive, loadHistory]);

  const peopleInVoice = (rooms ?? []).reduce((count, room) => count + room.peers.length, 0);
  const hasNextPage = pageCursors.length > pageIndex + 1;
  // Under a minute reads as just now, not as "0 мин".
  const fresh = (at: number) => now - at < 60_000;

  return (
    <>
      <section className="rooms-section" aria-labelledby="rooms-live-title">
        <header className="rooms-head">
          <h2 id="rooms-live-title">Сейчас в звонках</h2>
          {rooms ? (
            <span className="rooms-quiet">
              {`${rooms.length ? `комнат: ${formatCount(rooms.length)}, людей: ${formatCount(peopleInVoice)}` : 'никого'} · обновляется каждые 5 с`}
            </span>
          ) : null}
        </header>

        {liveFailure && !rooms ? (
          <Notice failure={liveFailure} onRetry={loadLive} />
        ) : !rooms ? (
          <p className="rooms-quiet" aria-busy="true">
            Загружаем…
          </p>
        ) : rooms.length === 0 ? (
          <p className="rooms-quiet">Сейчас никто не в звонке.</p>
        ) : (
          <>
            {liveFailure ? (
              <p className="rooms-error" role="alert">
                {liveFailure.message}
              </p>
            ) : null}
            <ul className="rooms-live" aria-labelledby="rooms-live-title">
              {rooms.map((room) => (
                <li key={room.roomId} className="rooms-card">
                  <div className="rooms-card-head">
                    <button
                      type="button"
                      className="rooms-card-name"
                      title="Показать историю звонков этой комнаты"
                      onClick={() => showRoomHistory({ id: room.roomId, name: room.name }, true)}
                    >
                      {room.name}
                    </button>
                    <span className="rooms-chip">{room.isStatic ? 'постоянная' : 'временная'}</span>
                  </div>
                  <div className="rooms-card-meta">
                    <span>{formatCount(room.peers.length)} в звонке</span>
                    {room.since ? (
                      <span>{fresh(room.since) ? 'только начался' : `идёт ${formatSince(room.since, now)}`}</span>
                    ) : null}
                    {room.owner ? (
                      <span className="rooms-card-owner">
                        владелец <AccountLink account={room.owner} onOpen={onOpenAccount} />
                      </span>
                    ) : null}
                  </div>
                  <ul className="rooms-peers">
                    {room.peers.map((peer) => (
                      <PeerRow key={peer.peerId} peer={peer} now={now} onOpenAccount={onOpenAccount} />
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section className="rooms-section" aria-labelledby="rooms-history-title" ref={historySection}>
        <header className="rooms-head">
          <h2 id="rooms-history-title">История звонков</h2>
          {historyRoom ? (
            <button type="button" className="rooms-filter" onClick={() => showRoomHistory(null)}>
              {historyRoom.name ?? historyRoom.id}
              <X size={13} aria-label="Показать все комнаты" />
            </button>
          ) : null}
        </header>

        {historyFailure && !historyLoaded ? (
          <Notice failure={historyFailure} onRetry={() => showHistoryPage(historyRoom, [undefined], 0)} />
        ) : !historyLoaded ? (
          <p className="rooms-quiet" aria-busy="true">
            Загружаем…
          </p>
        ) : (
          <>
            {historyFailure ? (
              <p className="rooms-error" role="alert">
                {historyFailure.message}
              </p>
            ) : null}
            {stays.length === 0 ? (
              <p className="rooms-quiet">Завершённых звонков пока нет.</p>
            ) : (
              <>
                <div className="rooms-table-wrap">
                  <table className="rooms-table">
                    <thead>
                      <tr>
                        <th scope="col">Вошёл — вышел</th>
                        <th scope="col" className="is-number">
                          Сколько
                        </th>
                        <th scope="col">Комната</th>
                        <th scope="col">Кто</th>
                        <th scope="col">Откуда</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stays.map((stay) => (
                        <tr key={stay.id}>
                          <td>{formatTimeSpan(stay.joinedAt, stay.leftAt)}</td>
                          <td className="is-number">{formatDuration(stay.leftAt - stay.joinedAt)}</td>
                          <td>
                            <button
                              type="button"
                              className="rooms-room"
                              onClick={() => showRoomHistory({ id: stay.roomId, name: stay.roomName || null })}
                            >
                              {/* An unnamed temporary room goes by its code, and so does one that is gone. */}
                              {stay.roomName ? stay.roomName : <span className="rooms-code">{stay.roomId}</span>}
                            </button>
                            {stay.roomName === null ? <span className="rooms-chip">удалена</span> : null}
                          </td>
                          <td>
                            {stay.account ? (
                              <AccountLink account={stay.account} onOpen={onOpenAccount} />
                            ) : stay.guestName ? (
                              <>
                                <span className="rooms-guest">{stay.guestName}</span>
                                <span className="rooms-chip">гость</span>
                              </>
                            ) : (
                              <span className="rooms-quiet">гость</span>
                            )}
                          </td>
                          <td>
                            <Origin seat={stay} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {pageIndex > 0 || hasNextPage ? (
                  <nav className="rooms-pager" aria-label="Страницы истории">
                    <Button
                      variant="outline"
                      disabled={historyLoading || pageIndex === 0}
                      onClick={() => showHistoryPage(historyRoom, pageCursors, pageIndex - 1)}
                    >
                      <ChevronLeft size={14} aria-hidden="true" />
                      Назад
                    </Button>
                    <span className="rooms-quiet" aria-current="page">
                      Страница {pageIndex + 1}
                    </span>
                    <Button
                      variant="outline"
                      disabled={historyLoading || !hasNextPage}
                      onClick={() => showHistoryPage(historyRoom, pageCursors, pageIndex + 1)}
                    >
                      Дальше
                      <ChevronRight size={14} aria-hidden="true" />
                    </Button>
                  </nav>
                ) : null}
              </>
            )}
          </>
        )}
        {keepDays ? (
          <p className="rooms-quiet">
            Комната у звонка хранится {keepDays} дней, потом остаётся только время для статистики. Имена гостей не
            сохраняются.
          </p>
        ) : null}
      </section>
    </>
  );
}
