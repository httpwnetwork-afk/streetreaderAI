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

import { Component, inject, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatListModule } from '@angular/material/list';
import { MatIconModule } from '@angular/material/icon';
import { StateService } from '../../services/state_service';
import { SpeechOutputService } from '../../services/speech_output_service';
import { AppController } from '../../services/app_controller';
import { NearbyPlace } from '../../services/api_service';
import { calculateDistance } from '../../services/location_provider_service';

const GENERIC_POI_TYPES = new Set(['point_of_interest', 'establishment', 'premise']);

@Component({
  selector: 'app-poi-list',
  standalone: true,
  imports: [CommonModule, MatListModule, MatIconModule],
  templateUrl: './poi_list.html',
  styleUrl: './poi_list.css',
})
export class PoiListComponent {
  private stateService = inject(StateService);
  private speechOutputService = inject(SpeechOutputService);
  private appController = inject(AppController);

  protected pois = computed(() =>
    this.stateService.state().nearbyPOIs.slice(0, this.stateService.maxPoiItems())
  );

  protected isLoadingView = computed(() => {
    const state = this.stateService.state();
    if (state.isLoading) return true;
    if (!state.currentImage && this.appController.activity() === 'TRAVELING') return true;
    return state.isLoadingPois && state.nearbyPOIs.length === 0;
  });

  protected getRelativePosition(poi: NearbyPlace): string {
    if (!poi.relativePosition) return 'unknown position';
    const { side, depth } = poi.relativePosition;
    return `${depth} ${side}`.toLowerCase();
  }

  protected getPoiType(poi: NearbyPlace): string {
    const primary =
      poi.types?.find((t) => t && !GENERIC_POI_TYPES.has(t.toLowerCase())) ||
      poi.types?.[0];
    if (primary) {
      return primary.replace(/_/g, ' ');
    }
    return poi.vicinity || 'place';
  }

  protected getDistanceMeters(poi: NearbyPlace): number | null {
    if (
      !poi.location ||
      !Number.isFinite(poi.location.latitude) ||
      !Number.isFinite(poi.location.longitude)
    ) {
      return null;
    }
    const loc = this.stateService.currentLocation();
    return Math.round(
      calculateDistance(loc.lat, loc.lng, poi.location.latitude, poi.location.longitude)
    );
  }

  protected formatPoiAnnouncement(poi: NearbyPlace): string {
    const type = this.getPoiType(poi);
    const direction = this.getRelativePosition(poi);
    const dist = this.getDistanceMeters(poi);
    let distText = '';
    if (dist !== null) {
      if (dist < 1) {
        distText = ', less than 1 meter away';
      } else if (dist === 1) {
        distText = ', 1 meter away';
      } else {
        distText = `, ${dist} meters away`;
      }
    }
    return `${poi.name}, ${type}, ${direction}${distText}.`;
  }

  protected announcePoi(poi: NearbyPlace): void {
    this.speechOutputService.speak(this.formatPoiAnnouncement(poi), true);
  }

  protected getIcon(types: string[]): string {
    if (types.includes('restaurant') || types.includes('food')) return 'restaurant';
    if (types.includes('park')) return 'park';
    if (types.includes('store')) return 'shopping_cart';
    if (types.includes('bus_station') || types.includes('transit_station')) return 'directions_bus';
    if (types.includes('landmark')) return 'account_balance';
    return 'place';
  }
}
