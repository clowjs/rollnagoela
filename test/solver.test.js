const test = require('node:test');
const assert = require('node:assert/strict');
const { CATALOG, ROLES, generatePlan, getCompositionTargets } = require('../server');

const allSpecs = CATALOG.flatMap((wowClass) => wowClass.specs.map((spec) => ({
  ...spec,
  classId: wowClass.id,
})));

function makeRoster(size) {
  return Array.from({ length: size }, (_, index) => ({
    id: `player-${index + 1}`,
    name: `Jogador ${index + 1}`,
    currentSpecId: allSpecs[(index * 7 + 3) % allSpecs.length].id,
  }));
}

function assertValidPlan(players, result) {
  const assignments = result.assignments;
  assert.equal(assignments.length, players.length);
  assert.equal(new Set(assignments.map((assignment) => assignment.playerId)).size, players.length);
  assert.equal(new Set(assignments.map((assignment) => assignment.specId)).size, players.length);

  const firstRound = assignments.slice(0, Math.min(13, assignments.length));
  assert.equal(new Set(firstRound.map((assignment) => assignment.classId)).size, firstRound.length);
  assert.equal(firstRound.filter((assignment) => assignment.role === ROLES.TANK).length, 2);
  assert.equal(assignments.filter((assignment) => assignment.role === ROLES.TANK).length, 2);

  for (let offset = 0; offset < assignments.length; offset += 13) {
    const round = assignments.slice(offset, offset + 13);
    assert.equal(new Set(round.map((assignment) => assignment.classId)).size, round.length);
  }

  for (const assignment of assignments) {
    const player = players.find((candidate) => candidate.id === assignment.playerId);
    assert.ok(player);
    assert.notEqual(assignment.specId, player.currentSpecId);
  }

  const healers = assignments.filter((assignment) => assignment.role === ROLES.HEALER).length;
  assert.ok(healers / players.length >= 0.2);
  assert.ok(healers / players.length <= 0.25);

  const dps = assignments.filter((assignment) => (
    assignment.role === ROLES.MELEE || assignment.role === ROLES.RANGED
  ));
  const melee = dps.filter((assignment) => assignment.role === ROLES.MELEE).length;
  const ranged = dps.filter((assignment) => assignment.role === ROLES.RANGED).length;
  assert.ok(melee / dps.length >= 0.2);
  assert.ok(ranged / dps.length >= 0.5);
  assert.equal(melee + ranged, dps.length);
}

test('o catálogo contém as 13 classes e 40 specs do desafio', () => {
  assert.equal(CATALOG.length, 13);
  assert.equal(allSpecs.length, 40);
  assert.ok(allSpecs.some((spec) => spec.id === 'devourer-dh' && spec.role === ROLES.RANGED));
});

test('o planejador mantém as regras para grupos pequenos, médios e grandes', () => {
  for (const size of [10, 12, 13, 15, 20, 30]) {
    const players = makeRoster(size);
    const result = generatePlan(players);
    assertValidPlan(players, result);
  }
});

test('a ordem de revelação é embaralhada em cada sorteio', () => {
  const players = makeRoster(15);
  const registeredOrder = players.map((player) => player.id).join(',');
  let foundDifferentOrder = false;

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const result = generatePlan(players);
    assertValidPlan(players, result);
    if (result.assignments.map((assignment) => assignment.playerId).join(',') !== registeredOrder) {
      foundDifferentOrder = true;
    }
  }

  assert.ok(foundDifferentOrder);
});

test('o planejador não atribui a spec atual nem a classe atual quando há alternativas', () => {
  const players = makeRoster(20);
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const result = generatePlan(players);
    assertValidPlan(players, result);
    for (const assignment of result.assignments) {
      const player = players.find((candidate) => candidate.id === assignment.playerId);
      const currentClass = allSpecs.find((spec) => spec.id === player.currentSpecId).classId;
      assert.notEqual(assignment.classId, currentClass);
    }
  }
});

test('o planejador só repete a classe atual quando a primeira rodada obriga a usá-la', () => {
  const players = Array.from({ length: 20 }, (_, index) => ({
    id: `rogue-${index + 1}`,
    name: `Rogue ${index + 1}`,
    currentSpecId: 'subtlety-rogue',
  }));
  const result = generatePlan(players);
  assertValidPlan(players, result);
  assert.equal(result.assignments.filter((assignment) => assignment.classId === 'rogue').length, 1);
});

test('o planejador informa quando a composição inteira é impossível', () => {
  assert.throws(() => generatePlan(makeRoster(11)), /composição inteira/);
});

test('as metas de composição respeitam as faixas quando há quantidades inteiras possíveis', () => {
  for (let size = 10; size <= 35; size += 1) {
    const target = getCompositionTargets(size)[0];
    if (size === 11) {
      assert.equal(target, undefined);
      continue;
    }
    assert.ok(target);
    assert.equal(target.tanks, 2);
    assert.ok(target.healers / size >= 0.2 && target.healers / size <= 0.25);
    assert.ok(target.melee / target.dps >= 0.2);
    assert.ok(target.ranged / target.dps >= 0.5);
  }
});
