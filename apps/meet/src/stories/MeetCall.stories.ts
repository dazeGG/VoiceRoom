import type { Meta, StoryObj } from '../../../../packages/ui/.storybook/types';
import { onUnmounted, ref, shallowReactive, shallowRef } from 'vue';
import { state } from '@voice-room/call/engine/core/room-runtime.store';
import type { Participant } from '@voice-room/call/engine/core/types';
import { installCallPorts } from '@voice-room/call/engine/ports';
import { createParticipant } from '@voice-room/call/engine/room/participants';
import { voiceAssetUrls } from '@voice-room/call/voice-assets';
import { createMeetPorts } from '@/adapters/meet-ports';
import type { MeetChatMessage } from '@/adapters/meet-transport';
import MeetCall from '@/components/MeetCall.vue';
import { installMeetI18n, setMeetLocale } from '@/i18n';
import { useMeetStore } from '@/meet.store';
import '@/styles/main.scss';

const meta = {
  title: 'Apps/Meet/Call',
  component: MeetCall,
  tags: ['autodocs'],
  parameters: { layout: 'fullscreen' },
  args: {
    capabilities: { camera: false, screenShare: false, chat: 'ephemeral', maxPeers: 4 },
    reconnecting: false
  },
  render: (args) => ({
    components: { MeetCall },
    setup() {
      installMeetI18n();
      setMeetLocale('ru');
      const meet = useMeetStore();
      const uninstall = installCallPorts(
        createMeetPorts({
          identity: meet.identity,
          transport: meet.transport,
          assets: voiceAssetUrls(),
          navigateToRoom: () => {},
          goHome: () => {}
        })
      );
      const { peerId, self, peers, joined, serverConnection, voiceConnection } = state;
      state.joined = true;
      state.serverConnection = 'connected';
      state.voiceConnection = 'connected';
      state.peerId = 'demo-self';
      state.self = null;
      state.peers = shallowReactive(new Map<string, Participant>());
      createParticipant({ id: state.peerId, name: 'Анна' });
      createParticipant({ id: 'demo-oleg', name: 'Олег' }).speaking = true;
      createParticipant({ id: 'demo-mira', name: 'Мира', muted: true });

      const messages = shallowRef<readonly MeetChatMessage[]>([
        { id: '1', authorId: 'demo-oleg', displayName: 'Олег', text: 'Начнём встречу?' }
      ]);
      meet.transport.chat = {
        ready: ref(true),
        messages,
        error: ref(null),
        send(text) {
          const id = String(messages.value.length + 1);
          messages.value = [...messages.value, { id, authorId: state.peerId, displayName: 'Анна', text }];
          return true;
        }
      };
      onUnmounted(() => {
        uninstall();
        Object.assign(state, { peerId, self, peers, joined, serverConnection, voiceConnection });
      });
      return { args, active: ref(true) };
    },
    template: '<MeetCall v-if="active" v-bind="args" @leave="active = false" />'
  })
} satisfies Meta<typeof MeetCall>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Call: Story = {};
