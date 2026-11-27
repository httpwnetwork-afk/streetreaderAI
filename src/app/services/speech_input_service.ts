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

import { Injectable, inject, signal } from '@angular/core';
import { Subject } from 'rxjs';
import { ToastService } from './toast_service';
import { SpeechOutputService } from './speech_output_service';


interface SpeechRecognitionResult {
  readonly [index: number]: SpeechRecognitionAlternative;
  readonly length: number;
}

interface SpeechRecognitionAlternative {
  readonly transcript: string;
  readonly confidence: number;
}

interface SpeechRecognitionResultList {
  readonly [index: number]: SpeechRecognitionResult;
  readonly length: number;
}

interface SpeechRecognitionEvent extends Event {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultList;
}

interface SpeechRecognitionErrorEvent extends Event {
  readonly error: string;
  readonly message: string;
}

interface ISpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onstart: (() => void) | null;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  start(): void;
  stop(): void;
}

interface SpeechRecognitionConstructor {
  new (): ISpeechRecognition;
}

interface WindowWithSpeech extends Window {
  SpeechRecognition?: SpeechRecognitionConstructor;
  webkitSpeechRecognition?: SpeechRecognitionConstructor;
  AudioContext?: typeof AudioContext;
  webkitAudioContext?: typeof AudioContext;
}

@Injectable({
  providedIn: 'root'
})
export class SpeechInputService {
  private toastService = inject(ToastService);
  private speechOutputService = inject(SpeechOutputService);

  private recognition?: ISpeechRecognition;
  private isListening = signal(false);
  private transcriptionSubject = new Subject<string>();

  readonly listening = this.isListening.asReadonly();
  readonly transcription$ = this.transcriptionSubject.asObservable();

  private ensureRecognition(): ISpeechRecognition | undefined {
    if (this.recognition) {
      return this.recognition;
    }
    if (typeof window === 'undefined') {
      return undefined;
    }
    const SpeechRecognition =
      (window as unknown as WindowWithSpeech).SpeechRecognition ||
      (window as unknown as WindowWithSpeech).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      const msg = 'Voice commands are not supported in this browser.';
      console.warn(`[SpeechService] ${msg}`);
      this.toastService.show(msg);
      this.speechOutputService.speak(msg, true);
      return undefined;
    }

    this.recognition = new SpeechRecognition();
    this.recognition.continuous = false;
    this.recognition.interimResults = false;
    this.recognition.lang = 'en-US';

    this.recognition.onstart = () => {
      this.isListening.set(true);
      void this.playBeep();
    };

    this.recognition.onresult = (event: SpeechRecognitionEvent) => {
      const transcript = event.results[0][0].transcript;
      this.transcriptionSubject.next(transcript);
    };

    this.recognition.onend = () => {
      this.isListening.set(false);
    };

    this.recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      this.isListening.set(false);
      console.warn(`[SpeechService] Recognition error: ${event.error}`);
      const msg = this.describeRecognitionError(event.error);
      if (msg) {
        this.toastService.show(msg);
        this.speechOutputService.speak(msg, true);
      }
    };

    return this.recognition;
  }

  private describeRecognitionError(error: string): string | null {
    switch (error) {
      case 'not-allowed':
      case 'service-not-allowed':
        return 'Microphone access was denied. Please allow microphone permission in your browser settings to use voice commands.';
      case 'audio-capture':
        return 'No microphone was found. Please check your microphone and try again.';
      case 'no-speech':
        return 'No speech was detected. Please try again.';
      case 'network':
        return 'Speech recognition network error. Please try again.';
      case 'aborted':
        return null;
      default:
        return 'Voice recognition failed. Please try again.';
    }
  }

  startListening() {
    if (this.isListening()) return;
    const recognition = this.ensureRecognition();
    if (!recognition) return;

    try {
      recognition.start();
    } catch (err) {
      console.warn('[SpeechService] Failed to start recognition:', err);
      this.isListening.set(false);
    }
  }

  stopListening() {
    if (this.recognition && this.isListening()) {
      this.recognition.stop();
    }
  }

  private playBeep(): Promise<void> {
    return new Promise((resolve) => {
      try {
        const AudioContextClass = (window as unknown as WindowWithSpeech).AudioContext || 
                                  (window as unknown as WindowWithSpeech).webkitAudioContext;
        if (!AudioContextClass) {
          throw new Error('AudioContext not supported');
        }
        const audioCtx = new AudioContextClass();
        const oscillator = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(audioCtx.destination);

        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(440, audioCtx.currentTime);
        gainNode.gain.setValueAtTime(0.1, audioCtx.currentTime);

        oscillator.start();
        oscillator.stop(audioCtx.currentTime + 0.1);

        oscillator.onended = () => {
          audioCtx.close();
          resolve();
        };
      } catch (e) {
        console.warn('Could not play beep sound for speech input.', e);
        resolve(); // Resolve anyway so speech can continue
      }
    });
  }
}
