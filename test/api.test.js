const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const { CATALOG, ROLES } = require('../server');

const projectDir = path.resolve(__dirname, '..');
const specs = CATALOG.flatMap((wowClass) => wowClass.specs.map((spec) => ({ ...spec, classId: wowClass.id })));

function startTestServer(dataDir) {
  const child = spawn(process.execPath, ['-e', `
    const http = require('node:http');
    const { createRequestHandler } = require('./server');
    const server = http.createServer(createRequestHandler());
    server.listen(0, '127.0.0.1', () => console.log('PORT:' + server.address().port));
  `], {
    cwd: projectDir,
    env: { ...process.env, ROLLNAGOELA_DATA_DIR: dataDir },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

  const ready = new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error(`Servidor de teste não iniciou. ${stderr}`)), 8000);
    child.stdout.on('data', (chunk) => {
      output += chunk.toString();
      const match = output.match(/PORT:(\d+)/);
      if (!match) return;
      clearTimeout(timer);
      resolve(Number(match[1]));
    });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Servidor de teste encerrou com código ${code}. ${stderr}`));
    });
  });

  return { child, ready, getStderr: () => stderr };
}

async function stopTestServer(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((resolve) => child.once('exit', resolve));
  child.kill();
  await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 2000))]);
}

async function requestJson(baseUrl, route, method = 'GET', body) {
  const response = await fetch(`${baseUrl}${route}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  return { response, payload: await response.json() };
}

test('a API revela uma escolha por vez, persiste o estado e não devolve o plano futuro', { timeout: 30000 }, async () => {
  const dataParent = path.join(projectDir, 'data');
  await fs.mkdir(dataParent, { recursive: true });
  const dataDir = await fs.mkdtemp(path.join(dataParent, 'api-test-'));
  const { child, ready } = startTestServer(dataDir);

  try {
    const port = await ready;
    const baseUrl = `http://127.0.0.1:${port}`;
    const page = await fetch(`${baseUrl}/`);
    assert.equal(page.status, 200);
    const pageMarkup = await page.text();
    assert.match(pageMarkup, /id="players-title"/);
    assert.match(pageMarkup, /id="role-summary"/);
    assert.match(pageMarkup, /id="roll-stage"/);
    assert.match(pageMarkup, /id="roll-start"/);
    assert.doesNotMatch(pageMarkup, /id="roll-again"|id="roll-conclude"|roll-spinner/);
    assert.match(pageMarkup, /ROLES SORTEADAS/);
    assert.match(pageMarkup, /id="player-success"/);
    assert.doesNotMatch(pageMarkup, /id="specs-title"/);

    const initial = await requestJson(baseUrl, '/api/state');
    assert.equal(initial.payload.clanName, 'Roll na Goela');
    assert.equal(initial.payload.players.length, 0);

    const renamed = await requestJson(baseUrl, '/api/settings', 'PUT', { clanName: 'Roll na Goela — Teste' });
    assert.equal(renamed.response.status, 200);
    assert.equal(renamed.payload.clanName, 'Roll na Goela — Teste');

    for (let index = 0; index < 30; index += 1) {
      const result = await requestJson(baseUrl, '/api/players', 'POST', {
        name: `Aventureiro ${index + 1}`,
        currentSpecId: specs[(index * 7 + 3) % specs.length].id,
      });
      assert.equal(result.response.status, 201);
    }

    const roster = await requestJson(baseUrl, '/api/state');
    const registeredPlayerIds = new Set(roster.payload.players.map((player) => player.id));

    const first = await requestJson(baseUrl, '/api/draw/start', 'POST');
    assert.equal(first.response.status, 200);
    assert.equal(first.payload.draw.assignments.length, 0);
    assert.equal(first.payload.draw.revealedCount, 0);
    assert.ok(registeredPlayerIds.has(first.payload.draw.activePlayer.playerId));
    assert.equal(Object.hasOwn(first.payload.draw.activePlayer, 'specId'), false);
    assert.equal(Object.hasOwn(first.payload.draw, 'plan'), false);
    const resumedBeforeRoll = await requestJson(baseUrl, '/api/state');
    assert.equal(resumedBeforeRoll.payload.draw.activePlayer.playerId, first.payload.draw.activePlayer.playerId);
    assert.equal(resumedBeforeRoll.payload.draw.activePlayer.hasRolled, false);

    const privateState = JSON.parse(await fs.readFile(path.join(dataDir, 'state.json'), 'utf8'));
    assert.equal(privateState.draw.plan.length, 30);
    assert.equal(privateState.draw.revealed, 0);
    assert.equal(privateState.draw.selectedIndex, 0);

    const skippedRoll = await requestJson(baseUrl, '/api/draw/next', 'POST');
    assert.equal(skippedRoll.response.status, 409);

    const firstRoll = await requestJson(baseUrl, '/api/draw/roll', 'POST');
    assert.equal(firstRoll.response.status, 200);
    assert.equal(firstRoll.payload.draw.assignments.length, 1);
    assert.equal(firstRoll.payload.draw.revealedCount, 1);
    assert.equal(firstRoll.payload.draw.activePlayer.hasRolled, true);
    assert.equal(firstRoll.payload.draw.activePlayer.playerId, first.payload.draw.activePlayer.playerId);
    const repeatedRoll = await requestJson(baseUrl, '/api/draw/roll', 'POST');
    assert.equal(repeatedRoll.response.status, 409);
    const prematureFinish = await requestJson(baseUrl, '/api/draw/finish', 'POST');
    assert.equal(prematureFinish.response.status, 409);

    let latest = firstRoll.payload;
    for (let expectedCount = 2; expectedCount <= 30; expectedCount += 1) {
      const nextPerson = await requestJson(baseUrl, '/api/draw/next', 'POST');
      assert.equal(nextPerson.response.status, 200);
      assert.equal(nextPerson.payload.draw.revealedCount, expectedCount - 1);
      assert.equal(nextPerson.payload.draw.assignments.length, expectedCount - 1);
      assert.equal(nextPerson.payload.draw.activePlayer.hasRolled, false);
      assert.equal(Object.hasOwn(nextPerson.payload.draw.activePlayer, 'specId'), false);

      const result = await requestJson(baseUrl, '/api/draw/roll', 'POST');
      assert.equal(result.response.status, 200);
      assert.equal(result.payload.draw.revealedCount, expectedCount);
      assert.equal(result.payload.draw.assignments.length, expectedCount);
      latest = result.payload;
    }

    const assignments = latest.draw.assignments;
    const firstRound = assignments.slice(0, 13);
    assert.equal(latest.draw.status, 'complete');
    assert.equal(latest.draw.finalized, true);
    assert.equal(new Set(firstRound.map((assignment) => assignment.classId)).size, 13);
    for (let offset = 0; offset < assignments.length; offset += 13) {
      const round = assignments.slice(offset, offset + 13);
      assert.equal(new Set(round.map((assignment) => assignment.classId)).size, round.length);
    }
    assert.equal(assignments.filter((assignment) => assignment.role === ROLES.TANK).length, 2);
    assert.equal(firstRound.filter((assignment) => assignment.role === ROLES.TANK).length, 2);
    assert.equal(new Set(assignments.map((assignment) => assignment.specId)).size, 30);

    const healers = assignments.filter((assignment) => assignment.role === ROLES.HEALER).length;
    assert.ok(healers / 30 >= 0.2 && healers / 30 <= 0.25);
    const dps = assignments.filter((assignment) => [ROLES.MELEE, ROLES.RANGED].includes(assignment.role));
    assert.ok(dps.filter((assignment) => assignment.role === ROLES.MELEE).length / dps.length >= 0.2);
    assert.ok(dps.filter((assignment) => assignment.role === ROLES.RANGED).length / dps.length >= 0.5);

    const finished = await requestJson(baseUrl, '/api/draw/finish', 'POST');
    assert.equal(finished.response.status, 200);
    assert.equal(finished.payload.draw.finalized, true);
    latest = finished.payload;

    const lockedEdit = await requestJson(baseUrl, `/api/players/${latest.players[0].id}`, 'PUT', {
      name: 'Elenco bloqueado',
      currentSpecId: specs[0].id,
    });
    assert.equal(lockedEdit.response.status, 409);

    const reset = await requestJson(baseUrl, '/api/draw/reset', 'POST');
    assert.equal(reset.response.status, 200);
    assert.equal(reset.payload.draw, null);
    assert.equal(reset.payload.players.length, 30);
  } finally {
    await stopTestServer(child);
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test('a API permite reroll individual sem repetir spec nem alterar resultados já revelados', { timeout: 30000 }, async () => {
  const dataParent = path.join(projectDir, 'data');
  await fs.mkdir(dataParent, { recursive: true });
  const dataDir = await fs.mkdtemp(path.join(dataParent, 'reroll-test-'));
  const { child, ready, getStderr } = startTestServer(dataDir);

  try {
    const port = await ready;
    const baseUrl = `http://127.0.0.1:${port}`;
    for (let index = 0; index < 14; index += 1) {
      const result = await requestJson(baseUrl, '/api/players', 'POST', {
        name: `Aventureiro ${index + 1}`,
        currentSpecId: specs[(index * 7 + 3) % specs.length].id,
      });
      assert.equal(result.response.status, 201);
    }

    const started = await requestJson(baseUrl, '/api/draw/start', 'POST');
    assert.equal(started.response.status, 200);
    const manuallySelectedPlayer = started.payload.players.find((player) => (
      player.id !== started.payload.draw.activePlayer.playerId
    ));
    const selection = await requestJson(baseUrl, `/api/draw/select/${manuallySelectedPlayer.id}`, 'POST');
    assert.equal(selection.response.status, 200);
    assert.equal(selection.payload.draw.activePlayer.playerId, manuallySelectedPlayer.id);
    assert.equal(selection.payload.draw.activePlayer.hasRolled, false);
    const resumedSelection = await requestJson(baseUrl, '/api/state');
    assert.equal(resumedSelection.payload.draw.activePlayer.playerId, manuallySelectedPlayer.id);
    assert.equal(Object.hasOwn(resumedSelection.payload.draw.activePlayer, 'specId'), false);

    const firstRoll = await requestJson(baseUrl, '/api/draw/roll', 'POST');
    assert.equal(firstRoll.response.status, 200);
    const original = firstRoll.payload.draw.assignments[0];
    assert.equal(original.playerId, manuallySelectedPlayer.id);
    const selectedAgain = await requestJson(baseUrl, `/api/draw/select/${original.playerId}`, 'POST');
    assert.equal(selectedAgain.response.status, 409);
    const nextPerson = await requestJson(baseUrl, '/api/draw/next', 'POST');
    assert.equal(nextPerson.response.status, 200);
    const secondRoll = await requestJson(baseUrl, '/api/draw/roll', 'POST');
    assert.equal(secondRoll.response.status, 200);
    const previouslyRevealed = secondRoll.payload.draw.assignments[1];
    const revealedIds = new Set(secondRoll.payload.draw.assignments.map((assignment) => assignment.playerId));
    const hiddenPlayer = started.payload.players.find((player) => !revealedIds.has(player.id));
    const hiddenReroll = await requestJson(baseUrl, `/api/draw/reroll/${hiddenPlayer.id}`, 'POST');
    assert.equal(hiddenReroll.response.status, 409);

    const rerolled = await requestJson(baseUrl, `/api/draw/reroll/${original.playerId}`, 'POST');
    assert.equal(rerolled.response.status, 200, `${JSON.stringify(rerolled.payload)}\n${getStderr()}`);
    assert.equal(rerolled.payload.draw.revealedCount, 2);
    assert.equal(rerolled.payload.draw.assignments.length, 2);
    assert.equal(rerolled.payload.draw.assignments[0].playerId, original.playerId);
    assert.notEqual(rerolled.payload.draw.assignments[0].specId, original.specId);
    assert.equal(rerolled.payload.draw.assignments[0].role, original.role);
    assert.equal(rerolled.payload.draw.assignments[1].specId, previouslyRevealed.specId);
    assert.equal(rerolled.payload.draw.assignments[1].classId, previouslyRevealed.classId);
    assert.equal(Object.hasOwn(rerolled.payload.draw, 'plan'), false);

    const rerolledAgain = await requestJson(baseUrl, `/api/draw/reroll/${original.playerId}`, 'POST');
    assert.equal(rerolledAgain.response.status, 200);
    assert.notEqual(rerolledAgain.payload.draw.assignments[0].specId, original.specId);
    assert.notEqual(rerolledAgain.payload.draw.assignments[0].specId, rerolled.payload.draw.assignments[0].specId);
    assert.equal(rerolledAgain.payload.draw.assignments[1].specId, previouslyRevealed.specId);

    const privateState = JSON.parse(await fs.readFile(path.join(dataDir, 'state.json'), 'utf8'));
    const assignments = privateState.draw.plan;
    assert.equal(new Set(assignments.map((assignment) => assignment.specId)).size, 14);
    for (const assignment of assignments) {
      const player = privateState.players.find((candidate) => candidate.id === assignment.playerId);
      assert.ok(player);
      assert.notEqual(assignment.specId, player.currentSpecId);
    }
    assert.equal(assignments.filter((assignment) => assignment.role === ROLES.TANK).length, privateState.draw.target.tanks);
    assert.equal(assignments.filter((assignment) => assignment.role === ROLES.HEALER).length, privateState.draw.target.healers);
    assert.equal(assignments.filter((assignment) => assignment.role === ROLES.MELEE).length, privateState.draw.target.melee);
    assert.equal(assignments.filter((assignment) => assignment.role === ROLES.RANGED).length, privateState.draw.target.ranged);

    const rolledPlayerIds = new Set(rerolledAgain.payload.draw.assignments.map((assignment) => assignment.playerId));
    let completed = rerolledAgain.payload;
    while (completed.draw.revealedCount < completed.draw.total) {
      const next = await requestJson(baseUrl, '/api/draw/next', 'POST');
      assert.equal(next.response.status, 200);
      assert.equal(rolledPlayerIds.has(next.payload.draw.activePlayer.playerId), false);
      const result = await requestJson(baseUrl, '/api/draw/roll', 'POST');
      assert.equal(result.response.status, 200);
      rolledPlayerIds.add(result.payload.draw.assignments.at(-1).playerId);
      completed = result.payload;
    }
    assert.equal(rolledPlayerIds.size, 14);
    assert.equal(completed.draw.status, 'complete');
  } finally {
    await stopTestServer(child);
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});
