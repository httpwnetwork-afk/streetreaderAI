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

import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { vi } from 'vitest';
import {
  MAX_RECORDING_DURATION_MS,
  SpeechInputService,
  VOICE_ANNOUNCEMENTS,
} from './speech_input_service';
import { AiProviderService } from './ai_provider_service';
import { ConfigService } from './config_service';
import { SpeechOutputService } from './speech_output_service';
import { ToastService } from './toast_service';
import { CommandService } from './command_service';
import { ChatComponent } from '../components/chat/chat';

interface MockTrack {
  stop: ReturnType<typeof vi.fn>;
}

class FakeMediaRecorder {
  static supportedTypes = new Set<string>(['audio/webm;codecs=opus']);
  static instances: FakeMediaRecorder[] = [];
  static nextChunks: Blob[] = [new Blob(['hello audio'], { type: 'audio/webm' })];

  static isTypeSupported(mimeType: string): boolean {
    return FakeMediaRecorder.supportedTypes.has(mimeType);
  }

  readonly stream: MediaStream;
  readonly mimeType: string;
  state: 'inactive' | 'recording' | 'paused' = 'inactive';
  ondataavailable: ((event: BlobEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onstop: (() => void) | null = null;

  constructor(stream: MediaStream, options?: MediaRecorderOptions) {
    this.stream = stream;
    this.mimeType = options?.mimeType || 'audio/mp4';
    FakeMediaRecorder.instances.push(this);
  }

  start(): void {
    this.state = 'recording';
  }

  stop(): void {
    if (this.state === 'inactive') return;
    this.state = 'inactive';
    for (const chunk of FakeMediaRecorder.nextChunks) {
      this.ondataavailable?.({ data: chunk } as BlobEvent);
    }
    this.onstop?.();
  }

  triggerError(): void {
    this.state = 'inactive';
    this.onerror?.(new Event('error'));
  }
}

async function flushMicrotasks(rounds: number = 8): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await Promise.resolve();
  }
}

describe('SpeechInputService (Gemini audio transcription)', () => {
  let service: SpeechInputService;
  let aiProvider: AiProviderService;
  let configService: ConfigService;
  let speechOutput: SpeechOutputService;
  let toastService: ToastService;
  let tracks: MockTrack[];
  let getUserMediaMock: ReturnType<typeof vi.fn>;

  const originalMediaDevices = navigator.mediaDevices;
  const originalMediaRecorder = (globalThis as Record<string, unknown>)['MediaRecorder'];

  function createMockStream(): MediaStream {
    const t1: MockTrack = { stop: vi.fn() };
    const t2: MockTrack = { stop: vi.fn() };
    tracks = [t1, t2];
    return {
      getTracks: () => tracks,
    } as unknown as MediaStream;
  }

  beforeEach(async () => {
    FakeMediaRecorder.instances = [];
    FakeMediaRecorder.supportedTypes = new Set(['audio/webm;codecs=opus']);
    FakeMediaRecorder.nextChunks = [
      new Blob(['hello audio'], { type: 'audio/webm;codecs=opus' }),
    ];

    getUserMediaMock = vi.fn().mockImplementation(async () => createMockStream());
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getUserMedia: getUserMediaMock },
      configurable: true,
    });
    (globalThis as Record<string, unknown>)['MediaRecorder'] = FakeMediaRecorder;

    await TestBed.configureTestingModule({
      imports: [ChatComponent],
      providers: [provideHttpClient()],
    }).compileComponents();

    configService = TestBed.inject(ConfigService);
    configService.applyConfText(`
[system]
ai_provider = gemini

[keys]
gemini_api_key = __SERVER_KEY_ENV:gemini_api_key__

[ai.gemini]
requires_key = gemini_api_key
wire_format = gemini
model_id = gemini-3.5-flash-lite
endpoint_url = https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={apiKey}
    `);

    aiProvider = TestBed.inject(AiProviderService);
    speechOutput = TestBed.inject(SpeechOutputService);
    speechOutput.setEnabled(false); // Simulate VoiceOver-only (self-voicing OFF)
    toastService = TestBed.inject(ToastService);
    service = TestBed.inject(SpeechInputService);
  });

  afterEach(() => {
    service.ngOnDestroy();
    vi.useRealTimers();
    Object.defineProperty(navigator, 'mediaDevices', {
      value: originalMediaDevices,
      configurable: true,
    });
    (globalThis as Record<string, unknown>)['MediaRecorder'] = originalMediaRecorder;
  });

  it('picks Safari audio/mp4 fallback, transcribes via Gemini generateContent, and auto-submits in ChatComponent with aria-live announcements', async () => {
    FakeMediaRecorder.supportedTypes = new Set(['audio/mp4']);
    FakeMediaRecorder.nextChunks = [new Blob(['safari aac bytes'], { type: 'audio/mp4' })];

    const fetchJsonSpy = vi.spyOn(configService, 'fetchJson').mockResolvedValue({
      candidates: [
        {
          content: {
            parts: [{ text: 'What storefronts are ahead of me?' }],
          },
        },
      ],
    });
    const toastSpy = vi.spyOn(toastService, 'show');
    const commandService = TestBed.inject(CommandService);
    const cmdSpy = vi.spyOn(commandService, 'execute');

    const fixture = TestBed.createComponent(ChatComponent);
    fixture.detectChanges();

    const liveRegion = fixture.nativeElement.querySelector(
      '.voice-status-live'
    ) as HTMLElement;
    const micBtn = fixture.nativeElement.querySelector(
      'button[aria-pressed]'
    ) as HTMLButtonElement;

    expect(liveRegion.getAttribute('aria-live')).toBe('polite');
    expect(micBtn.getAttribute('aria-pressed')).toBe('false');
    expect(micBtn.getAttribute('aria-label')).toBe('Start voice command');

    // Start recording via mic button
    micBtn.click();
    await flushMicrotasks();
    fixture.detectChanges();

    expect(getUserMediaMock).toHaveBeenCalledWith({ audio: true });
    expect(FakeMediaRecorder.instances.length).toBe(1);
    expect(FakeMediaRecorder.instances[0].mimeType).toBe('audio/mp4');
    expect(service.listening()).toBe(true);
    expect(micBtn.getAttribute('aria-pressed')).toBe('true');
    expect(micBtn.getAttribute('aria-label')).toBe('Stop recording');
    expect(liveRegion.textContent?.trim()).toBe(VOICE_ANNOUNCEMENTS.LISTENING);

    // Stop recording via mic button
    micBtn.click();
    fixture.detectChanges();

    // MediaStream tracks must be stopped immediately
    expect(tracks.every((t) => t.stop.mock.calls.length === 1)).toBe(true);
    expect(service.listening()).toBe(false);
    expect(service.transcribing()).toBe(true);
    expect(liveRegion.textContent?.trim()).toBe(VOICE_ANNOUNCEMENTS.TRANSCRIBING);
    expect(micBtn.disabled).toBe(true);

    // Wait for FileReader + Gemini transcription
    await vi.waitFor(() => {
      expect(service.transcribing()).toBe(false);
      expect(cmdSpy).toHaveBeenCalledWith({
        type: 'EXECUTE_AI_ACTION',
        payload: 'What storefronts are ahead of me?',
      });
    });
    fixture.detectChanges();

    // Verify Gemini generateContent request payload & model
    expect(fetchJsonSpy).toHaveBeenCalledTimes(1);
    const [label, url, init] = fetchJsonSpy.mock.calls[0];
    expect(label).toBe('gemini');
    expect(url).toContain('models/gemini-3.5-flash-lite:generateContent');
    const body = JSON.parse(String(init?.body));
    const parts = body.contents[0].parts;
    expect(parts[1].inlineData.mimeType).toBe('audio/mp4');
    expect(typeof parts[1].inlineData.data).toBe('string');
    expect(parts[1].inlineData.data.length).toBeGreaterThan(0);

    // Final aria-live announcement is the transcript itself, with no visual-only toasts
    expect(liveRegion.textContent?.trim()).toBe('What storefronts are ahead of me?');
    expect(toastSpy).not.toHaveBeenCalled();
  });

  it('strips codec parameters from inlineData mimeType when sending audio/webm;codecs=opus to Gemini', async () => {
    const fetchJsonSpy = vi.spyOn(configService, 'fetchJson').mockResolvedValue({
      candidates: [{ content: { parts: [{ text: 'Turn left' }] } }],
    });

    const transcripts: string[] = [];
    const sub = service.transcription$.subscribe((t) => transcripts.push(t));

    await service.startListening();
    expect(FakeMediaRecorder.instances[0].mimeType).toBe('audio/webm;codecs=opus');

    service.stopListening();
    await vi.waitFor(() => expect(transcripts).toEqual(['Turn left']));
    sub.unsubscribe();

    const [, , init] = fetchJsonSpy.mock.calls[0];
    const body = JSON.parse(String(init?.body));
    expect(body.contents[0].parts[1].inlineData.mimeType).toBe('audio/webm');
  });

  it('announces Microphone not allowed on permission denial without toasts', async () => {
    const deniedErr = Object.assign(new Error('Permission denied'), {
      name: 'NotAllowedError',
    });
    getUserMediaMock.mockRejectedValueOnce(deniedErr);
    const toastSpy = vi.spyOn(toastService, 'show');

    await service.startListening();

    expect(service.listening()).toBe(false);
    expect(service.transcribing()).toBe(false);
    expect(service.announcement()).toBe(VOICE_ANNOUNCEMENTS.MIC_DENIED);
    expect(toastSpy).not.toHaveBeenCalled();
  });

  it('announces failure message on empty transcript or Gemini error and stops all tracks', async () => {
    vi.spyOn(aiProvider, 'transcribeAudio').mockResolvedValue('   ');
    const transcripts: string[] = [];
    const sub = service.transcription$.subscribe((t) => transcripts.push(t));

    await service.startListening();
    service.stopListening();

    await vi.waitFor(() => {
      expect(service.transcribing()).toBe(false);
      expect(service.announcement()).toBe(VOICE_ANNOUNCEMENTS.TRANSCRIPTION_FAILED);
    });
    expect(tracks.every((t) => t.stop.mock.calls.length === 1)).toBe(true);
    expect(transcripts).toEqual([]);

    // Also test rejected Gemini call
    vi.spyOn(aiProvider, 'transcribeAudio').mockRejectedValue(new Error('503 Unavailable'));
    await service.startListening();
    service.stopListening();

    await vi.waitFor(() => {
      expect(service.transcribing()).toBe(false);
      expect(service.announcement()).toBe(VOICE_ANNOUNCEMENTS.TRANSCRIPTION_FAILED);
    });
    expect(tracks.every((t) => t.stop.mock.calls.length === 1)).toBe(true);
    sub.unsubscribe();
  });

  it('auto-stops recording after 60 seconds and stops all tracks', async () => {
    vi.useFakeTimers();
    const transcribeSpy = vi
      .spyOn(aiProvider, 'transcribeAudio')
      .mockResolvedValue('Describe this block');

    await service.startListening();
    expect(service.listening()).toBe(true);

    await vi.advanceTimersByTimeAsync(MAX_RECORDING_DURATION_MS);

    expect(service.listening()).toBe(false);
    expect(tracks.every((t) => t.stop.mock.calls.length === 1)).toBe(true);
    expect(service.transcribing()).toBe(true);

    // Let JSDOM FileReader's internal timer complete while fake timers are active
    await vi.advanceTimersByTimeAsync(50);
    expect(transcribeSpy).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('guards against double-start and starting while transcribing', async () => {
    let resolveTranscribe: ((value: string) => void) | undefined;
    vi.spyOn(aiProvider, 'transcribeAudio').mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          resolveTranscribe = resolve;
        })
    );

    // Concurrent double-start while getUserMedia is pending
    const p1 = service.startListening();
    const p2 = service.startListening();
    await Promise.all([p1, p2]);
    expect(getUserMediaMock).toHaveBeenCalledTimes(1);

    // Start while already listening
    await service.startListening();
    expect(getUserMediaMock).toHaveBeenCalledTimes(1);

    // Stop to enter transcribing state
    service.stopListening();
    expect(service.transcribing()).toBe(true);

    // Start while transcribing must be ignored
    await service.startListening();
    expect(getUserMediaMock).toHaveBeenCalledTimes(1);

    await vi.waitFor(() => expect(resolveTranscribe).toBeTypeOf('function'));
    resolveTranscribe!('Is there a crosswalk?');
    await vi.waitFor(() => expect(service.transcribing()).toBe(false));
  });

  it('stops all tracks and announces failure when MediaRecorder errors', async () => {
    await service.startListening();
    FakeMediaRecorder.instances[0].triggerError();

    expect(service.listening()).toBe(false);
    expect(tracks.every((t) => t.stop.mock.calls.length === 1)).toBe(true);
    expect(service.announcement()).toBe(VOICE_ANNOUNCEMENTS.TRANSCRIPTION_FAILED);
  });
});
