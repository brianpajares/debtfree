const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');

function app(debts) {
  const context = vm.createContext({ console, structuredClone, localStorage: { getItem: () => null } });
  const source = readFileSync(require.resolve('../app.js'), 'utf8').split("\ndocument.addEventListener('click'")[0];
  vm.runInContext(source + '\nglobalThis.api = { simulate, strategyOrder, setState(value) { state = value; } };', context);
  if (debts) context.api.setState({ debts, extra: 0, strategy: 'avalancha', activity: [] });
  return context.api;
}

const debt = (balance, minimum, apr = 0, id = 'one') => ({ id, balance, minimum, apr });

test('zero-interest balance amortizes exactly with no added interest', () => {
  const result = app([debt(1000, 100)]).simulate(0);
  assert.equal(result.months, 10);
  assert.equal(result.interest, 0);
  assert.equal(result.complete, true);
  assert.equal(result.schedule.at(-1).balance, 0);
});

test('extra payments reduce both time and total interest', () => {
  const model = app([debt(1000, 100, 24)]);
  const standard = model.simulate(0);
  const accelerated = model.simulate(100);
  assert.ok(accelerated.months < standard.months);
  assert.ok(accelerated.interest < standard.interest);
});

test('negative amortization is not reported as a payoff after the horizon', () => {
  const result = app([debt(10000, 1, 100)]).simulate(0);
  assert.equal(result.complete, false);
  assert.equal(result.months, 600);
  assert.ok(result.schedule.at(-1).balance > 10000);
});

test('a loan repaid exactly at the horizon is still complete', () => {
  const result = app([debt(600, 1)]).simulate(0);
  assert.equal(result.months, 600);
  assert.equal(result.complete, true);
});

test('strategies prioritize interest or balance as selected', () => {
  const model = app();
  const debts = [debt(1000, 100, 50, 'high-interest'), debt(100, 20, 0, 'small-balance')];
  assert.equal(model.strategyOrder(debts, 'avalancha')[0].id, 'high-interest');
  assert.equal(model.strategyOrder(debts, 'bola')[0].id, 'small-balance');
});

test('an empty plan has no payments, interest or months remaining', () => {
  const result = app([]).simulate(0);
  assert.equal(result.complete, true);
  assert.equal(result.months, 0);
  assert.equal(result.interest, 0);
});
