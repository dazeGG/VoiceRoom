import { fireEvent, render, screen } from '@testing-library/vue';
import userEvent from '@testing-library/user-event';
import {
  AccountBadge,
  BrandIcon,
  ColorField,
  ControlGroup,
  createWidgetLauncher,
  Dialog,
  Field,
  FileDrop,
  MascotIcon,
  Pressable,
  RadioGroup,
  RadioGroupItem
} from '@voiceroom/ui-kit/components';
import { defineComponent, h } from 'vue';
import { expect, test, vi } from 'vitest';
import { instanceOf } from '../../../../apps/web/test/helpers/assert';

test('Pressable activates by keyboard and exposes its pressed state', async () => {
  const onClick = vi.fn();
  render(Pressable, {
    attrs: { 'aria-pressed': true, onClick },
    slots: { default: 'Закрепить комнату' }
  });
  const control = screen.getByRole('button', { name: 'Закрепить комнату', pressed: true });
  await userEvent.tab();
  expect(document.activeElement).toBe(control);
  await userEvent.keyboard('{Enter} ');
  expect(onClick).toHaveBeenCalledTimes(2);
});

test('Pressable prevents activation of a disabled slotted link', async () => {
  const onClick = vi.fn();
  render(Pressable, {
    props: { asChild: true, disabled: true },
    slots: { default: () => h('a', { href: '#rooms', onClick }, 'Комнаты') }
  });
  const link = screen.getByRole('link', { name: 'Комнаты' });
  expect(link.getAttribute('aria-disabled')).toBe('true');
  await userEvent.tab();
  expect(document.activeElement).not.toBe(link);
  await userEvent.click(link);
  expect(onClick).not.toHaveBeenCalled();
});

test('a secondary swatch does not take the label from the main color input', async () => {
  const selected = vi.fn();
  const Example = defineComponent(
    () => () =>
      h(
        Field,
        { label: 'Цвет в HEX' },
        {
          default: ({ control }: { control: { id?: string } }) => [
            h(ColorField, {
              secondary: true,
              label: 'Палитра',
              modelValue: '#ffffff',
              'onUpdate:modelValue': selected
            }),
            h('input', { id: control.id })
          ]
        }
      )
  );
  render(Example);
  expect(screen.getByRole('textbox', { name: 'Цвет в HEX' })).toBeTruthy();
  await fireEvent.update(screen.getByLabelText('Палитра'), '#101820');
  expect(selected).toHaveBeenCalledWith('#101820');
});

test('a FileDrop custom trigger opens its file input and reports the picked files', async () => {
  const onFiles = vi.fn();
  render(FileDrop, {
    props: { variant: 'trigger', accept: 'image/png', inputLabel: 'Изображение', onFiles },
    slots: {
      default: ({ choose }: { choose: () => void }) => h(Pressable, { onClick: choose }, () => 'Загрузить')
    }
  });
  const input = instanceOf(screen.getByLabelText('Изображение'), HTMLInputElement, 'file picker');
  const openPicker = vi.spyOn(input, 'click');
  await userEvent.click(screen.getByRole('button', { name: 'Загрузить' }));
  expect(openPicker).toHaveBeenCalledOnce();
  const photo = new File(['photo'], 'avatar.png', { type: 'image/png' });
  await userEvent.upload(input, photo);
  expect(onFiles).toHaveBeenCalledWith([photo]);
});

test('a full-screen dialog gives custom content the dialog title and keeps Escape inside', async () => {
  const onClose = vi.fn();
  render(Dialog, {
    props: {
      open: true,
      size: 'full',
      trim: 'bare',
      title: 'Звонок завершён',
      closable: false,
      closeDisabled: true,
      onClose
    },
    slots: { default: () => h(Pressable, () => 'Вернуться') }
  });
  expect(await screen.findByRole('dialog', { name: 'Звонок завершён' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Вернуться' })).toBeTruthy();
  await userEvent.keyboard('{Escape}');
  expect(onClose).not.toHaveBeenCalled();
});

test('a radio tile accepts custom content and responds to the next arrow key', async () => {
  render(
    defineComponent(
      () => () =>
        h(
          RadioGroup,
          { 'aria-label': 'Источник' },
          {
            item: () => [
              h(RadioGroupItem, { variant: 'tile', option: { value: '1', label: 'Первый экран' } }, () => 'Превью'),
              h(RadioGroupItem, { variant: 'tile', option: { value: '2', label: 'Второй экран' } }, () => 'Превью')
            ]
          }
        )
    )
  );
  await userEvent.click(screen.getByRole('radio', { name: 'Первый экран' }));
  await userEvent.keyboard('{ArrowRight}');
  expect(screen.getByRole('radio', { name: 'Второй экран', checked: true })).toBeTruthy();
});

test('the control group names its actions and account badges announce the account type', () => {
  render(ControlGroup, {
    props: { label: 'Разделы комнаты' },
    slots: { default: () => h(AccountBadge, { badge: 'official' }) }
  });
  expect(screen.getByRole('group', { name: 'Разделы комнаты' })).toBeTruthy();
  expect(screen.getByRole('img', { name: 'Официальный аккаунт VoiceRoom' })).toBeTruthy();
});

test('the brand icon and mascot stay decorative', () => {
  render(
    defineComponent(() => () => [
      h(MascotIcon, { variant: 'scare' }),
      h(BrandIcon, { icon: { icon: [24, 24, [], '0', 'M4 4h16v16H4z'] } })
    ])
  );
  expect(screen.queryByRole('img')).toBeNull();
  expect(document.querySelectorAll('svg[aria-hidden="true"]')).toHaveLength(2);
});

test('a floating widget launcher can be operated by keyboard in the host document', async () => {
  const launcher = createWidgetLauncher({
    floating: true,
    background: '#181918',
    text: '#f0f1e8',
    accent: '#c1f100'
  });
  launcher.element.addEventListener('click', () => {
    launcher.setExpanded(false);
    launcher.setInCall(true);
  });
  document.body.append(launcher.element);
  try {
    await userEvent.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'VoiceRoom', expanded: true }));
    await userEvent.keyboard('{Enter}');
    expect(screen.getByRole('button', { name: 'VoiceRoom • В звонке', expanded: false })).toBe(launcher.element);
  } finally {
    launcher.element.remove();
  }
});
