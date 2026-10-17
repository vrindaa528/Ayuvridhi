'use strict';
// Red-flag routing unit tests. Escalate when in doubt: a false escalation is
// acceptable, a missed emergency is not. Each row is [text, expected route].
// route null means "no escalation" (the text must not trigger one).

const test = require('node:test');
const assert = require('node:assert');
const { redFlagFor } = require('../core/modules/wellness');

const CASES = [
  // ---- true positives: must escalate ----
  ['I have chest pain since morning', 'sos'],
  ['Severe chest pressure when I climb stairs', 'sos'],
  ['He is having a heart attack', 'sos'],
  ['seene mein dard ho raha hai', 'sos'],
  ['I am feeling breathless', 'sos'],
  ["I can't breathe properly", 'sos'],
  ['difficulty breathing at night', 'sos'],
  ['saans phoolne lagi hai', 'sos'],
  ['My father fainted in the bathroom', 'sos'],
  ['She is unconscious', 'sos'],
  ['He had a seizure', 'sos'],
  ['Mom has fits again', 'sos'],
  ['his fits are coming back', 'sos'],
  ['Dadi is not responding when I call', 'sos'],
  ['Face drooping on the left side', 'sos'],
  ['slurred speech since an hour', 'sos'],
  ['one side is weak and I feel dizzy', 'sos'],
  ['vomiting blood this morning', 'sos'],
  ['there is heavy bleeding that will not stop', 'sos'],
  ['black stool for two days', 'sos'],
  ['fever for 4 days now', 'doctor'],
  ['high fever since yesterday', 'doctor'],
  ['severe headache since last night', 'doctor'],
  ['blood in urine since Monday', 'doctor'],
  ['my sugar is very high today', 'doctor'],
  ['hypoglycaemia symptoms, shaky', 'doctor'],
  ['she is pregnant and has cramps', 'doctor'],
  ['child is not eating anything', 'doctor'],
  ['I feel dehydrated and dizzy', 'doctor'],

  // ---- true negatives: must NOT escalate ----
  ['the benefits of walking after dinner', null],
  ['this kurta fits well', null],
  ['I need a fitness routine for winter', null],
  ['my phone is not responding, what should I do', null],
  ['sugar is normal today, 110 fasting', null],
  ['I have a mild cough and runny nose', null],
  ['a little tired after work', null],
  ['hypothyroid diet tips please', null],
  ['tips for better sleep', null],
  ['I want an ayurvedic tea for digestion', null],

  // ---- negation: a negated symptom alone does not escalate ----
  ['no chest pain, just tired', null],
  ['I do not have any fever', null],
  ['She denies breathlessness', null],
  ['I don’t have chest pain', null],
  ['chest pain nahi hai, bas thakan hai', null],

  // ---- negation does not hide a second, real symptom ----
  ['no fever, but I have chest pain now', 'sos'],
  ['not breathless at all; however I fainted yesterday', 'sos'],
];

for (const [text, route] of CASES) {
  test(`red flag: “${text}” → ${route || 'no escalation'}`, () => {
    const hit = redFlagFor(text);
    assert.equal(hit ? hit.route : null, route, `matched: ${hit && hit.matched}`);
  });
}

test('the table covers at least 30 phrases', () => {
  assert.ok(CASES.length >= 30, `only ${CASES.length} cases`);
});

test('escalations explain why and say what to do', () => {
  const sos = redFlagFor('chest pain');
  assert.match(sos.cta, /112/);
  const doc = redFlagFor('high fever');
  assert.match(doc.cta, /doctor/i);
});
