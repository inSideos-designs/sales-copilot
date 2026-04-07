import { describe, expect, it, vi, beforeEach } from "vitest";

import { captureMeetingTabAudio, AudioCaptureError } from "./audioCapture";

type DisplayMediaMock = (constraints: MediaStreamConstraints) => Promise<MediaStream>;

function setGetDisplayMedia(mock: DisplayMediaMock) {
  // Ensure the nested assignment is allowed under strict TS
  const md = (navigator as unknown as { mediaDevices: { getDisplayMedia: DisplayMediaMock } });
  md.mediaDevices = { getDisplayMedia: mock };
}

describe("captureMeetingTabAudio", () => {
  beforeEach(() => {
    setGetDisplayMedia(() => Promise.reject(new Error("not set")));
  });

  it("returns the stream when an audio track is present", async () => {
    const audioTrack = { kind: "audio", stop: vi.fn() } as unknown as MediaStreamTrack;
    const stream = {
      getAudioTracks: () => [audioTrack],
      getVideoTracks: () => [],
      getTracks: () => [audioTrack],
    } as unknown as MediaStream;

    setGetDisplayMedia(() => Promise.resolve(stream));

    const result = await captureMeetingTabAudio();
    expect(result).toBe(stream);
  });

  it("throws AudioCaptureError when no audio track is present", async () => {
    const stream = {
      getAudioTracks: () => [],
      getVideoTracks: () => [{ stop: vi.fn() }],
      getTracks: () => [{ stop: vi.fn() }],
    } as unknown as MediaStream;

    setGetDisplayMedia(() => Promise.resolve(stream));

    await expect(captureMeetingTabAudio()).rejects.toBeInstanceOf(AudioCaptureError);
    await expect(captureMeetingTabAudio()).rejects.toMatchObject({
      code: "no_audio_track",
    });
  });

  it("throws AudioCaptureError when user denies the permission", async () => {
    const err = new DOMException("user denied", "NotAllowedError");
    setGetDisplayMedia(() => Promise.reject(err));

    await expect(captureMeetingTabAudio()).rejects.toMatchObject({
      code: "permission_denied",
    });
  });
});
