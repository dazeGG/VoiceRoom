// The React pages still mounted by the shell share these Vue components until Phase D.
import { useId, useLayoutEffect, useRef, type ReactElement } from 'react';
import { createApp, h, shallowReactive, type Component } from 'vue';
import RangePicker from './TimeRangePicker.vue';
import Chart from './charts/TimeChart.vue';
import FinishedCalls from './pages/rooms/CallList.vue';
import RoomFilters from './pages/rooms/CallFilters.vue';
import CurrentCalls from './pages/rooms/LiveCalls.vue';
import StaySpan from './pages/rooms/NetworkSpan.vue';
import RoomOrigin from './pages/rooms/Origin.vue';
import VoiceQuality from './pages/rooms/QualityCell.vue';

function vueComponent<Props extends object>(
  component: Component & (new () => { $props: Props }),
  tag: 'div' | 'span' = 'div'
): (props: Props) => ReactElement {
  const Host = tag;
  return function VueComponent(props: Props) {
    const id = useId();
    const host = useRef<HTMLElement>(null);
    const current = useRef(shallowReactive({ props }));
    useLayoutEffect(() => {
      if (!host.current) return;
      const app = createApp({ render: () => h(component, { ...current.current.props }) });
      app.config.idPrefix = id;
      app.mount(host.current);
      return () => app.unmount();
    }, [id]);
    useLayoutEffect(() => {
      current.current.props = props;
    }, [props]);
    return (
      <Host
        className="admin-vue-host"
        ref={(element) => {
          host.current = element;
        }}
      />
    );
  };
}

export const TimeChart = vueComponent(Chart);
export const TimeRangePicker = vueComponent(RangePicker);
export const CallList = vueComponent(FinishedCalls);
export const FilterChips = vueComponent(RoomFilters, 'span');
export const LiveCalls = vueComponent(CurrentCalls);
export const NetworkSpan = vueComponent(StaySpan, 'span');
export const Origin = vueComponent(RoomOrigin, 'span');
export const QualityCell = vueComponent(VoiceQuality, 'span');
