import { expect, test, vi } from 'vitest';
import { prepareScreenStartBitrate, screenStartBitrateAnswer } from '@/features/room/client/media/screen-start-bitrate';

const session = 'v=0\r\na=group:BUNDLE 0 1 2\r\n';
const audio =
  'm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=mid:0\r\na=sendrecv\r\na=rtpmap:111 opus/48000/2\r\na=fmtp:111 minptime=10;useinbandfec=1\r\n';
const data = 'm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\na=mid:2\r\na=sctp-port:5000\r\n';
const offer =
  session +
  audio +
  'm=video 9 UDP/TLS/RTP/SAVPF 103 109\r\na=mid:1\r\na=sendonly\r\na=msid:stream screen-track\r\na=rtpmap:103 H264/90000\r\na=fmtp:103 profile-level-id=42001f;x-google-start-bitrate=5850\r\na=rtpmap:109 H264/90000\r\na=fmtp:109 profile-level-id=42e01f\r\n' +
  data;
const answerVideo =
  'm=video 9 UDP/TLS/RTP/SAVPF 109\r\na=mid:1\r\na=recvonly\r\na=rtpmap:109 H264/90000\r\na=fmtp:109 profile-level-id=42e01f\r\n';
const answer = session + audio + answerVideo + data;

test('the accepted H264 variant receives the SDK hint without changing audio, data or codec parameters', () => {
  const result = screenStartBitrateAnswer(offer, answer, 'screen-track');
  expect(result).toBe(
    answer.replace(
      'a=fmtp:109 profile-level-id=42e01f',
      'a=fmtp:109 profile-level-id=42e01f;x-google-start-bitrate=5850'
    )
  );
});

test('a bundled placeholder shares the hint, but an unrelated payload is unchanged', () => {
  const placeholder = answerVideo.replace('a=mid:1', 'a=mid:3').replace('a=recvonly', 'a=sendonly');
  const other = answerVideo.replace('a=mid:1', 'a=mid:4').replaceAll('109', '115');
  const result = screenStartBitrateAnswer(offer, answer + placeholder + other, 'screen-track');
  expect(result?.match(/x-google-start-bitrate=5850/g)).toHaveLength(2);
  expect(result).toContain(other);
});

test('VP8 without fmtp gains only a startup estimate, and LF line endings survive', () => {
  const vp8Offer = offer.replaceAll('H264', 'VP8');
  const vp8Answer = answer.replaceAll('H264', 'VP8').replace('a=fmtp:109 profile-level-id=42e01f\r\n', '');
  expect(screenStartBitrateAnswer(vp8Offer, vp8Answer, 'screen-track')).toContain(
    'a=rtpmap:109 VP8/90000\r\na=fmtp:109 x-google-start-bitrate=5850\r\n'
  );
  expect(
    screenStartBitrateAnswer(offer.replaceAll('\r\n', '\n'), answer.replaceAll('\r\n', '\n'), 'screen-track')
  ).not.toContain('\r');
});

test('unrelated, inactive, rejected, unhinted or already hinted negotiations remain untouched', () => {
  for (const [local, remote, id] of [
    [offer, answer, 'camera-track'],
    [offer, answer, ''],
    [offer.replace('a=sendonly', 'a=recvonly'), answer, 'screen-track'],
    [offer, answer.replace('a=recvonly', 'a=inactive'), 'screen-track'],
    [offer, answer.replace('m=video 9', 'm=video 0'), 'screen-track'],
    [offer.replace(';x-google-start-bitrate=5850', ''), answer, 'screen-track'],
    [offer.replace('=5850', '=0'), answer, 'screen-track'],
    [offer, answer.replace('=42e01f', '=42e01f;x-google-start-bitrate=1500'), 'screen-track'],
    [offer, answer.replaceAll('H264', 'VP8'), 'screen-track']
  ]) {
    expect(screenStartBitrateAnswer(local ?? '', remote ?? '', id ?? '')).toBeUndefined();
  }
});

function publisher() {
  const apply = vi.fn(async (_description: RTCSessionDescriptionInit, _offerId: number) => true);
  return {
    getLocalDescription: () => ({ sdp: offer }),
    getRemoteDescription: vi.fn<() => { sdp: string } | null>(() => null),
    setRemoteDescription: apply,
    apply
  };
}

test('only the first accepted screen answer is seeded, preserving offer IDs and the original method', async () => {
  const transport = publisher();
  prepareScreenStartBitrate(transport, 'screen-track');
  await transport.setRemoteDescription({ type: 'offer', sdp: answer }, 1);
  expect(transport.apply).toHaveBeenLastCalledWith({ type: 'offer', sdp: answer }, 1);
  await transport.setRemoteDescription({ type: 'answer', sdp: answer }, 2);
  expect(transport.apply).toHaveBeenLastCalledWith(
    { type: 'answer', sdp: screenStartBitrateAnswer(offer, answer, 'screen-track') },
    2
  );
  expect(transport.setRemoteDescription).toBe(transport.apply);
  prepareScreenStartBitrate(transport, 'another-share');
  await transport.setRemoteDescription({ type: 'answer', sdp: answer }, 3);
  expect(transport.apply).toHaveBeenLastCalledWith({ type: 'answer', sdp: answer }, 3);
  const reconnect = publisher();
  prepareScreenStartBitrate(reconnect, 'screen-track');
  await reconnect.setRemoteDescription({ type: 'answer', sdp: answer }, 1);
  expect(reconnect.apply).toHaveBeenLastCalledWith(
    { type: 'answer', sdp: screenStartBitrateAnswer(offer, answer, 'screen-track') },
    1
  );
});

test('a rejected optimization falls back to the exact original answer and is never retried', async () => {
  const transport = publisher();
  transport.apply.mockRejectedValueOnce(new Error('Unsupported hint'));
  prepareScreenStartBitrate(transport, 'screen-track');
  const description = { type: 'answer' as const, sdp: answer };
  await expect(transport.setRemoteDescription(description, 4)).resolves.toBe(true);
  expect(transport.apply).toHaveBeenLastCalledWith(description, 4);
  expect(description.sdp).toBe(answer);
  expect(transport.setRemoteDescription).toBe(transport.apply);
});

test('an upstream-provided seed disables the repair for the rest of the connection', async () => {
  const transport = publisher();
  prepareScreenStartBitrate(transport, 'screen-track');
  const hinted = answer.replace('=42e01f', '=42e01f;x-google-start-bitrate=2000');
  await transport.setRemoteDescription({ type: 'answer', sdp: hinted }, 1);
  expect(transport.apply).toHaveBeenLastCalledWith({ type: 'answer', sdp: hinted }, 1);
  expect(transport.setRemoteDescription).toBe(transport.apply);
  await transport.setRemoteDescription({ type: 'answer', sdp: answer }, 2);
  expect(transport.apply).toHaveBeenLastCalledWith({ type: 'answer', sdp: answer }, 2);
});

test('a failure after accepting the answer propagates instead of retrying an already accepted offer', async () => {
  const transport = publisher();
  const failure = new Error('Queued negotiation failed');
  transport.apply.mockImplementationOnce(async (description) => {
    transport.getRemoteDescription.mockReturnValue({ sdp: description.sdp ?? '' });
    throw failure;
  });
  prepareScreenStartBitrate(transport, 'screen-track');
  await expect(transport.setRemoteDescription({ type: 'answer', sdp: answer }, 5)).rejects.toBe(failure);
  expect(transport.apply).toHaveBeenCalledTimes(1);
  expect(transport.setRemoteDescription).toBe(transport.apply);
});

test('ignored stale answers do not consume the seed, and an abandoned publication can be replaced', async () => {
  const transport = publisher();
  prepareScreenStartBitrate(transport, 'abandoned-track');
  prepareScreenStartBitrate(transport, 'screen-track');
  transport.apply.mockResolvedValueOnce(false);
  await transport.setRemoteDescription({ type: 'answer', sdp: answer }, 1);
  expect(transport.setRemoteDescription).not.toBe(transport.apply);
  await transport.setRemoteDescription({ type: 'answer', sdp: answer }, 2);
  expect(transport.apply).toHaveBeenLastCalledWith(
    { type: 'answer', sdp: screenStartBitrateAnswer(offer, answer, 'screen-track') },
    2
  );
  expect(transport.setRemoteDescription).toBe(transport.apply);
});
