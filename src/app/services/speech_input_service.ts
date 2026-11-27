/*
 Copyright 2026 Google LLC

 Licensed under the Apache License, Version 2.0 (the "License");
 you may not use this file except in compliance with the License.
 You may obtain a copy of the License at

      https://www.apache.org/licenses/LICENSE-2.0

 Unless required by applicable law or agreed to in writing, software
 distributed under the License is distributed on an "AS IS" BASIS,
 WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 See the License for the specific language governing permissions and
 limitations under the License.
 */

import { Injectable, OnDestroy, inject, signal } from '@angular/core';
import { Subject } from 'rxjs';
import { AiProviderService } from './ai_provider_service';
import { SpeechOutputService } from './speech_output_service';

export const PREFERRED_AUDIO_MIME_TYPES: readonly string[] = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/mp4;codecs=mp4a.40.2',
];

export const VOICE_ANNOUNCEMENTS = {
  LISTENING: 'Listening — tap the microphone again when you finish speaking',
  TRANSCRIBING: 'Transcribing…',
  MIC_DENIED: 'Microphone not allowed',
  TRANSCRIPTION_FAILED: 'I could not hear that — please type your question',
} as const;

export const MAX_RECORDING_DURATION_MS = 60_000;

function pickSupportedAudioMimeType(): string | undefined {
  if (
    typeof MediaRecorder === 'undefined' ||
    typeof MediaRecorder.isTypeSupported !== 'function'
  ) {
    return undefined;
  }
  for (const candidate of PREFERRED_AUDIO_MIME_TYPES) {
    try {
      if (MediaRecorder.isTypeSupported(candidate)) {
        return candidate;
      }
    } catch {
      // Ignore probe errors for unsupported types
    }
  }
  return undefined;
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const commaIdx = result.indexOf(',');
      resolve(commaIdx >= 0 ? result.slice(commaIdx + 1) : result);
    };
    reader.onerror = () =>
      reject(reader.error || new Error('Failed to encode audio recording.'));
    reader.readAsDataURL(blob);
  });
}

function isPermissionDeniedError(err: unknown): boolean {
  const name = (err as { name?: string })?.name || '';
  const message = (err as { message?: string })?.message || '';
  return (
    name === 'NotAllowedError' ||
    name === 'PermissionDeniedError' ||
    name === 'SecurityError' ||
    /permission|denied|not allowed/i.test(message)
  );
}

@Injectable({
  providedIn: 'root',
})
export class SpeechInputService implements OnDestroy {
  private readonly aiProvider = inject(AiProviderService);
  private readonly speechOutputService = inject(SpeechOutputService);

  private readonly isListening = signal(false);
  private readonly isTranscribing = signal(false);
  private readonly statusAnnouncement = signal('');
  private readonly transcriptionSubject = new Subject<string>();

  private isStarting = false;
  private cancelPendingStart = false;
  private activeStream: MediaStream | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private audioChunks: Blob[] = [];
  private maxDurationTimer: ReturnType<typeof setTimeout> | null = null;
  private announcementTimer: ReturnType<typeof setTimeout> | null = null;

  readonly listening = this.isListening.asReadonly();
  readonly transcribing = this.isTranscribing.asReadonly();
  readonly announcement = this.statusAnnouncement.asReadonly();
  readonly transcription$ = this.transcriptionSubject.asObservable();

  async startListening(): Promise<void> {
    if (this.isListening() || this.isStarting || this.isTranscribing()) {
      return;
    }

    if (
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === 'undefined'
    ) {
      this.announce(VOICE_ANNOUNCEMENTS.TRANSCRIPTION_FAILED, true);
      return;
    }

    this.isStarting = true;
    this.cancelPendingStart = false;

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err: unknown) {
      this.isStarting = false;
      this.cancelPendingStart = false;
      this.isListening.set(false);
      if (isPermissionDeniedError(err)) {
        this.announce(VOICE_ANNOUNCEMENTS.MIC_DENIED, true);
      } else {
        console.warn('[SpeechInputService] Microphone acquisition failed:', err);
        this.announce(VOICE_ANNOUNCEMENTS.TRANSCRIPTION_FAILED, true);
      }
      return;
    }

    if (this.cancelPendingStart) {
      this.cancelPendingStart = false;
      this.isStarting = false;
      this.stopStreamTracks(stream);
      return;
    }

    this.activeStream = stream;
    this.audioChunks = [];

    const chosenMimeType = pickSupportedAudioMimeType();
    let recorder: MediaRecorder;
    try {
      recorder = chosenMimeType
        ? new MediaRecorder(stream, { mimeType: chosenMimeType })
        : new MediaRecorder(stream);
    } catch (err) {
      console.warn('[SpeechInputService] Failed to create MediaRecorder:', err);
      this.cleanupRecordingResources();
      this.announce(VOICE_ANNOUNCEMENTS.TRANSCRIPTION_FAILED, true);
      return;
    }

    this.mediaRecorder = recorder;
    let handledError = false;

    recorder.ondataavailable = (event: BlobEvent) => {
      if (event.data && event.data.size > 0) {
        this.audioChunks.push(event.data);
      }
    };

    recorder.onerror = (event: Event) => {
      console.warn('[SpeechInputService] MediaRecorder error:', event);
      handledError = true;
      this.cleanupRecordingResources();
      this.announce(VOICE_ANNOUNCEMENTS.TRANSCRIPTION_FAILED, true);
    };

    recorder.onstop = () => {
      const chunks = this.audioChunks;
      const mimeType =
        recorder.mimeType ||
        chosenMimeType ||
        chunks.find((c) => c.type)?.type ||
        'audio/mp4';
      this.cleanupRecordingResources();
      if (handledError) {
        return;
      }
      void this.transcribeRecordedAudio(chunks, mimeType);
    };

    try {
      recorder.start();
    } catch (err) {
      console.warn('[SpeechInputService] Failed to start MediaRecorder:', err);
      this.cleanupRecordingResources();
      this.announce(VOICE_ANNOUNCEMENTS.TRANSCRIPTION_FAILED, true);
      return;
    }

    this.isStarting = false;
    this.isListening.set(true);
    this.announce(VOICE_ANNOUNCEMENTS.LISTENING, false);

    this.clearMaxDurationTimer();
    this.maxDurationTimer = setTimeout(() => {
      this.stopListening();
    }, MAX_RECORDING_DURATION_MS);
  }

  stopListening(): void {
    this.clearMaxDurationTimer();

    if (this.isStarting) {
      this.cancelPendingStart = true;
      return;
    }

    const recorder = this.mediaRecorder;
    if (recorder && recorder.state !== 'inactive') {
      try {
        recorder.stop();
        return;
      } catch (err) {
        console.warn('[SpeechInputService] Failed to stop MediaRecorder:', err);
      }
    }

    this.cleanupRecordingResources();
  }

  ngOnDestroy(): void {
    if (this.announcementTimer !== null) {
      clearTimeout(this.announcementTimer);
      this.announcementTimer = null;
    }
    this.cancelPendingStart = true;
    const recorder = this.mediaRecorder;
    if (recorder) {
      recorder.ondataavailable = null;
      recorder.onerror = null;
      recorder.onstop = null;
      if (recorder.state !== 'inactive') {
        try {
          recorder.stop();
        } catch {
          // Ignore errors during teardown
        }
      }
    }
    this.cleanupRecordingResources();
  }

  private async transcribeRecordedAudio(
    chunks: Blob[],
    mimeType: string
  ): Promise<void> {
    const audioBlob = new Blob(chunks, { type: mimeType });
    if (audioBlob.size === 0) {
      this.announce(VOICE_ANNOUNCEMENTS.TRANSCRIPTION_FAILED, true);
      return;
    }

    this.isTranscribing.set(true);
    this.announce(VOICE_ANNOUNCEMENTS.TRANSCRIBING, true);

    try {
      const base64Audio = await blobToBase64(audioBlob);
      if (!base64Audio) {
        this.announce(VOICE_ANNOUNCEMENTS.TRANSCRIPTION_FAILED, true);
        return;
      }

      const transcript = (
        await this.aiProvider.transcribeAudio(base64Audio, mimeType)
      ).trim();

      if (!transcript) {
        this.announce(VOICE_ANNOUNCEMENTS.TRANSCRIPTION_FAILED, true);
        return;
      }

      this.isTranscribing.set(false);
      this.announce(transcript, false);
      this.transcriptionSubject.next(transcript);
    } catch (err) {
      console.warn('[SpeechInputService] Gemini transcription failed:', err);
      this.announce(VOICE_ANNOUNCEMENTS.TRANSCRIPTION_FAILED, true);
    } finally {
      this.isTranscribing.set(false);
    }
  }

  private announce(message: string, alsoSpeak: boolean): void {
    if (this.announcementTimer !== null) {
      clearTimeout(this.announcementTimer);
      this.announcementTimer = null;
    }

    if (this.statusAnnouncement() === message) {
      // Briefly clear so screen readers (e.g. VoiceOver) re-announce repeated messages.
      this.statusAnnouncement.set('');
      this.announcementTimer = setTimeout(() => {
        this.announcementTimer = null;
        this.statusAnnouncement.set(message);
      }, 30);
    } else {
      this.statusAnnouncement.set(message);
    }

    if (alsoSpeak) {
      this.speechOutputService.speak(message, true);
    }
  }

  private clearMaxDurationTimer(): void {
    if (this.maxDurationTimer !== null) {
      clearTimeout(this.maxDurationTimer);
      this.maxDurationTimer = null;
    }
  }

  private stopStreamTracks(stream: MediaStream | null = this.activeStream): void {
    if (stream) {
      for (const track of stream.getTracks()) {
        try {
          track.stop();
        } catch {
          // Ignore errors stopping already-ended tracks
        }
      }
    }
    if (stream === this.activeStream) {
      this.activeStream = null;
    }
  }

  private cleanupRecordingResources(): void {
    this.clearMaxDurationTimer();
    this.stopStreamTracks();
    this.mediaRecorder = null;
    this.audioChunks = [];
    this.isListening.set(false);
    this.isStarting = false;
  }
}
