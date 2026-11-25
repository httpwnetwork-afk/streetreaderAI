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

import { SceneDescriptionComponent } from './scene_description';
import { StateService } from '../../services/state_service';

describe('SceneDescriptionComponent', () => {
  let component: SceneDescriptionComponent;
  let fixture: ComponentFixture<SceneDescriptionComponent>;
  let stateService: StateService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SceneDescriptionComponent],
      providers: [provideHttpClient()]
    })
    .compileComponents();

    stateService = TestBed.inject(StateService);
    fixture = TestBed.createComponent(SceneDescriptionComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('shows loading message instead of No description available while street view is loading', () => {
    stateService.setLoading(true);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Loading street view, please wait');
    expect(fixture.nativeElement.textContent).not.toContain('No description available');

    stateService.setLoading(false);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('No description available');
  });
});
