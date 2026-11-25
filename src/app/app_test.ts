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
import { App } from './app';
import { StateService } from './services/state_service';
import { CommandService } from './services/command_service';
import { ConfigService } from './services/config_service';
import { safeStorage } from './services/safe_storage';

describe('App', () => {
  beforeEach(async () => {
    safeStorage.clear();
    safeStorage.setItem('streetreader_show_welcome', 'false');
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideHttpClient()],
    }).compileComponents();

    const configService = TestBed.inject(ConfigService);
    vi.spyOn(configService, 'loadConfig').mockResolvedValue();
    vi.spyOn(configService, 'validateRequiredKeys').mockReturnValue(null);
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('exposes StreetReaderAI as an h1 heading and hides the road emoji from screen readers', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    const heading = fixture.nativeElement.querySelector('h1') as HTMLElement | null;
    expect(heading?.textContent?.trim()).toBe('StreetReaderAI');

    const emoji = fixture.nativeElement.querySelector('.app-logo-emoji') as HTMLElement | null;
    expect(emoji?.getAttribute('aria-hidden')).toBe('true');
  });

  it('renders the four Movement Keys as real buttons wired to movement commands', () => {
    const fixture = TestBed.createComponent(App);
    const commandService = TestBed.inject(CommandService);
    const execSpy = vi.spyOn(commandService, 'execute').mockImplementation(() => {});
    fixture.detectChanges();

    const expected: Array<{ label: string; command: string }> = [
      { label: 'Move forward', command: 'MOVE_FORWARD' },
      { label: 'Turn around 180 degrees', command: 'TURN_AROUND' },
      { label: 'Turn left 45 degrees', command: 'ROTATE_LEFT' },
      { label: 'Turn right 45 degrees', command: 'ROTATE_RIGHT' },
    ];

    for (const item of expected) {
      const btn = fixture.nativeElement.querySelector(
        `button[aria-label="${item.label}"]`
      ) as HTMLButtonElement | null;
      expect(btn).toBeTruthy();
      btn!.click();
      expect(execSpy).toHaveBeenCalledWith({ type: item.command });
    }
  });

  it('updates panorama alt text and minimap aria-label dynamically as street and heading change', () => {
    const fixture = TestBed.createComponent(App);
    const stateService = TestBed.inject(StateService);

    stateService.setImage('dGVzdA==');
    stateService.setMetadata({ address: '5th Avenue' });
    stateService.setHeading(135);
    fixture.detectChanges();

    const img = fixture.nativeElement.querySelector('img.panorama-image') as HTMLImageElement | null;
    expect(img).toBeTruthy();
    expect(img!.alt).toBe('Street view image at 5th Avenue, facing South East (135°)');

    const minimap = fixture.nativeElement.querySelector('.radar-card') as HTMLElement | null;
    expect(minimap?.getAttribute('role')).toBe('img');
    expect(minimap?.getAttribute('aria-label')).toBe('Mini map, heading south east on 5th Avenue');

    stateService.setMetadata({ address: 'Pike Street' });
    stateService.setHeading(270);
    fixture.detectChanges();

    expect(img!.alt).toBe('Street view image at Pike Street, facing West (270°)');
    expect(minimap?.getAttribute('aria-label')).toBe('Mini map, heading west on Pike Street');
  });
});
