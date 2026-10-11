import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  INSTALL_STEPS, ART, OPEN_NOTE,
} from '../src/install-guide.js';

test('five steps, each with a short caption, help text and existing art', () => {
  assert.equal(INSTALL_STEPS.length, 5);
  for (const s of INSTALL_STEPS) {
    assert.ok(s.caption && s.help);
    assert.ok(s.caption.length <= 40, s.caption);
    assert.ok(s.caption.split(/\s+/).length <= 8, s.caption);
    assert.ok(Array.isArray(ART[s.art]) && ART[s.art].length > 5, s.art);
  }
  assert.deepEqual(INSTALL_STEPS.map((s) => s.caption), ['Tap ⋯ at the bottom of the screen', 'Tap Share', 'Scroll and tap Add to Home Screen', 'Tap Add', 'Open the new icon']);
  assert.deepEqual(INSTALL_STEPS.map((s) => s.art), ['dots', 'menu', 'list', 'add', 'home']);
});

test('art uses only known tags and no external references', () => {
  const tags = new Set(['rect', 'line', 'path', 'circle', 'text']);
  for (const list of Object.values(ART)) {
    for (const [tag, attrs] of list) {
      assert.ok(tags.has(tag), tag);
      assert.ok(!Object.keys(attrs).some((k) => /^(on|href|src|xlink)/i.test(k)), tag);
      assert.ok(!Object.values(attrs).some((v) => /https?:|url\(|data:/i.test(String(v))), tag);
    }
  }
});

test('every drawing has a highlight ring', () => {
  for (const [name, list] of Object.entries(ART)) {
    assert.ok(list.some(([, a]) => /ig-ring\b/.test(a.class || '')), name);
  }
});

test('no web-share code or button is left in the guide', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../src/install-guide.js', import.meta.url), 'utf8');
  assert.ok(!/navigator\.share|canShare|share menu for me/.test(src));
});

test('step 4 tells the person to leave Open as Web App on', () => {
  assert.match(INSTALL_STEPS[3].help, /Open as Web App/);
});

test('last step tells people to set a new PIN and restore the backup', () => {
  assert.match(OPEN_NOTE, /new PIN/);
  assert.match(OPEN_NOTE, /Restore from a backup file/);
  assert.ok(INSTALL_STEPS[4].help.includes(OPEN_NOTE));
});
