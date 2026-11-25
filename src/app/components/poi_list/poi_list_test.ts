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

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { vi } from 'vitest';
import { PoiListComponent } from './poi_list';
import { StateService } from '../../services/state_service';
import { SpeechOutputService } from '../../services/speech_output_service';
import { safeStorage } from '../../services/safe_storage';

describe('PoiListComponent', () => {
  let component: PoiListComponent;
  let fixture: ComponentFixture<PoiListComponent>;
  let stateService: StateService;
  let speechOutputService: SpeechOutputService;

  beforeEach(async () => {
    safeStorage.clear();
    await TestBed.configureTestingModule({
      imports: [PoiListComponent],
      providers: [provideHttpClient()]
    })
    .compileComponents();

    stateService = TestBed.inject(StateService);
    speechOutputService = TestBed.inject(SpeechOutputService);
    fixture = TestBed.createComponent(PoiListComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('limits displayed POIs to 3 by default and respects maxPoiItems', () => {
    const rel = { side: 'LEFT' as const, depth: 'FRONT' as const };
    stateService.setMetadata({
      nearbyPOIs: [
        { name: 'Place 1', vicinity: '1st Ave', location: { latitude: 0, longitude: 0 }, types: ['store'], relativePosition: rel },
        { name: 'Place 2', vicinity: '2nd Ave', location: { latitude: 0, longitude: 0 }, types: ['store'], relativePosition: rel },
        { name: 'Place 3', vicinity: '3rd Ave', location: { latitude: 0, longitude: 0 }, types: ['store'], relativePosition: rel },
        { name: 'Place 4', vicinity: '4th Ave', location: { latitude: 0, longitude: 0 }, types: ['store'], relativePosition: rel },
        { name: 'Place 5', vicinity: '5th Ave', location: { latitude: 0, longitude: 0 }, types: ['store'], relativePosition: rel },
      ],
    });
    fixture.detectChanges();

    const itemsDefault = fixture.nativeElement.querySelectorAll('button[mat-list-item]');
    expect(itemsDefault.length).toBe(3);

    stateService.setMaxPoiItems(5);
    fixture.detectChanges();
    const itemsFive = fixture.nativeElement.querySelectorAll('button[mat-list-item]');
    expect(itemsFive.length).toBe(5);
  });

  it('announces place name, type, direction, and distance when a POI button is tapped', () => {
    const speakSpy = vi.spyOn(speechOutputService, 'speak').mockImplementation(() => {});
    stateService.updateLocation(47.614, -122.342, 'img-1', 'node-1', 'ok');
    stateService.setMetadata({
      nearbyPOIs: [
        {
          name: 'Caffe Vita',
          vicinity: '2100 5th Ave',
          location: { latitude: 47.6143, longitude: -122.342 },
          types: ['point_of_interest', 'coffee_shop'],
          relativePosition: { side: 'RIGHT', depth: 'FRONT' },
        },
      ],
    });
    fixture.detectChanges();

    const btn = fixture.nativeElement.querySelector('button[mat-list-item]') as HTMLButtonElement;
    expect(btn).toBeTruthy();
    btn.click();

    expect(speakSpy).toHaveBeenCalledTimes(1);
    const spoken = speakSpy.mock.calls[0][0];
    expect(spoken).toContain('Caffe Vita');
    expect(spoken).toContain('coffee shop');
    expect(spoken).toContain('front right');
    expect(spoken).toMatch(/\d+\s+meters? away/);
  });

  it('shows loading message instead of empty state while street view is loading', () => {
    stateService.setLoading(true);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Loading street view, please wait');
    expect(fixture.nativeElement.textContent).not.toContain('No points of interest detected nearby');

    stateService.setLoading(false);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('No points of interest detected nearby');
  });
});
