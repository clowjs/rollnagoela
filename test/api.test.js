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

  return { child, ready };
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
    assert.equal(first.payload.draw.assignments.length, 1);
    assert.equal(first.payload.draw.revealedCount, 1);
    assert.ok(registeredPlayerIds.has(first.payload.draw.assignments[0].playerId));
    assert.equal(Object.hasOwn(first.payload.draw, 'plan'), false);

    const privateState = JSON.parse(await fs.readFile(path.join(dataDir, 'state.json'), 'utf8'));
    assert.equal(privateState.draw.plan.length, 30);
    assert.equal(privateState.draw.revealed, 1);

    let latest = first.payload;
    for (let expectedCount = 2; expectedCount <= 30; expectedCount += 1) {
      const result = await requestJson(baseUrl, '/api/draw/reveal', 'POST');
      assert.equal(result.response.status, 200);
      assert.equal(result.payload.draw.revealedCount, expectedCount);
      assert.equal(result.payload.draw.assignments.length, expectedCount);
      latest = result.payload;
    }

    const assignments = latest.draw.assignments;
    const firstRound = assignments.slice(0, 13);
    assert.equal(latest.draw.status, 'complete');
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
