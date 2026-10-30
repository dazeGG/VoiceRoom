// Stands in for RoomPage inside the lobby: it reaches the lobby only through
// the room shell, as the real room does.

import { computed, defineComponent, h } from 'vue';
import { useRoomShell } from '@/features/room/shell';

export default defineComponent({
  props: { embeddedRoomId: { type: String, default: '' }, roomId: { type: String, default: '' } },
  setup(props) {
    const shell = useRoomShell();
    const shownRoomId = computed(() => props.embeddedRoomId || props.roomId);
    return () =>
      h('section', { 'aria-label': `Комната ${shownRoomId.value}` }, [
        h('button', { type: 'button', onClick: () => shell.roomLeft(shownRoomId.value) }, 'Покинуть комнату'),
        h('button', { type: 'button', onClick: () => shell.roomsChanged(shownRoomId.value) }, 'Сохранить комнату')
      ]);
  }
});
