// Metropolitan City's traffic and pedestrian simulation (shared/city), run headless with the real network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SEGMENTS, LANES, CONNECTORS, JUNCTION, WALK, PLACES, CROSSWALKS, BAYS, GARAGES, NETWORK_STATS, signalAspect, walkSignal, route, walkRoute, SIGNAL_CYCLE } from '../shared/city/network.mjs';
import { createTraffic, stepTraffic, trafficIncident, trafficSummary, obb } from '../shared/city/traffic.mjs';
import { createPeople, stepPeople, peopleIncident, peopleOnRoad, peopleSummary } from '../shared/city/pedestrians.mjs';
import { blocked } from '../shared/campus.mjs';
import { NO_DRIVE } from '../shared/vehicles.mjs';

const near = (a, b, r) => Math.hypot(a.x - b.x, a.z - b.z) < r;
function run(seconds, { seed = 5, quality = 'medium', hop = true, every = 1, onSecond } = {}) {
  const t = createTraffic({ seed, quality }), p = createPeople({ seed: seed + 1, quality });
  const spots = [{ x: 150, z: 1707 }, { x: -55, z: 1653 }, { x: 400, z: 1708 }, { x: -50, z: 1935 }];
  let players = [{ ...spots[0], yaw: 0 }];
  for (let i = 1; i <= seconds * 30; i++) {
    if (hop && i % 3000 === 0) players = [{ ...spots[(i / 3000) % 4 | 0], yaw: 0 }];
    const walkers = peopleOnRoad(p);
    stepTraffic(t, 1 / 30, { players, walkers });
    stepPeople(p, 1 / 30, { players, vehicles: t.list.filter(v => v.v > .3), buses: t.list.filter(v => v.cls === 'bus' && v.dwell != null).map(v => ({ x: v.x, z: v.z, stop: v.dwell })) });
    if (i % (30 * every) === 0) onSecond?.(t, p, i / 30);
  }
  return { t, p };
}

test('the lane network is connected and every junction movement is reachable', () => {
  assert.ok(NETWORK_STATS.lanes > 150 && NETWORK_STATS.connectors > 300 && NETWORK_STATS.signals > 10, JSON.stringify(NETWORK_STATS));
  for (const l of LANES) assert.ok(l.next.length > 0, `lane ${l.id} is a dead end`);
  // A route exists from a downtown lane to (almost) every other lane.
  const from = LANES.find(l => l.district === 'downtown').id;
  const unreachable = LANES.filter(l => !route(from, l.id)).length;
  assert.ok(unreachable / LANES.length < .03, `${unreachable} lanes unreachable`);
  // Lanes and junction curves stay off building footprints.
  for (const s of SEGMENTS) for (const q of s.pts) assert.ok(!NO_DRIVE.some(r => Math.abs(q.x - r.x) < r.w / 2 - .2 && Math.abs(q.z - r.z) < r.d / 2 - .2), `segment ${s.id} enters a building at ${q.x},${q.z}`);
});

test('signals alternate and never show green to crossing approaches', () => {
  const sig = [...JUNCTION.values()].filter(j => j.control === 'signal');
  for (const j of sig) for (let t = 0; t < SIGNAL_CYCLE; t += .5) {
    const h = signalAspect(j, 'h', t), v = signalAspect(j, 'v', t);
    assert.ok(!(h !== 'red' && v !== 'red'), `${j.id} shows ${h}/${v} at ${t}`);
    // Pedestrians cross an arm only while that arm's traffic is held.
    if (walkSignal(j, 'v', t) !== 'dont') assert.equal(v, 'red');
  }
});

test('pedestrian network: walkable edges, reachable destinations, crosswalks at junctions', () => {
  for (const w of WALK) if (w.edges.length) assert.ok(!blocked(w.x, w.z, .25), `walk node ${w.id} inside a collider`);
  const start = WALK.find(w => w.district === 'downtown' && w.edges.length).id;
  const unreached = PLACES.filter(pl => !walkRoute(start, pl.walk)).length;
  assert.ok(unreached / PLACES.length < .05, `${unreached}/${PLACES.length} places unreachable on foot`);
  assert.ok(CROSSWALKS.length > 60 && BAYS.length > 20 && GARAGES.length > 5);
});

test('ten minutes of city: no overlaps, no red-light runs, traffic keeps moving, parking and garages used', () => {
  let overlaps = 0, worstStopped = 0;
  const { t } = run(600, {
    every: 2,
    onSecond(t) {
      const L = t.list;
      for (let a = 0; a < L.length; a++) for (let b = a + 1; b < L.length; b++) {
        const p = L[a], q = L[b]; if (Math.abs(p.x - q.x) > 12 || Math.abs(p.z - q.z) > 12) continue;
        if (obb(p.x, p.z, p.yaw, p.len / 2 - .15, p.wid / 2 - .1, q.x, q.z, q.yaw, q.len / 2 - .15, q.wid / 2 - .1)) overlaps++;
      }
      worstStopped = Math.max(worstStopped, t.list.filter(v => v.state === 'drive' && v.stillT > 120).length);
    },
  });
  const s = trafficSummary(t);
  assert.equal(overlaps, 0, 'vehicles overlapped');
  assert.equal(s.redRuns, 0, 'a vehicle entered a junction on red');
  assert.ok(s.junctionEntries > 2000, `junction entries ${s.junctionEntries}`);
  assert.ok(s.moving > s.total * .3, `moving ${s.moving}/${s.total}`);
  assert.ok(s.parkings > 5 && s.despawned > 50, `parkings ${s.parkings}, departures ${s.despawned}`);
  assert.ok(worstStopped < 12, `${worstStopped} vehicles stuck for over two minutes`);
  assert.ok(s.total < 130 + 80, `population ${s.total}`);
  assert.ok(Object.keys(s.byClass).length >= 9, 'vehicle variety');
});

test('drivers stop short of a person standing in their lane', () => {
  const t = createTraffic({ seed: 9, quality: 'low' });
  const v = t.list.find(o => o.state === 'drive' && SEGMENTS[o.seg].kind === 'lane' && SEGMENTS[o.seg].len - o.s > 70);
  const seg = SEGMENTS[v.seg], at = pointOn(seg, v.s + 40);
  let minGap = Infinity;
  for (let i = 0; i < 30 * 20; i++) {
    stepTraffic(t, 1 / 30, { players: [{ x: at.x, z: at.z, yaw: 0 }], obstacles: [{ x: at.x, z: at.z, r: .45, v: 0, kind: 'person', id: 'me' }] });
    minGap = Math.min(minGap, Math.hypot(v.x - at.x, v.z - at.z));
  }
  assert.ok(minGap > v.len / 2 + .5, `came within ${minGap.toFixed(2)} m`);
  assert.ok(v.v < .3, 'stopped');
});
function pointOn(seg, s) { const k = Math.max(1, seg.pts.findIndex((_, i) => seg.cum[i] >= s)); const a = seg.pts[k - 1], b = seg.pts[k], f = (s - seg.cum[k - 1]) / (seg.cum[k] - seg.cum[k - 1]); return { x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f }; }

test('pedestrians: inside no building, cross streets, use doors and seats, flee gunfire', () => {
  let inside = 0;
  const { t, p } = run(240, { hop: false, every: 5, onSecond(_, p) { for (const c of p.list) if (blocked(c.x, c.z, .05)) inside++; } });
  const s = peopleSummary(p);
  assert.equal(inside, 0);
  assert.ok(s.crossed > 50 && s.entered > 5 && s.exited > 20, JSON.stringify(s));
  assert.ok(s.byDistrict.downtown > (s.byDistrict.industrial ?? 0) * 2, 'downtown busier than industrial');
  peopleIncident(p, 'gunfire', { x: 150, z: 1707 });
  trafficIncident(t, 'gunfire', { x: 150, z: 1707 });
  assert.ok(peopleSummary(p).fleeing > 3, 'people react');
  assert.ok(t.list.some(v => v.flee), 'drivers react');
});
