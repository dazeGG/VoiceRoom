import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import SettingsModal from '../../src/lib/features/home/components/SettingsModal.svelte';
import { session, setUser } from '../../src/lib/features/auth/session.svelte';
import type { AuthUser } from '../../src/lib/api/auth';
import { stubFetch } from '../fixtures/fetch.ts';
import { authUser } from '../fixtures/users.ts';
import { stubCanvasAndImages } from '../helpers/fake-canvas.ts';

const saved = authUser({ displayName: 'Аня', avatarUrl: '/avatars/anya.webp' });

beforeEach(() => {
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:crop', revokeObjectURL: vi.fn() }));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  setUser(null);
});

function renderSettings(user: AuthUser = saved) {
  const props = {
    open: true,
    tab: 'profile' as const,
    user,
    onClose: vi.fn(),
    onToast: vi.fn(),
    onLogout: vi.fn()
  };
  const view = render(SettingsModal, { props });
  return { ...view, props };
}

const profileImage = () => document.querySelector<HTMLImageElement>('.settings-profile-avatar img');

async function pickAndCrop(): Promise<void> {
  const input = document.querySelector<HTMLInputElement>('.settings-avatar-input')!;
  await userEvent.upload(input, new File(['picture'], 'me.png', { type: 'image/png' }));
  const done = await screen.findByRole('button', { name: 'Готово' });
  await vi.waitFor(() => expect(done).toHaveProperty('disabled', false));
  await userEvent.click(done);
}

test('a cropped avatar is previewed, and uploaded only when the profile is saved', async () => {
  stubCanvasAndImages();
  const updated = authUser({ ...saved, avatarUrl: '/avatars/anya-2.webp' });
  const { calls } = stubFetch({ 'POST /api/auth/avatar': { body: { ok: true, user: updated } } });
  const { props } = renderSettings();

  await pickAndCrop();
  expect(screen.queryByRole('dialog', { name: 'Аватар профиля' })).toBeNull();
  expect(profileImage()?.getAttribute('src')).toBe('blob:crop');
  expect(calls.filter((call) => call.url === '/api/auth/avatar')).toEqual([]);

  await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
  const upload = calls.find((call) => call.url === '/api/auth/avatar');
  expect(upload?.method).toBe('POST');
  expect((upload?.body as FormData).get('avatar')).toBeInstanceOf(Blob);
  expect(session.user?.avatarUrl).toBe('/avatars/anya-2.webp');
  expect(props.onToast).toHaveBeenCalledWith('Изменения сохранены');
  expect(props.onClose).toHaveBeenCalled();
});

test('a removed avatar disappears at once and is deleted when the profile is saved', async () => {
  const updated = authUser({ ...saved, avatarUrl: null });
  const { calls } = stubFetch({ 'DELETE /api/auth/avatar': { body: { ok: true, user: updated } } });
  const { props } = renderSettings();

  expect(profileImage()?.getAttribute('src')).toBe('/avatars/anya.webp');
  await userEvent.click(screen.getByRole('button', { name: 'Удалить аватар' }));
  expect(profileImage()).toBeNull();
  expect(screen.queryByRole('button', { name: 'Удалить аватар' })).toBeNull();

  await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
  expect(calls.map((call) => `${call.method} ${call.url}`)).toContain('DELETE /api/auth/avatar');
  expect(session.user?.avatarUrl).toBeNull();
  expect(props.onClose).toHaveBeenCalled();
});

test('a new crop after a removal uploads instead of deleting', async () => {
  stubCanvasAndImages();
  const { calls } = stubFetch({ 'POST /api/auth/avatar': { body: { ok: true, user: saved } } });
  renderSettings();

  await userEvent.click(screen.getByRole('button', { name: 'Удалить аватар' }));
  await pickAndCrop();
  await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
  expect(calls.filter((call) => call.url === '/api/auth/avatar').map((call) => call.method)).toEqual(['POST']);
});

test('a file that is not an image, or is too large, never reaches the crop dialog', async () => {
  const { props } = renderSettings();
  const input = document.querySelector<HTMLInputElement>('.settings-avatar-input')!;

  await fireEvent.change(input, { target: { files: [new File(['text'], 'notes.txt', { type: 'text/plain' })] } });
  expect(props.onToast).toHaveBeenLastCalledWith('Выберите изображение JPEG, PNG или WebP');

  const huge = new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'huge.png', { type: 'image/png' });
  await fireEvent.change(input, { target: { files: [huge] } });
  expect(props.onToast).toHaveBeenLastCalledWith('Изображение должно быть меньше 5 МБ');
  expect(screen.queryByRole('dialog', { name: 'Аватар профиля' })).toBeNull();
});

test('saving without changes just closes, and a refused save keeps the settings open', async () => {
  const { calls } = stubFetch({
    'POST /api/auth/profile': { status: 400, body: { ok: false, error: 'Имя занято' } }
  });
  const { props } = renderSettings();

  await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
  expect(props.onClose).toHaveBeenCalledTimes(1);
  expect(calls.filter((call) => call.url.startsWith('/api/auth/profile'))).toEqual([]);

  await userEvent.clear(screen.getByLabelText('Имя'));
  await userEvent.type(screen.getByLabelText('Имя'), 'Анна');
  await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
  expect(calls.find((call) => call.url === '/api/auth/profile')?.body).toEqual({ displayName: 'Анна' });
  expect(props.onClose).toHaveBeenCalledTimes(1);
  expect(props.onToast).toHaveBeenLastCalledWith(expect.any(String));
});

test('unsaved edits survive another tab, and reopening the settings starts from what is saved', async () => {
  stubFetch({ 'GET /api/blocks': { body: { ok: true, blocked: [], users: [] } } });
  const { rerender, props } = renderSettings();

  await userEvent.clear(screen.getByLabelText('Имя'));
  await userEvent.type(screen.getByLabelText('Имя'), 'Черновик');
  await userEvent.click(screen.getByRole('button', { name: 'Удалить аватар' }));

  await rerender({ ...props, tab: 'notifications' });
  expect(await screen.findByText('Заблокированных пользователей нет.')).toBeTruthy();
  await rerender({ ...props, tab: 'profile' });
  expect(screen.getByLabelText('Имя')).toHaveProperty('value', 'Черновик');
  expect(profileImage()).toBeNull();

  await rerender({ ...props, open: false });
  await rerender({ ...props, open: true, tab: 'profile' });
  expect(screen.getByLabelText('Имя')).toHaveProperty('value', 'Аня');
  expect(profileImage()?.getAttribute('src')).toBe('/avatars/anya.webp');
});

test('the avatar control says whether it uploads or changes, and delete is offered only for an avatar', () => {
  renderSettings(authUser({ avatarUrl: null }));
  expect(screen.getByRole('button', { name: 'Загрузить аватар' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Удалить аватар' })).toBeNull();
  cleanup();

  renderSettings();
  expect(screen.getByRole('button', { name: 'Изменить аватар' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Удалить аватар' })).toBeTruthy();
});
