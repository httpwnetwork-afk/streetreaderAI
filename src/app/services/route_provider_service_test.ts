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
import { vi } from 'vitest';
import { clearAllClientCaches, queryAudit } from './client_cache';
import {
  ImageryProviderService,
  LocationMetadata,
  normalizeRawImageId,
} from './imagery_provider_service';
import { ConfigService } from './config_service';
import { LocationProviderService } from './location_provider_service';
import {
  extractPoisFromOsmElements,
  osmPoiTileCache,
  OsmWayElement,
  RoadDataService,
} from './road_data_service';
import {
  AreaSnapshot,
  normStreet,
  pickSeed,
  placeNode,
  RoadNetwork,
  RouteProviderService,
} from './route_provider_service';

describe('5-Step RouteProvider Engine (Client-Side)', () => {
  const sampleWays: OsmWayElement[] = [
    {
      id: 100,
      nodes: [1, 2],
      tags: { name: 'N 34th St', highway: 'secondary' },
      geometry: [
        { lat: 47.649, lon: -122.351 },
        { lat: 47.649, lon: -122.35 },
      ],
    },
    {
      id: 101,
      nodes: [1, 3],
      tags: { name: 'Fremont Ave N', highway: 'secondary' },
      geometry: [
        { lat: 47.649, lon: -122.351 },
        { lat: 47.6498, lon: -122.351 },
      ],
    },
    {
      id: 102,
      nodes: [2, 4],
      tags: { name: 'Troll Ave N', highway: 'residential' },
      geometry: [
        { lat: 47.649, lon: -122.35 },
        { lat: 47.6498, lon: -122.35 },
      ],
    },
  ];

  const sequenceFrames: LocationMetadata[] = [
    {
      imageId: 'f1',
      coordinates: { latitude: 47.649, longitude: -122.351 },
      captureTime: '1000',
      heading: 90,
      isPano: true,
      sequenceId: 'seqA',
    },
    {
      imageId: 'f2',
      coordinates: { latitude: 47.649, longitude: -122.35075 },
      captureTime: '1001',
      heading: 90,
      isPano: true,
      sequenceId: 'seqA',
    },
    {
      imageId: 'f3',
      coordinates: { latitude: 47.649, longitude: -122.3505 },
      captureTime: '1002',
      heading: 90,
      isPano: true,
      sequenceId: 'seqA',
    },
    {
      imageId: 'f4',
      coordinates: { latitude: 47.649, longitude: -122.35025 },
      captureTime: '1003',
      heading: 90,
      isPano: true,
      sequenceId: 'seqA',
    },
    {
      imageId: 'f5',
      coordinates: { latitude: 47.649, longitude: -122.35 },
      captureTime: '1004',
      heading: 90,
      isPano: true,
      sequenceId: 'seqA',
    },
  ];

  beforeEach(() => {
    clearAllClientCaches();
    osmPoiTileCache.clear();
  });

  it('normalizes street names and strips leading house numbers', () => {
    expect(normStreet('601 N 34th St.')).toBe('north 34th street');
    expect(normStreet('Fremont Ave N')).toBe('fremont avenue north');
  });

  it('identifies intersections, slices sequences across blocks, and builds bidirectional chains', async () => {
    const rn = new RoadNetwork();
    rn.addWays(sampleWays);

    const snap = new AreaSnapshot(rn, sequenceFrames);
    await snap.solve();

    expect(snap.clusters.has(1)).toBe(true);
    expect(snap.clusters.has(2)).toBe(true);
    expect(snap.adjacentPairs.get('1:2')?.streetName).toBe('N 34th St');

    const node1 = await placeNode(snap, 'osm_1');
    const node2 = await placeNode(snap, 'osm_2');
    expect(node1).toBeTruthy();
    expect(node2).toBeTruthy();
    expect(node1?.image?.imageId).toBe('f1');
    expect(node2?.image?.imageId).toBe('f5');

    const linksFrom1 = snap.adj.get('osm_1') || [];
    expect(linksFrom1.length).toBe(1);
    expect(linksFrom1[0].streetName).toBe('N 34th St');

    // Walk the chain from osm_1 to osm_2
    const pass = snap.chosenPasses.get('1:2');
    expect(pass).toBeTruthy();
    const chainIds = (pass?.chain || []).map((n) => n.nodeId);
    expect(chainIds[0]).toBe('osm_1');
    expect(chainIds[chainIds.length - 1]).toBe('osm_2');
    expect(chainIds.length).toBeGreaterThanOrEqual(3);
  });

  it('picks a seed matching a street hint when available', async () => {
    const rn = new RoadNetwork();
    rn.addWays(sampleWays);
    const snap = new AreaSnapshot(rn, sequenceFrames);

    const seed = await pickSeed(snap, 47.649, -122.3505, '601 N 34th St');
    expect(seed).toBeTruthy();
    expect(seed?.place.image).toBeTruthy();
  });

  it('extracts node and building way POIs from OSM map.json elements and serves them from tile cache without extra HTTP calls', async () => {
    const rawElements: Record<string, unknown>[] = [
      { type: 'node', id: 10, lat: 47.6491, lon: -122.3508 },
      { type: 'node', id: 11, lat: 47.6493, lon: -122.3506 },
      {
        type: 'node',
        id: 20,
        lat: 47.64915,
        lon: -122.3505,
        tags: { name: 'Moment Coffee', amenity: 'cafe' },
      },
      {
        type: 'way',
        id: 30,
        nodes: [10, 11],
        tags: { name: 'PCC Community Markets', shop: 'supermarket' },
      },
      {
        type: 'way',
        id: 40,
        nodes: [10, 11],
        tags: { name: 'N 34th St', highway: 'secondary' },
      },
    ];

    const extracted = extractPoisFromOsmElements(rawElements);
    expect(extracted.length).toBe(2);
    expect(extracted.map((p) => p.name)).toEqual([
      'Moment Coffee',
      'PCC Community Markets',
    ]);

    // Populate the tile POI cache as OsmMapApiRoadSource does when loading road geometry
    osmPoiTileCache.put('tile1', {
      minLat: 47.645,
      minLng: -122.355,
      maxLat: 47.653,
      maxLng: -122.345,
      pois: extracted,
    });

    TestBed.configureTestingModule({});
    const locService = TestBed.inject(LocationProviderService);
    const res = await locService.getNearbyPlaces({
      lat: 47.64917,
      lng: -122.35046,
      radius: 100,
      heading: 270,
    });

    expect(res.places.length).toBe(2);
    expect(res.places[0].name).toBe('Moment Coffee');
    expect(res.places[0].relativePosition.depth).toBe('FRONT');
    // Zero external osm_nearby calls because the road tile cache covered it!
    expect(queryAudit.snapshot().external_calls['osm_nearby'] ?? 0).toBe(0);
    expect(queryAudit.snapshot().cache_hits['osm_nearby']).toBeGreaterThanOrEqual(1);
  });

  it('reuses the loaded OSM road tile snapshot across getPanoView, getLocalGraph, and adjacent movements', async () => {
    const fetchWaysSpy = vi
      .fn()
      .mockResolvedValue(sampleWays);

    TestBed.configureTestingModule({
      providers: [
        {
          provide: RoadDataService,
          useValue: { fetchWaysForTile: fetchWaysSpy },
        },
        {
          provide: ImageryProviderService,
          useValue: {
            providerName: 'panoramax',
            getMetadataBbox: vi.fn().mockResolvedValue(sequenceFrames),
            getSequence: vi.fn().mockResolvedValue(sequenceFrames),
            getImage: vi.fn().mockResolvedValue({
              image: 'base64jpeg',
              imageId: 'f1',
              actualHeading: 90,
            }),
          },
        },
      ],
    });

    const routeProvider = TestBed.inject(RouteProviderService);

    // 1. Initial landing at (47.6490, -122.3510)
    const view1 = await routeProvider.getPanoView({
      coordinates: { latitude: 47.649, longitude: -122.351 },
      heading: 90,
    });
    expect(view1.canonicalNodeId).toBe('osm_1');
    expect(fetchWaysSpy).toHaveBeenCalledTimes(1);

    // 2. RadarViewComponent requests local graph nearby
    const graph = await routeProvider.getLocalGraph(47.6495, -122.3505, 90);
    expect(graph.nodes.length).toBeGreaterThan(0);
    expect(fetchWaysSpy).toHaveBeenCalledTimes(1);

    // 3. Stepping along the street block to the next node
    const nextLink = view1.links![0];
    const view2 = await routeProvider.getPanoView({
      canonicalNodeId: nextLink.canonicalNodeId,
      coordinates: nextLink.coordinates,
      heading: nextLink.heading,
    });
    expect(view2.status).toBe('ok');
    // Still only 1 OSM road tile fetch for the entire neighborhood session!
    expect(fetchWaysSpy).toHaveBeenCalledTimes(1);
  });

  it('solves street blocks using a declarative retrieval_type=image / image_format=single provider in streetreaderai.conf', async () => {
    const pointPanos = [
      { pano_id: 'p1', location: { lat: 47.649, lng: -122.351 }, date: '2025-05' },
      { pano_id: 'p2', location: { lat: 47.649, lng: -122.35075 }, date: '2025-05' },
      { pano_id: 'p3', location: { lat: 47.649, lng: -122.3505 }, date: '2025-05' },
      { pano_id: 'p4', location: { lat: 47.649, lng: -122.35025 }, date: '2025-05' },
      { pano_id: 'p5', location: { lat: 47.649, lng: -122.35 }, date: '2025-05' },
    ];

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = new URL(String(input));
      const id = url.searchParams.get('id');
      if (id) {
        const match = pointPanos.find((p) => p.pano_id === id);
        return new Response(JSON.stringify(match || {}), { status: match ? 200 : 404 });
      }
      const lat = Number(url.searchParams.get('lat'));
      const lng = Number(url.searchParams.get('lng'));
      let best = pointPanos[0];
      let bestD = Infinity;
      for (const p of pointPanos) {
        const d = Math.hypot(p.location.lat - lat, p.location.lng - lng);
        if (d < bestD) {
          bestD = d;
          best = p;
        }
      }
      return new Response(JSON.stringify(best), { status: 200 });
    });

    try {
      TestBed.configureTestingModule({});
      const config = TestBed.inject(ConfigService);
      config.applyConfText(`
[system]
imagery_provider = point_test

[imagery.point_test]
retrieval_type = image
image_format = single
point_url = https://example.com/meta?lat={lat}&lng={lng}&r={radius}
metadata_url = https://example.com/meta?id={imageId}
image_url = https://example.com/img?id={imageId}&h={heading}&p={pitch}
id_field = pano_id
lat_field = location.lat
lng_field = location.lng
capture_time_field = date
      `);

      const imagery = TestBed.inject(ImageryProviderService);
      const rn = new RoadNetwork();
      rn.addWays(sampleWays);

      const snap = new AreaSnapshot(rn, [], imagery);
      await snap.solve(47.649, -122.351);

      const node1 = await placeNode(snap, 'osm_1');
      const node2 = await placeNode(snap, 'osm_2');
      expect(normalizeRawImageId(node1?.image?.imageId || '')).toBe('p1');
      expect(normalizeRawImageId(node2?.image?.imageId || '')).toBe('p5');

      const pass = snap.chosenPasses.get('1:2');
      expect(pass).toBeTruthy();
      expect((pass?.chain || []).length).toBeGreaterThanOrEqual(3);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('navigates Google Street View single-image mode by geocoding, point_url lookup, coordinate stepping, and zero-OSM minimap graph', async () => {
    const fetchWaysSpy = vi.fn().mockResolvedValue([]);

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = new URL(String(input));
      if (url.pathname.includes('/geocode/json')) {
        if (url.searchParams.get('address')) {
          return new Response(
            JSON.stringify({
              status: 'OK',
              results: [
                {
                  formatted_address: 'Times Square, New York, NY 10036, USA',
                  geometry: { location: { lat: 40.758, lng: -73.9855 } },
                },
              ],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        return new Response(
          JSON.stringify({
            status: 'OK',
            results: [
              {
                formatted_address: '1560 Broadway, New York, NY 10036, USA',
                geometry: { location: { lat: 40.7582, lng: -73.9855 } },
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url.pathname.endsWith('/streetview/metadata')) {
        const loc = url.searchParams.get('location') || '';
        const lat = Number(loc.split(',')[0]);
        const isStepped = lat > 40.7581;
        return new Response(
          JSON.stringify({
            status: 'OK',
            pano_id: isStepped ? 'gsv_nyc_2' : 'gsv_nyc_1',
            location: { lat: isStepped ? 40.7582 : 40.758, lng: -73.9855 },
            date: '2025-07',
            copyright: '© Google',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url.pathname.endsWith('/streetview')) {
        return new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), {
          status: 200,
          headers: { 'Content-Type': 'image/jpeg' },
        });
      }
      return new Response('{}', { status: 404 });
    });

    try {
      TestBed.configureTestingModule({
        providers: [
          {
            provide: RoadDataService,
            useValue: { fetchWaysForTile: fetchWaysSpy },
          },
        ],
      });

      const config = TestBed.inject(ConfigService);
      config.applyConfText(`
[system]
imagery_provider = google
location_provider = google

[keys]
google_maps_api_key = TestMapsKey
      `);

      const routeProvider = TestBed.inject(RouteProviderService);

      const view1 = await routeProvider.getPanoView({
        address: 'Times Square, New York, NY',
        heading: 0,
      });
      expect(view1.status).toBe('ok');
      expect(view1.imageId).toBe('gsv_nyc_1');
      expect(view1.isPano).toBe(false);
      expect(view1.copyright).toBe('© Google');
      expect(view1.address).toContain('Times Square');
      expect(fetchWaysSpy).not.toHaveBeenCalled();

      const view2 = await routeProvider.getPanoView({
        coordinates: view1.coordinates,
        heading: 0,
        stepBearing: 0,
        excludeImageId: view1.imageId,
      });
      expect(view2.status).toBe('ok');
      expect(view2.imageId).toBe('gsv_nyc_2');
      expect(view2.address).toContain('Broadway');

      const graph = await routeProvider.getLocalGraph(40.7582, -73.9855, 90);
      expect(graph.nodes.length).toBe(2);
      expect(fetchWaysSpy).not.toHaveBeenCalled();
    } finally {
      vi.restoreAllMocks();
    }
  });
});
