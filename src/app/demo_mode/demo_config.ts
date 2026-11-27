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

export interface DemoQuestion {
  /** Number key ('5' - '7') mapped to trigger this preset question. */
  key: string;
  /** Short badge label shown on the button. */
  label: string;
  /** Full natural-language question sent to the AI assistant. */
  question: string;
}

export interface DemoLocation {
  /** Number key ('1' - '4') mapped to jump to this preset location. */
  key: string;
  id: string;
  title: string;
  subtitle: string;
  address: string;
  latitude: number;
  longitude: number;
  heading: number;
  questions: DemoQuestion[];
}

export const GENERIC_QUESTIONS: DemoQuestion[] = [
  {
    key: '5',
    label: 'Storefronts & signs',
    question: 'What shops, restaurants, or signs are visible from here?',
  },
  {
    key: '6',
    label: 'Crosswalk & sidewalk',
    question: 'Is there a marked crosswalk, curb ramp, or obstacle on the sidewalk ahead?',
  },
  {
    key: '7',
    label: 'Street environment',
    question: 'Describe the buildings, trees, and street layout on this block.',
  },
];

export const DEMO_LOCATIONS: DemoLocation[] = [
  {
    key: '1',
    id: 'times-square-new-york',
    title: 'Times Square, New York',
    subtitle: 'Manhattan, NY 10036 · Broadway & 7th Avenue',
    address: 'Times Square, New York, NY 10036',
    latitude: 40.75797,
    longitude: -73.98554,
    heading: 20,
    questions: GENERIC_QUESTIONS,
  },
  {
    key: '2',
    id: 'gun-hill-road-white-plains-road-bronx',
    title: 'Gun Hill Road & White Plains Road, Bronx',
    subtitle: 'Bronx, New York · Elevated 2/5 line station',
    address: 'White Plains Rd & E Gun Hill Rd, Bronx, NY 10467',
    latitude: 40.87752,
    longitude: -73.86687,
    heading: 10,
    questions: GENERIC_QUESTIONS,
  },
  {
    key: '3',
    id: 'apollo-theatre-harlem',
    title: 'Apollo Theatre, Harlem',
    subtitle: 'New York, NY 10027 · 253 West 125th Street',
    address: '253 W 125th St, New York, NY 10027',
    latitude: 40.80972,
    longitude: -73.95010,
    heading: 0,
    questions: GENERIC_QUESTIONS,
  },
  {
    key: '4',
    id: 'one-world-trade-center-new-york',
    title: 'One World Trade Center, New York',
    subtitle: 'Manhattan, NY 10007 · Fulton St & Greenwich St',
    address: 'One World Trade Center, 285 Fulton St, New York, NY 10007',
    latitude: 40.71201,
    longitude: -74.01190,
    heading: 303,
    questions: GENERIC_QUESTIONS,
  },
];
