import { render, screen } from '@testing-library/vue';
import { describe, expect, it } from 'vitest';
import { FileAttachment } from '../../src/components';
import story, { Ready, Uploading } from '../../src/components/FileAttachment/FileAttachment.stories';

const { name } = story.args;

describe('FileAttachment', () => {
  it('shows the filename and size and links to the file as a download', () => {
    render(FileAttachment, { props: { ...story.args, ...Ready.args } });
    expect(screen.getByText(name).getAttribute('title')).toBe(name);
    expect(screen.getByText('Диагностика · 18 КБ')).toBeTruthy();
    const link = screen.getByRole('link', { name: 'Скачать файл' });
    expect(link.getAttribute('href')).toBe('/example-diagnostics.txt');
    expect(link.getAttribute('download')).toBe(name);
  });

  it('shows short files in bytes and leaves the download unavailable during upload', () => {
    render(FileAttachment, { props: { ...story.args, ...Uploading.args, bytes: 52 } });
    expect(screen.getByText('Диагностика · 52 Б')).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
  });
});
