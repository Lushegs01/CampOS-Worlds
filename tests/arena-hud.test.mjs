// Combat Arena HUD Customization Studio: the layout model (shared/arena/hud.mjs) that the editor and the
// live HUD both use. Dragging, resizing, saving, restoring, resetting, presets, touch layouts, orientation
// profiles, and recovery from damaged or hostile saved layouts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  HUD_VERSION, PROFILES, PRESETS, HUD_ELEMENTS, HUD_ELEMENT_BY_ID, elementsFor, profileFor, presetLayout, defaultHudStore, validateLayout, validateHudStore,
  moveElement, resizeElement, updateElement, updateGlobal, updateCrosshair, resetElement, alignGuides, touchOverlaps, minScale, rectOf,
  createHistory, pushHistory, undo, redo, CROSSHAIR_STYLES,
} from '../shared/arena/hud.mjs';

const PHONES = [[844, 390], [667, 375], [740, 360], [640, 360], [800, 360], [932, 430], [1024, 600]];

test('every element the brief asks for can be customised, with touch controls separate from the desktop HUD', () => {
  const want = ['crosshair', 'health', 'ammo', 'weaponInfo', 'weaponSlots', 'fire', 'ads', 'reload', 'jump', 'crouch', 'sprint', 'stick', 'minimap', 'score', 'timer', 'killfeed', 'killNotify', 'objectives', 'streaks', 'hitmarker', 'status'];
  for (const id of want) assert.ok(HUD_ELEMENT_BY_ID.has(id), id);
  assert.ok(elementsFor('desktop').every(e => !e.touch), 'no touch controls on desktop');
  for (const p of ['touchLandscape', 'touchPortrait']) assert.ok(['stick', 'fire', 'ads', 'jump', 'crouch', 'sprint', 'reload'].every(id => elementsFor(p).some(e => e.id === id)));
  assert.equal(profileFor({ coarse: false }), 'desktop'); assert.equal(profileFor({ coarse: true }), 'touchLandscape'); assert.equal(profileFor({ coarse: true, portrait: true }), 'touchPortrait');
});

test('every preset is a valid, editable starting point on every profile, and touch presets do not overlap their buttons on common phones', () => {
  for (const p of PROFILES) for (const preset of PRESETS) {
    const layout = presetLayout(p, preset);
    assert.equal(layout.version, HUD_VERSION); assert.equal(layout.profile, p);
    assert.deepEqual(validateLayout(layout, p).repaired, [], `${p}/${preset} is valid as saved`);
    // Editable: moving anything turns it into a custom layout, keeping the rest.
    const moved = moveElement(layout, 'minimap', .3, .4);
    assert.equal(moved.preset, 'custom'); assert.deepEqual([moved.elements.minimap.x, moved.elements.minimap.y], [.3, .4]);
    if (p !== 'desktop') for (const [w, h] of PHONES) {
      const [W, H] = p === 'touchPortrait' ? [h, w] : [w, h];
      assert.deepEqual(touchOverlaps(layout, W, H), [], `${p}/${preset} at ${W}×${H}`);
    }
  }
});

test('dragging: positions are viewport-relative, clamped to the safe area, snap to a grid and to alignment guides; fixed elements stay centred', () => {
  let l = presetLayout('touchLandscape');
  l = moveElement(l, 'stick', 1.7, -3); assert.deepEqual([l.elements.stick.x, l.elements.stick.y], [1, 0], 'never off screen');
  l = moveElement(l, 'fire', .513, .487, { grid: 20 }); assert.deepEqual([l.elements.fire.x, l.elements.fire.y], [.5, .5]);
  l = moveElement(l, 'fire', NaN, 'x'); assert.deepEqual([l.elements.fire.x, l.elements.fire.y], [.5, .5], 'garbage moves to the centre, never NaN');
  const before = l.elements.crosshair; l = moveElement(l, 'crosshair', .1, .1); assert.deepEqual(l.elements.crosshair, before, 'the crosshair marks where shots go');
  const g = alignGuides(presetLayout('desktop'), 'minimap', .505, .3); assert.equal(g.x, .5); assert.deepEqual(g.guides, [{ axis: 'x', at: .5 }]);
  assert.deepEqual(alignGuides(presetLayout('desktop'), 'minimap', .3, .3).guides, []);
  // Rectangles always fit: the element's own anchor point follows its position.
  for (const [x, y] of [[0, 0], [1, 1], [.5, .5]]) { const r = rectOf(moveElement(presetLayout('desktop'), 'minimap', x, y), 'minimap', 1280, 720); assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.w <= 1280 && r.y + r.h <= 720); }
});

test('resizing: every element has a sensible minimum and maximum; touch targets never shrink below 40 px (the fire button 56 px, the stick 84 px)', () => {
  for (const def of HUD_ELEMENTS) {
    const p = def.touch ? 'touchLandscape' : 'desktop';
    const small = resizeElement(presetLayout(p), def.id, .01).elements[def.id].scale, big = resizeElement(presetLayout(p), def.id, 99).elements[def.id].scale;
    assert.ok(small >= minScale(def) - .005 && small >= def.min - .005, def.id); assert.equal(big, def.max, def.id);
    if (def.touch) assert.ok(Math.max(...def.size) * small >= 39.5, `${def.id} stays tappable`);
  }
  assert.ok(Math.max(...HUD_ELEMENT_BY_ID.get('fire').size) * resizeElement(presetLayout('touchLandscape'), 'fire', 0).elements.fire.scale >= 55.5);
  assert.ok(118 * resizeElement(presetLayout('touchLandscape'), 'stick', 0).elements.stick.scale >= 83.5);
  const l = resizeElement(presetLayout('touchLandscape'), 'fire', 1.5); assert.equal(l.elements.fire.scale, 1.5);
});

test('visibility, opacity, alignment, text and icon scaling, contrast, button transparency and crosshair appearance', () => {
  let l = presetLayout('touchLandscape');
  l = updateElement(l, 'compass', { visible: false }); assert.equal(l.elements.compass.visible, false);
  l = updateElement(l, 'fire', { visible: false }); assert.equal(l.elements.fire.visible, true, 'the fire button cannot be hidden on touch');
  l = updateElement(l, 'killfeed', { opacity: 0, align: 'left' }); assert.equal(l.elements.killfeed.opacity, .2); assert.equal(l.elements.killfeed.align, 'left');
  l = updateGlobal(l, { opacity: .1, textScale: 9, iconScale: 1.2, contrast: 'high', buttonOpacity: .5 });
  assert.deepEqual(l.global, { opacity: .3, textScale: 1.5, iconScale: 1.2, contrast: 'high', buttonOpacity: .5 });
  for (const style of CROSSHAIR_STYLES) assert.equal(updateCrosshair(l, { style }).crosshair.style, style);
  l = updateCrosshair(l, { color: '#4DFF88', thickness: 3, outline: false });
  assert.deepEqual(l.crosshair, { style: 'cross', color: '#4dff88', thickness: 3, outline: false });
  assert.equal(updateCrosshair(l, { color: 'red; background:url(x)' }).crosshair.color, '#4dff88', 'colours are strict hex');
  l = resizeElement(l, 'crosshair', 1.8); assert.equal(l.elements.crosshair.scale, 1.8);
});

test('save, restore and reset: one element, the whole layout, and the last saved layout; undo and redo', () => {
  const start = presetLayout('touchLandscape');
  let h = createHistory(), l = start;
  h = pushHistory(h, l); l = moveElement(l, 'stick', .3, .7);
  h = pushHistory(h, l); l = resizeElement(l, 'fire', 1.6);
  let r = undo(h, l); assert.equal(r.layout.elements.fire.scale, start.elements.fire.scale); assert.equal(r.layout.elements.stick.x, .3);
  r = undo(r.history, r.layout); assert.deepEqual(r.layout, start);
  r = redo(r.history, r.layout); r = redo(r.history, r.layout); assert.equal(r.layout.elements.fire.scale, 1.6);
  assert.deepEqual(resetElement(l, 'stick').elements.stick, start.elements.stick, 'reset one element');
  assert.equal(resetElement(l, 'stick').elements.fire.scale, 1.6, 'and only that one');
  // A store round-trips through JSON (local storage or the account) unchanged.
  const store = defaultHudStore(); store.layouts.touchLandscape = l; store.previous = { touchLandscape: start }; store.updatedAt = 123;
  const back = validateHudStore(JSON.parse(JSON.stringify(store)));
  assert.deepEqual(back.repaired, []); assert.deepEqual(back.store.layouts.touchLandscape, l); assert.deepEqual(back.store.previous.touchLandscape, start);
});

test('orientation: portrait and landscape keep separate layouts, as do desktop and touch', () => {
  const store = defaultHudStore();
  store.layouts.touchPortrait = moveElement(store.layouts.touchPortrait, 'fire', .2, .2);
  const back = validateHudStore(JSON.parse(JSON.stringify(store))).store;
  assert.deepEqual([back.layouts.touchPortrait.elements.fire.x, back.layouts.touchPortrait.elements.fire.y], [.2, .2]);
  assert.notEqual(back.layouts.touchLandscape.elements.fire.x, .2);
  assert.equal(back.layouts.desktop.elements.fire, undefined);
});

test('invalid or damaged saved layouts are repaired element by element, never trusted and never fatal', () => {
  for (const bad of [null, 42, 'x', [], { version: 'one' }, { elements: [] }, { version: 1, elements: { fire: 'big' } }]) {
    const r = validateLayout(bad, 'touchLandscape');
    assert.equal(r.layout.elements.fire.visible, true); assert.ok(r.layout.elements.stick.scale > 0);
  }
  const hostile = {
    version: 1, preset: 'evil', global: { opacity: -5, textScale: 'huge', contrast: 'max' }, crosshair: { style: 'skull', color: 'javascript:alert(1)', thickness: 99 },
    elements: { fire: { x: 99, y: -1, scale: 0.0001, visible: false, opacity: 7 }, stick: { visible: false }, minimap: { x: .2, y: .3, scale: 1.1 }, __proto__x: { x: 1 }, compass: null },
  };
  const { layout, repaired } = validateLayout(hostile, 'touchLandscape');
  assert.deepEqual([layout.elements.fire.x, layout.elements.fire.y, layout.elements.fire.visible, layout.elements.fire.opacity], [1, 0, true, 1]);
  assert.ok(layout.elements.fire.scale * 82 >= 55.5); assert.equal(layout.elements.stick.visible, true);
  assert.deepEqual([layout.elements.minimap.x, layout.elements.minimap.y, layout.elements.minimap.scale], [.2, .3, 1.1], 'the valid parts are kept');
  assert.equal(layout.global.opacity, .3); assert.equal(layout.crosshair.style, 'cross'); assert.equal(layout.crosshair.color, '#ffffff');
  for (const k of ['preset', 'fire', 'stick', 'compass', 'global.opacity', 'global.textScale', 'crosshair.style', 'crosshair.color']) assert.ok(repaired.includes(k), k);
  // A layout from a future version keeps what this version understands.
  const future = validateLayout({ ...presetLayout('desktop'), version: 99, elements: { ...presetLayout('desktop').elements, hologram: { x: 1 } } }, 'desktop');
  assert.ok(future.repaired.includes('version')); assert.ok(future.repaired.includes('unknown:hologram')); assert.equal(future.layout.version, HUD_VERSION);
  // A layout saved before versioning (no version field) migrates.
  const old = validateLayout({ elements: { minimap: { x: .9, y: .1 } } }, 'desktop');
  assert.ok(old.repaired.includes('version')); assert.equal(old.layout.elements.minimap.x, .9);
  // A whole damaged store.
  const s = validateHudStore({ layouts: { desktop: 'nope', touchLandscape: { elements: { fire: { scale: 1.3 } }, version: 1 } }, updatedAt: -4 });
  assert.equal(s.store.layouts.touchLandscape.elements.fire.scale, 1.3); assert.ok(s.repaired.includes('desktop.layout')); assert.equal(s.store.updatedAt, 0);
  assert.deepEqual(validateHudStore(undefined).repaired, []);
});

test('the acceptance scenario: rearrange a phone HUD, resize the fire button, move the stick, resize the minimap, restyle the crosshair, hide what is not wanted, save and get it back', () => {
  let l = presetLayout('touchLandscape', 'mobileStandard');
  l = moveElement(l, 'stick', .2, .7); l = resizeElement(l, 'fire', 1.35); l = moveElement(l, 'fire', .9, .6);
  l = resizeElement(l, 'minimap', .9); l = moveElement(l, 'minimap', 1, 0); l = moveElement(l, 'killfeed', 0, 0);
  l = updateCrosshair(l, { style: 'circle', color: '#ffe14d', thickness: 1 }); l = resizeElement(l, 'crosshair', 1.4);
  for (const id of ['compass', 'weaponSlots', 'status']) l = updateElement(l, id, { visible: false });
  const store = defaultHudStore(); store.layouts.touchLandscape = l;
  const saved = JSON.stringify(store), back = validateHudStore(JSON.parse(saved));
  assert.deepEqual(back.repaired, []);
  const b = back.store.layouts.touchLandscape;
  assert.deepEqual([b.elements.stick.x, b.elements.stick.y, b.elements.fire.scale, b.elements.minimap.scale, b.elements.minimap.x], [.2, .7, 1.35, .9, 1]);
  assert.deepEqual(b.crosshair, { style: 'circle', color: '#ffe14d', thickness: 1, outline: true });
  assert.equal(b.elements.compass.visible, false); assert.equal(b.preset, 'custom');
});
