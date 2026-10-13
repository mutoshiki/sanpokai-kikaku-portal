import test from 'node:test';
import assert from 'node:assert/strict';
import { isTrustedAppMessage } from '../public/form-maker/message-origin.js';

function nestedSource(frameWindow, depth = 2) {
  let source = frameWindow;
  for (let index = 0; index < depth; index += 1) source = { parent: source };
  return source;
}

test('accepts Apps Script messages from the actual hyphenated Google wrapper host', () => {
  const frameWindow = {};
  const event = {
    origin: 'https://n-pvl6amrkbkzkvjsk2tjwsnrjh3ivlcmxuoahrky-0lu-script.googleusercontent.com',
    source: nestedSource(frameWindow),
  };

  assert.equal(isTrustedAppMessage(event, frameWindow), true);
});

test('accepts direct Apps Script hosts and dotted script.googleusercontent.com subdomains', () => {
  const frameWindow = {};
  for (const origin of [
    'https://script.google.com',
    'https://script.googleusercontent.com',
    'https://child.script.googleusercontent.com',
  ]) {
    assert.equal(isTrustedAppMessage({ origin, source: nestedSource(frameWindow) }, frameWindow), true, origin);
  }
});

test('rejects lookalike hosts and messages outside the embedded frame tree', () => {
  const frameWindow = {};
  const source = nestedSource(frameWindow);
  for (const origin of [
    'https://evilscript.googleusercontent.com',
    'https://child.script.googleusercontent.com.attacker.example',
    'https://child-script.googleusercontent.com.attacker.example',
  ]) {
    assert.equal(isTrustedAppMessage({ origin, source }, frameWindow), false, origin);
  }
  assert.equal(isTrustedAppMessage({ origin: 'https://script.google.com', source: {} }, frameWindow), false);
});
