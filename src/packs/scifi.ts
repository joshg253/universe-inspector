import { definePack, syllables } from './define';
import type { Palette } from './types';

export const SCIFI_PALETTE: Palette = {
  bg: '#1e1e22',
  star: { dim: '#e0643c', mid: '#f2d46a', bright: '#9cc8ff' },
  orbit: 'rgba(255,255,255,0.14)',
  terrain: {
    temperate: ['#1c3f7a', '#2c6bb0', '#d8cfa0', '#3f8f4a', '#6b7f3a', '#8a8a80', '#f2f2f2'],
    arid: ['#6b4a2a', '#a9743a', '#e0c080', '#d3a062', '#b8793f', '#8f5a30', '#e8d8c0'],
    frozen: ['#36527a', '#6a8cb5', '#dfeaf5', '#cfe0ee', '#b0c8de', '#e9f1f8', '#ffffff'],
    // Warm rock with a light floor: a dark flat grey lowland reads as sea next to pale highlands.
    barren: ['#3a332c', '#4a4238', '#5a5045', '#85766a', '#9a8a7a', '#b3a493', '#d6cabb'],
    gaseous: ['#c9a36a', '#b07f4a', '#e1c391', '#9c6a3f', '#d8b27c', '#a77646', '#efd9b0'],
  },
  ground: '#2f3a33',
  road: '#6e6e72',
  green: '#2f6a3a',
  plaza: '#8a8a90',
  water: '#1f4f86',
  dwelling: { home: '#8fa3b8', shop: '#d9a441', works: '#b5656a', mill: '#6fa070', quarry: '#9a9aa8', dock: '#4f8fb0', hall: '#e8e8f0' },
  mark: { site: '#b48cf0', anomaly: '#e04848', selected: '#ffe45c', settled: '#b48cf0' },
};

const names = {
  onsets: ['k', 'v', 'z', 'th', 'x', 'or', 'ar', 'sol', 'ne', 'cy', 'ly', 'ta', 'qu', 'dr', 'es', 'mi'],
  mids: ['a', 'e', 'i', 'o', 'u', 'ae', 'ei', 'y'],
  codas: ['n', 'x', 'r', 's', 'th', 'm', 'ris', 'on', 'ax', 'el'],
};
const given = {
  onsets: ['m', 'k', 'ta', 'ri', 'jo', 'li', 'na', 've', 'so', 'de'],
  mids: ['a', 'e', 'i', 'o', 'u'],
  codas: ['n', 'r', 'l', 'ra', 'na', 'ko', 'x', 'sh', 's', 'm'],
};
const family = {
  onsets: ['ch', 'ok', 'va', 'ha', 'ba', 'pe', 'wo', 'ze', 'ta', 'ro', 'ki', 'ma'],
  mids: ['n', 'r', 's', 'l', 'm', 'v'],
  codas: ['ov', 'ez', 'ard', 'su', 'ton', 'ko', 'mi', 'ley', 'ssen', 'ura'],
};

export const scifi = definePack({
  id: 'scifi',
  label: 'Sci-fi survey',
  era: 'future',
  features: { anomalies: true, inhabitants: true, economy: true },
  palette: SCIFI_PALETTE,
  words: {
    'app.title': 'Orbital Survey Studio',
    'level.universe': 'Universe',
    'level.system': 'System',
    'level.body': 'Planet',
    'level.site': 'Settlement',
    'star.dim': 'Red dwarf',
    'star.mid': 'Yellow star',
    'star.bright': 'Blue giant',
    'body.barren': 'Barren rock',
    'body.temperate': 'Temperate world',
    'body.arid': 'Arid world',
    'body.frozen': 'Ice world',
    'body.gaseous': 'Gas giant',
    'size.small': 'Outpost',
    'size.medium': 'Colony',
    'size.large': 'Metropolis',
    'dwelling.home': 'Habitat',
    'dwelling.shop': 'Market',
    'dwelling.works': 'Fabricator',
    'dwelling.mill': 'Fiber plant',
    'dwelling.quarry': 'Mining rig',
    'dwelling.dock': 'Harbor',
    'era.a0': 'Landfall',
    'era.a1': 'Frontier',
    'era.a2': 'Colony',
    'era.a3': 'Industrial',
    'era.a4': 'Orbital',
    'era.a5': 'Interstellar',
    'dwelling.hall': 'Command hall',
    'role.laborer': 'Technician',
    'role.artisan': 'Fabricator',
    'role.trader': 'Broker',
    'role.keeper': 'Administrator',
    'role.scholar': 'Researcher',
    'role.guard': 'Security',
    'event.birth': 'Birth registered at {0}',
    'event.death': 'Fatality logged at {0}',
    'event.arrival': '{n} arrivals docked at {0}',
    'event.departure': '{n} departures from {0}',
    'event.exchange': 'Cargo exchange at {0} (volume {n})',
    'event.mishap': 'Equipment failure at {0}',
    'event.gathering': 'Assembly of {n} at {0}',
    'event.discovery': 'Survey contact near {0}',
    'mark.anomalies': 'Anomalies',
    'mark.settled': 'Settled worlds',
    'field.anomalies': 'Anomalies detected',
    'field.output': 'Output (credits/tick)',
    'field.wealth': 'Credits',
    'state.anomaly': 'anomaly',
    'list.anomalies': 'Anomalies on this planet',
    'list.sites': 'Settlements on this planet',
    'list.system': 'Planets in this system',
    'list.dwellings': 'Structures in this district',
  },
  name(kind, key, _tag, t) {
    switch (kind) {
      case 'person':
        return `${syllables('pg', key & 0xffff, given, [1, 2])} ${syllables('pf', key >>> 16, family, [1, 1])}`;
      case 'dwelling':
        return `${syllables('pf', key >>> 16, family, [1, 1])} ${_tag ? t(`dwelling.${_tag}`) : ''}`.trim();
      case 'anomaly': {
        const n = 1000 + (key % 9000);
        return `ANM-${n}`;
      }
      default:
        return syllables('n', key, names, [1, 2]);
    }
  },
});
