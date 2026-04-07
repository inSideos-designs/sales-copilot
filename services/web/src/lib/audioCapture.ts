/**
 * Capture audio from a meeting tab via `getDisplayMedia`.
 *
 * Phase 1 only acquires the stream and verifies an audio track is
 * present. In Phase 3 we start pumping Opus frames over the WebSocket.
 */

export type AudioCaptureErrorCode =
  | "permission_denied"
  | "no_audio_track"
  | "unsupported";

export class AudioCaptureError extends Error {
  readonly code: AudioCaptureErrorCode;

  constructor(code: AudioCaptureErrorCode, message: string) {
    super(message);
    this.name = "AudioCaptureError";
    this.code = code;
  }
}

export async function captureMeetingTabAudio(): Promise<MediaStream> {
  if (
    typeof navigator === "undefined" ||
    !navigator.mediaDevices ||
    !navigator.mediaDevices.getDisplayMedia
  ) {
    throw new AudioCaptureError(
      "unsupported",
      "Your browser does not support tab capture (getDisplayMedia).",
    );
  }

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      audio: true,
      // We don't need the video; browsers still require the flag.
      video: { width: 1, height: 1, frameRate: 1 },
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "NotAllowedError") {
      throw new AudioCaptureError(
        "permission_denied",
        "Tab capture was denied. Click Start again and share the meeting tab with audio.",
      );
    }
    throw err;
  }

  const audioTracks = stream.getAudioTracks();
  if (audioTracks.length === 0) {
    // Clean up any video track the picker gave us
    stream.getTracks().forEach((t) => t.stop());
    throw new AudioCaptureError(
      "no_audio_track",
      "No audio track was shared. Make sure you check 'Share tab audio' in the picker.",
    );
  }

  return stream;
}
