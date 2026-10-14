// Shared helpers for the account-backed browser workflows (tests/browser-*-accounts.mjs, browser-duel.mjs).
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';

// Without a GPU (Linux CI, containers) Chromium falls back to software WebGL; `qa-scale` renders the
// 3D view at low resolution there so the interface stays responsive (QA builds only).
export const gpu = process.platform === 'win32';
export const QUERY = gpu ? '' : '/?qa-scale=0.2';
export async function launch() {
  const exe = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (gpu ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '/opt/pw-browsers/chromium');
  const args = gpu ? ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--use-gl=angle', '--use-angle=swiftshader-webgl', '--enable-unsafe-swiftshader'];
  return chromium.launch({ headless: true, executablePath: exe, args });
}
/** A signed-up account with a saved profile, plus its own supabase-js client. */
export async function account(stack, handle, name, model = 'ada') {
  const sb = createClient(stack.supa.url, stack.supa.anonKey, { auth: { persistSession: false } });
  const email = `${handle}@example.test`;
  assert.equal((await sb.auth.signUp({ email, password: 'correct horse battery' })).error, null);
  assert.equal((await sb.rpc('save_profile', { p_handle: handle, p_display_name: name, p_bio: '', p_avatar: { model } })).error, null);
  return { sb, email, handle, name };
}
/** Open the campus in a fresh browser context and enter it. */
export async function open(browser, stack, label, errors, { viewport = { width: 1280, height: 800 }, mobile = false } = {}) {
  const ctx = await browser.newContext({ viewport, hasTouch: mobile, isMobile: mobile });
  await ctx.addInitScript(n => { if (!localStorage.getItem('campos-worlds-v1')) localStorage.setItem('campos-worlds-v1', JSON.stringify({ state: { quality: 'low', name: n, reducedMotion: true }, version: 0 })); }, label);
  const page = await ctx.newPage(); page.setDefaultTimeout(45000);
  page.on('pageerror', e => errors.push(`${label}: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error' && !/WebSocket|ERR_CONNECTION|Failed to load resource|GPU stall|WebGL/.test(m.text())) errors.push(`${label}: ${m.text()}`); });
  await page.goto(stack.url + QUERY, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => { const b = document.querySelector('.enter-button'); return b && !b.disabled; }, null, { timeout: 180000 });
  await page.getByRole('button', { name: 'Enter campus', exact: true }).click();
  await page.getByRole('button', { name: /online/ }).waitFor({ timeout: 60000 });
  return page;
}
export async function signIn(page, who) {
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByLabel('Email').fill(who.email); await page.getByLabel('Password').fill('correct horse battery');
  await page.getByRole('button', { name: /^Sign in/ }).last().click();
  await page.getByRole('button', { name: /Edit profile/ }).waitFor();
  await page.getByRole('button', { name: 'Close panel' }).click();
  await page.getByRole('button', { name: `Your profile, @${who.handle}` }).waitFor();
}
/** The room's record of a signed-in player (tests place players server-side, as if they had walked). */
export const roomPlayer = (stack, handle) => [...stack.room.clients.values()].find(c => c.account?.handle === handle);
