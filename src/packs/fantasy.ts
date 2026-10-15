import { definePack, syllables } from './define';
import { SCIFI_PALETTE } from './scifi';
import type { Palette } from './types';

const PALETTE: Palette = {
  ...SCIFI_PALETTE,
  bg: '#241d16',
  star: { dim: '#d9784a', mid: '#f6dc8a', bright: '#f2f2ff' },
  orbit: 'rgba(240,220,180,0.16)',
  terrain: {
    ...SCIFI_PALETTE.terrain,
    temperate: ['#243b5a', '#3d6a8a', '#d9c98c', '#6f9a4a', '#4f7a3a', '#8b7d6b', '#f4f0e6'],
    arid: ['#5c3b22', '#a8703a', '#e3c27d', '#d7a35d', '#b87a3d', '#8c5a32', '#f0dfc0'],
  },
  ground: '#4a4a2a',
  road: '#a58a5c',
  green: '#4f7a3a',
  dwelling: { home: '#b08968', shop: '#d9a441', works: '#7a5a48', mill: '#8a6a3a', quarry: '#8d8d85', dock: '#4f7f8f', hall: '#e8d8b0' },
  mark: { site: '#e8c36a', anomaly: '#c04aa8', selected: '#ffffff', settled: '#e8c36a' },
};

const names = {
  onsets: ['Eld', 'Thor', 'Mir', 'Ael', 'Bran', 'Cal', 'Dun', 'Fen', 'Gal', 'Hol', 'Ith', 'Kor', 'Lor', 'Mor', 'Ny'],
  mids: ['a', 'o', 'e', 'i', 'an', 'el', 'or', 'wyn'],
  codas: ['dor', 'wick', 'vale', 'mere', 'ford', 'hold', 'ren', 'thas', 'ia', 'ar'],
};
const given = {
  onsets: ['Al', 'Be', 'Ca', 'Da', 'El', 'Fi', 'Ga', 'Ha', 'Is', 'Jo', 'Ky', 'Le', 'Ma', 'No', 'Or'],
  mids: ['a', 'e', 'i', 'o', 'u'],
  codas: ['n', 'ric', 'wen', 'la', 'na', 'ric', 'dan', 'ra', 'ta', 'mund'],
};
const family = {
  onsets: ['Ash', 'Black', 'Brook', 'Cross', 'Dun', 'Elm', 'Fair', 'Gray', 'Hill', 'Iron', 'Long', 'Marsh', 'Oak', 'Stone', 'Thorn'],
  mids: [''],
  codas: ['wood', 'field', 'smith', 'ward', 'ton', 'brook', 'man', 'hall', 'worth', 'ley'],
};
const omenAdj = ['Weeping', 'Silent', 'Burning', 'Hollow', 'Pale', 'Black', 'Singing', 'Drowned'];
const omenNoun = ['Stone', 'Spire', 'Mere', 'Gate', 'Barrow', 'Star', 'Tree', 'Door'];

export const fantasy = definePack({
  id: 'fantasy',
  label: 'Fantasy realm',
  era: 'medieval',
  // No ledger of credits in this age: the economy feature set is off by default.
  features: { anomalies: true, inhabitants: true, economy: false },
  palette: PALETTE,
  words: {
    'app.title': "Cartographers' Guild Scrying Table",
    'level.universe': 'Firmament',
    'level.system': 'Star-realm',
    'level.body': 'World',
    'level.site': 'Holding',
    'star.dim': 'Ember-sun',
    'star.mid': 'Golden sun',
    'star.bright': 'White sun',
    'body.barren': 'Dead stone',
    'body.temperate': 'Green realm',
    'body.arid': 'Burning waste',
    'body.frozen': 'Frostbound realm',
    'body.gaseous': 'Cloud-sea',
    'size.small': 'Hamlet',
    'size.medium': 'Town',
    'size.large': 'City',
    'dwelling.home': 'Cottage',
    'dwelling.shop': 'Stall',
    'dwelling.works': 'Forge',
    'dwelling.mill': 'Sawmill',
    'dwelling.quarry': 'Quarry',
    'dwelling.dock': 'Wharf',
    'era.a0': 'Stone',
    'era.a1': 'Bronze',
    'era.a2': 'Iron',
    'era.a3': 'Feudal',
    'era.a4': 'Guild',
    'era.a5': 'Arcane',
    'dwelling.hall': 'Great hall',
    'role.laborer': 'Laborer',
    'role.artisan': 'Smith',
    'role.trader': 'Merchant',
    'role.keeper': 'Steward',
    'role.scholar': 'Scribe',
    'role.guard': 'Watchman',
    'trait.curious': 'Inquisitive',
    'trait.wary': 'Suspicious',
    'mood.tense': 'Uneasy',
    'mood.elated': 'Merry',
    'event.birth': 'A child is born in {0}',
    'event.death': 'A passing is mourned in {0}',
    'event.arrival': '{n} travelers reach {0}',
    'event.departure': '{n} depart {0} on the road',
    'event.exchange': 'Market day at {0} ({n} wagons)',
    'event.mishap': 'Fire breaks out in {0}',
    'event.gathering': 'Feast of {n} at {0}',
    'event.discovery': 'Strange tidings near {0}',
    'mark.anomalies': 'Omens',
    'mark.sites': 'Holdings',
    'mark.settled': 'Peopled realms',
    'mark.residents': 'Folk',
    'field.anomalies': 'Omens seen',
    'field.dwellings': 'Dwellings in the quarter',
    'field.capacity': 'Room for',
    'field.strength': 'Potency',
    'field.depth': 'Age (years)',
    'state.anomaly': 'omen',
    'list.universe': 'Star-realms of the firmament',
    'list.system': 'Worlds of this star-realm',
    'list.sites': 'Holdings on this world',
    'list.anomalies': 'Omens on this world',
    'list.dwellings': 'Buildings in this quarter',
  },
  name(kind, key, tag, t) {
    switch (kind) {
      case 'person':
        return `${syllables('fg', key & 0xffff, given, [1, 1])} ${syllables('ff', key >>> 16, family, [1, 1])}`;
      case 'dwelling':
        return `${syllables('ff', key >>> 16, family, [1, 1])} ${tag ? t(`dwelling.${tag}`) : ''}`.trim();
      case 'anomaly':
        return `The ${omenAdj[key % omenAdj.length]} ${omenNoun[(key >>> 8) % omenNoun.length]}`;
      default:
        return syllables('fn', key, names, [1, 1]);
    }
  },
});
