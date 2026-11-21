import { NPCS } from '../../shared/npcs.mjs';
import { TOPICS, topicLines } from '../../src/npc/topics.ts';
import { SADE } from '../../src/mission/dialogue.ts';

// Default ElevenLabs voices can be replaced per speaker without changing the game.
export const cast = {
  teacher: 'QtY3JBOUKEB5xzrRfOKc',
  vendor: 'fs2OqxduwXgp9foh2xjK',
  librarian: 'OZ0L6eISlOejga3XjDFt',
  'services-officer': 'fnYMz3F5gMEDGMWcH1ex',
  'event-host': 'g7LVvkPWALzPxOQbF6OE',
  coach: 'gOupLcAkjEnguROwi4oS',
  'residence-assistant': 'BFd5oBc2DDna33pSi4Gf',
  'research-assistant': 'ktkP7Nsj67dw2zcplQYt',
  'orientation-guide': 'dvbL7qkNGZY1IqPGZAjM',
  groundskeeper: 'FrS6cKLB1wg4WYgPa9GW',
  sade: '22N9cF8z0o7y23njdyaY',
};
export const takes = [];
function add(speaker, key, lines) {
  if (lines.length) takes.push({ id: `voice/${speaker}/${key}`, speaker, text: lines.join('\n\n') });
}
for (const d of NPCS) {
  add(d.id, 'hello', [d.greeting]);
  for (const topic of TOPICS[d.id] ?? []) add(d.id, topic.id, topicLines(d.id, topic));
}
for (const [id, lines] of Object.entries(SADE)) add('sade', id, lines);
