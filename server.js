const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT_DIR = __dirname;
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const DATA_DIR = path.resolve(process.env.ROLLNAGOELA_DATA_DIR || path.join(ROOT_DIR, 'data'));
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const MAX_BODY_BYTES = 256 * 1024;
const FIRST_ROUND_SIZE = 13;

const ROLES = Object.freeze({
  TANK: 'tank',
  HEALER: 'healer',
  MELEE: 'melee',
  RANGED: 'ranged',
});

const CATALOG = [
  {
    id: 'death-knight', name: 'Death Knight', abbreviation: 'DK', color: '#c41e3a',
    specs: [
      { id: 'blood-dk', name: 'Blood', role: ROLES.TANK },
      { id: 'frost-dk', name: 'Frost', role: ROLES.MELEE },
      { id: 'unholy-dk', name: 'Unholy', role: ROLES.MELEE },
    ],
  },
  {
    id: 'demon-hunter', name: 'Demon Hunter', abbreviation: 'DH', color: '#a330c9',
    specs: [
      { id: 'havoc-dh', name: 'Havoc', role: ROLES.MELEE },
      { id: 'vengeance-dh', name: 'Vengeance', role: ROLES.TANK },
      { id: 'devourer-dh', name: 'Devourer', role: ROLES.RANGED },
    ],
  },
  {
    id: 'druid', name: 'Druid', abbreviation: 'DR', color: '#ff7c0a',
    specs: [
      { id: 'balance-druid', name: 'Balance', role: ROLES.RANGED },
      { id: 'feral-druid', name: 'Feral', role: ROLES.MELEE },
      { id: 'guardian-druid', name: 'Guardian', role: ROLES.TANK },
      { id: 'restoration-druid', name: 'Restoration', role: ROLES.HEALER },
    ],
  },
  {
    id: 'evoker', name: 'Evoker', abbreviation: 'EV', color: '#33937f',
    specs: [
      { id: 'augmentation-evoker', name: 'Augmentation', role: ROLES.RANGED },
      { id: 'devastation-evoker', name: 'Devastation', role: ROLES.RANGED },
      { id: 'preservation-evoker', name: 'Preservation', role: ROLES.HEALER },
    ],
  },
  {
    id: 'hunter', name: 'Hunter', abbreviation: 'HU', color: '#aad372',
    specs: [
      { id: 'beast-mastery-hunter', name: 'Beast Mastery', role: ROLES.RANGED },
      { id: 'marksmanship-hunter', name: 'Marksmanship', role: ROLES.RANGED },
      { id: 'survival-hunter', name: 'Survival', role: ROLES.MELEE },
    ],
  },
  {
    id: 'mage', name: 'Mage', abbreviation: 'MA', color: '#3fc7eb',
    specs: [
      { id: 'arcane-mage', name: 'Arcane', role: ROLES.RANGED },
      { id: 'fire-mage', name: 'Fire', role: ROLES.RANGED },
      { id: 'frost-mage', name: 'Frost', role: ROLES.RANGED },
    ],
  },
  {
    id: 'monk', name: 'Monk', abbreviation: 'MO', color: '#00ff98',
    specs: [
      { id: 'brewmaster-monk', name: 'Brewmaster', role: ROLES.TANK },
      { id: 'mistweaver-monk', name: 'Mistweaver', role: ROLES.HEALER },
      { id: 'windwalker-monk', name: 'Windwalker', role: ROLES.MELEE },
    ],
  },
  {
    id: 'paladin', name: 'Paladin', abbreviation: 'PA', color: '#f48cba',
    specs: [
      { id: 'holy-paladin', name: 'Holy', role: ROLES.HEALER },
      { id: 'protection-paladin', name: 'Protection', role: ROLES.TANK },
      { id: 'retribution-paladin', name: 'Retribution', role: ROLES.MELEE },
    ],
  },
  {
    id: 'priest', name: 'Priest', abbreviation: 'PR', color: '#e9e9e9',
    specs: [
      { id: 'discipline-priest', name: 'Discipline', role: ROLES.HEALER },
      { id: 'holy-priest', name: 'Holy', role: ROLES.HEALER },
      { id: 'shadow-priest', name: 'Shadow', role: ROLES.RANGED },
    ],
  },
  {
    id: 'rogue', name: 'Rogue', abbreviation: 'RO', color: '#fff468',
    specs: [
      { id: 'assassination-rogue', name: 'Assassination', role: ROLES.MELEE },
      { id: 'outlaw-rogue', name: 'Outlaw', role: ROLES.MELEE },
      { id: 'subtlety-rogue', name: 'Subtlety', role: ROLES.MELEE },
    ],
  },
  {
    id: 'shaman', name: 'Shaman', abbreviation: 'SH', color: '#0070dd',
    specs: [
      { id: 'elemental-shaman', name: 'Elemental', role: ROLES.RANGED },
      { id: 'enhancement-shaman', name: 'Enhancement', role: ROLES.MELEE },
      { id: 'restoration-shaman', name: 'Restoration', role: ROLES.HEALER },
    ],
  },
  {
    id: 'warlock', name: 'Warlock', abbreviation: 'WL', color: '#8788ee',
    specs: [
      { id: 'affliction-warlock', name: 'Affliction', role: ROLES.RANGED },
      { id: 'demonology-warlock', name: 'Demonology', role: ROLES.RANGED },
      { id: 'destruction-warlock', name: 'Destruction', role: ROLES.RANGED },
    ],
  },
  {
    id: 'warrior', name: 'Warrior', abbreviation: 'WA', color: '#c69b6d',
    specs: [
      { id: 'arms-warrior', name: 'Arms', role: ROLES.MELEE },
      { id: 'fury-warrior', name: 'Fury', role: ROLES.MELEE },
      { id: 'protection-warrior', name: 'Protection', role: ROLES.TANK },
    ],
  },
];

const CLASS_BY_ID = new Map(CATALOG.map((wowClass) => [wowClass.id, wowClass]));
const SPEC_BY_ID = new Map(
  CATALOG.flatMap((wowClass) => wowClass.specs.map((spec) => [spec.id, { ...spec, classId: wowClass.id, className: wowClass.name }]))
);
const ALL_CLASS_IDS = CATALOG.map((wowClass) => wowClass.id);
const TOTAL_SPEC_COUNT = SPEC_BY_ID.size;
const HEALER_SPEC_COUNT = [...SPEC_BY_ID.values()].filter((spec) => spec.role === ROLES.HEALER).length;
const ROLE_SPEC_COUNTS = Object.fromEntries(Object.values(ROLES).map((role) => [
  role,
  [...SPEC_BY_ID.values()].filter((spec) => spec.role === role).length,
]));

class HttpError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

function shuffle(items) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const other = crypto.randomInt(index + 1);
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
}

function currentClassId(player) {
  return SPEC_BY_ID.get(player.currentSpecId)?.classId;
}

function matchPlayersToClasses(players, classIds, allowCurrentClass) {
  if (players.length > classIds.length) return null;
  if (players.length === 0) return new Map();

  const options = new Map(shuffle(players).map((player) => [
    player.id,
    shuffle(classIds.filter((classId) => allowCurrentClass || classId !== currentClassId(player))),
  ]));
  const order = [...players].sort((left, right) => (
    options.get(left.id).length - options.get(right.id).length
  ));
  if (order.some((player) => options.get(player.id).length === 0)) return null;

  const classOwners = new Map();
  function place(player, visitedClasses) {
    for (const classId of options.get(player.id)) {
      if (visitedClasses.has(classId)) continue;
      visitedClasses.add(classId);
      const owner = classOwners.get(classId);
      if (!owner || place(owner, visitedClasses)) {
        classOwners.set(classId, player);
        return true;
      }
    }
    return false;
  }

  for (const player of order) {
    if (!place(player, new Set())) return null;
  }

  return new Map([...classOwners].map(([classId, player]) => [player.id, classId]));
}

function getCompositionTargets(groupSize) {
  const targets = [];
  const minimumHealers = Math.ceil(groupSize * 0.2);
  const maximumHealers = Math.floor(groupSize * 0.25);

  for (let healers = minimumHealers; healers <= maximumHealers; healers += 1) {
    const dps = groupSize - 2 - healers;
    const minimumMelee = Math.ceil(dps * 0.2);
    const maximumMelee = Math.floor(dps * 0.5);

    for (let melee = minimumMelee; melee <= maximumMelee; melee += 1) {
      const ranged = dps - melee;
      if (ranged < Math.ceil(dps * 0.5)) continue;
      targets.push({ tanks: 2, healers, melee, ranged, dps });
    }
  }

  return targets.sort((left, right) => {
    const leftScore = Math.abs(left.healers / groupSize - 0.225)
      + Math.abs(left.melee / left.dps - 0.5);
    const rightScore = Math.abs(right.healers / groupSize - 0.225)
      + Math.abs(right.melee / right.dps - 0.5);
    return leftScore - rightScore || left.healers - right.healers || right.melee - left.melee;
  });
}

function solveSpecs(slots, target, nodeBudget = 80_000) {
  const remaining = {
    [ROLES.TANK]: target.tanks,
    [ROLES.HEALER]: target.healers,
    [ROLES.MELEE]: target.melee,
    [ROLES.RANGED]: target.ranged,
  };
  const assigned = new Array(slots.length);
  const usedSpecs = new Set();
  let searchNodes = 0;

  function availableSpecs(slotIndex) {
    const slot = slots[slotIndex];
    const player = slot.player;
    const wowClass = CLASS_BY_ID.get(slot.classId);
    return wowClass.specs.filter((spec) => (
      spec.id !== player.currentSpecId
      && !usedSpecs.has(spec.id)
      && remaining[spec.role] > 0
      && (spec.role !== ROLES.TANK || slot.round === 1)
    ));
  }

  function canStillComplete(unassigned, candidateLists) {
    const spotsLeft = unassigned.length;
    const rolesLeft = Object.values(remaining).reduce((sum, amount) => sum + amount, 0);
    if (rolesLeft !== spotsLeft) return false;

    for (const role of Object.values(ROLES)) {
      if (remaining[role] === 0) continue;
      const capableSlots = candidateLists.filter((specs) => specs.some((spec) => spec.role === role)).length;
      if (capableSlots < remaining[role]) return false;
    }
    return true;
  }

  function visit(unassigned) {
    searchNodes += 1;
    if (searchNodes > nodeBudget) return false;
    if (unassigned.length === 0) return Object.values(remaining).every((amount) => amount === 0);

    const candidateLists = unassigned.map((slotIndex) => availableSpecs(slotIndex));
    if (candidateLists.some((specs) => specs.length === 0)) return false;
    if (!canStillComplete(unassigned, candidateLists)) return false;

    const fewest = Math.min(...candidateLists.map((specs) => specs.length));
    const tied = unassigned.filter((_, index) => candidateLists[index].length === fewest);
    const slotIndex = tied[crypto.randomInt(tied.length)];
    const listIndex = unassigned.indexOf(slotIndex);
    const choices = shuffle(candidateLists[listIndex]);
    const nextUnassigned = unassigned.filter((candidate) => candidate !== slotIndex);

    for (const spec of choices) {
      assigned[slotIndex] = spec;
      usedSpecs.add(spec.id);
      remaining[spec.role] -= 1;

      if (visit(nextUnassigned)) return true;

      remaining[spec.role] += 1;
      usedSpecs.delete(spec.id);
      assigned[slotIndex] = undefined;
      if (searchNodes > nodeBudget) return false;
    }
    return false;
  }

  return visit(slots.map((_, index) => index)) ? assigned : null;
}

function generatePlan(players) {
  if (!Array.isArray(players) || players.length < 2) {
    throw new HttpError('Cadastre pelo menos 2 jogadores para formar os dois tanks.', 422);
  }
  if (players.length > TOTAL_SPEC_COUNT) {
    throw new HttpError(`Há ${TOTAL_SPEC_COUNT} specs únicas no catálogo; não é possível sortear ${players.length} jogadores sem repetir spec.`, 422);
  }
  if (Math.ceil(players.length * 0.2) > HEALER_SPEC_COUNT) {
    throw new HttpError(`Com ${players.length} jogadores, seriam necessários mais healers do que as ${HEALER_SPEC_COUNT} specs de healer disponíveis.`, 422);
  }

  const playerIds = new Set();
  for (const player of players) {
    if (!player || typeof player.id !== 'string' || playerIds.has(player.id)) {
      throw new HttpError('O cadastro de jogadores contém identificadores inválidos.', 422);
    }
    if (!SPEC_BY_ID.has(player.currentSpecId)) {
      throw new HttpError(`A spec atual de ${player.name || 'um jogador'} não está no catálogo.`, 422);
    }
    playerIds.add(player.id);
  }

  const targets = getCompositionTargets(players.length).filter((target) => (
    target.tanks <= ROLE_SPEC_COUNTS[ROLES.TANK]
    && target.healers <= ROLE_SPEC_COUNTS[ROLES.HEALER]
    && target.melee <= ROLE_SPEC_COUNTS[ROLES.MELEE]
    && target.ranged <= ROLE_SPEC_COUNTS[ROLES.RANGED]
  ));
  if (targets.length === 0) {
    throw new HttpError('Não existe uma composição inteira que cumpra as porcentagens usando as specs disponíveis para esse tamanho de grupo.', 422);
  }

  // A ordem dos jogadores também é sorteada para cada plano. Cada rodada usa
  // classes distintas, independentemente da ordem em que o elenco foi cadastrado.
  for (let attempt = 0; attempt < 180; attempt += 1) {
    const drawOrder = shuffle(players);
    const slots = [];
    let classAssignmentFailed = false;

    for (let offset = 0; offset < drawOrder.length; offset += FIRST_ROUND_SIZE) {
      const wave = drawOrder.slice(offset, offset + FIRST_ROUND_SIZE);
      const classIds = shuffle(ALL_CLASS_IDS);
      const classAssignment = matchPlayersToClasses(wave, classIds, false)
        || matchPlayersToClasses(wave, classIds, true);

      if (!classAssignment) {
        classAssignmentFailed = true;
        break;
      }

      for (const player of wave) {
        const position = slots.length + 1;
        slots.push({
          player,
          classId: classAssignment.get(player.id),
          position,
          round: Math.floor((position - 1) / FIRST_ROUND_SIZE) + 1,
        });
      }
    }
    if (classAssignmentFailed) continue;

    for (const target of targets) {
      const chosenSpecs = solveSpecs(slots, target);
      if (!chosenSpecs) continue;

      const assignments = slots.map((slot, index) => {
        const wowClass = CLASS_BY_ID.get(slot.classId);
        const spec = chosenSpecs[index];
        return {
          playerId: slot.player.id,
          playerName: slot.player.name,
          classId: wowClass.id,
          className: wowClass.name,
          specId: spec.id,
          specName: spec.name,
          role: spec.role,
          position: slot.position,
          round: slot.round,
        };
      });

      return { assignments, target };
    }
  }

  throw new HttpError(
    'Não encontramos uma combinação que cumpra todas as regras. Confira as specs atuais cadastradas e tente novamente.',
    422,
  );
}

function initialState() {
  return {
    clanName: 'Roll na Goela',
    players: [],
    draw: null,
  };
}

async function saveState(state) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const temporaryFile = `${STATE_FILE}.tmp`;
  await fs.writeFile(temporaryFile, JSON.stringify(state, null, 2), 'utf8');
  await fs.rename(temporaryFile, STATE_FILE);
}

async function readDiskState() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    const contents = await fs.readFile(STATE_FILE, 'utf8');
    return JSON.parse(contents);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      if (error instanceof SyntaxError) {
        throw new Error(`O arquivo ${path.relative(ROOT_DIR, STATE_FILE)} não contém JSON válido.`);
      }
      throw error;
    }
    const state = initialState();
    await saveState(state);
    return state;
  }
}

let stateQueue = Promise.resolve();

async function getPublicState() {
  await stateQueue;
  const state = await readDiskState();
  const draw = state.draw
    ? {
        status: state.draw.revealed >= state.draw.plan.length
          ? 'complete'
          : state.draw.revealed > 0 ? 'in_progress' : 'ready',
        total: state.draw.plan.length,
        revealedCount: state.draw.revealed,
        target: state.draw.target,
        createdAt: state.draw.createdAt,
        assignments: state.draw.plan.slice(0, state.draw.revealed),
      }
    : null;

  return {
    clanName: state.clanName,
    players: state.players,
    catalog: CATALOG,
    draw,
  };
}

function mutateState(mutator) {
  const operation = stateQueue.then(async () => {
    const state = await readDiskState();
    await mutator(state);
    await saveState(state);
    return getPublicStateWithoutQueue(state);
  });
  stateQueue = operation.then(() => undefined, () => undefined);
  return operation;
}

function getPublicStateWithoutQueue(state) {
  const draw = state.draw
    ? {
        status: state.draw.revealed >= state.draw.plan.length
          ? 'complete'
          : state.draw.revealed > 0 ? 'in_progress' : 'ready',
        total: state.draw.plan.length,
        revealedCount: state.draw.revealed,
        target: state.draw.target,
        createdAt: state.draw.createdAt,
        assignments: state.draw.plan.slice(0, state.draw.revealed),
      }
    : null;
  return { clanName: state.clanName, players: state.players, catalog: CATALOG, draw };
}

function normalizeName(value, label, maximumLength) {
  if (typeof value !== 'string') throw new HttpError(`${label} é obrigatório.`);
  const name = value.trim().replace(/\s+/g, ' ');
  if (!name) throw new HttpError(`${label} é obrigatório.`);
  if (name.length > maximumLength) throw new HttpError(`${label} deve ter no máximo ${maximumLength} caracteres.`);
  return name;
}

function assertRosterEditable(state) {
  if (state.draw) {
    throw new HttpError('O elenco está bloqueado durante o sorteio. Reinicie o sorteio antes de editar jogadores.', 409);
  }
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new HttpError('A requisição é maior que o permitido.', 413);
    chunks.push(chunk);
  }
  if (size === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError('Envie um JSON válido.');
  }
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(JSON.stringify(payload));
}

async function handleApi(request, response, url) {
  const route = url.pathname;

  if (request.method === 'GET' && route === '/api/state') {
    return sendJson(response, 200, await getPublicState());
  }

  if (request.method === 'PUT' && route === '/api/settings') {
    const body = await readJsonBody(request);
    const clanName = normalizeName(body.clanName, 'O nome do clã', 48);
    return sendJson(response, 200, await mutateState((state) => {
      state.clanName = clanName;
    }));
  }

  if (request.method === 'POST' && route === '/api/players') {
    const body = await readJsonBody(request);
    const name = normalizeName(body.name, 'O nome do jogador', 32);
    if (typeof body.currentSpecId !== 'string' || !SPEC_BY_ID.has(body.currentSpecId)) {
      throw new HttpError('Selecione uma spec atual válida.');
    }
    return sendJson(response, 201, await mutateState((state) => {
      assertRosterEditable(state);
      state.players.push({
        id: crypto.randomUUID(),
        name,
        currentSpecId: body.currentSpecId,
      });
    }));
  }

  const playerMatch = route.match(/^\/api\/players\/([^/]+)$/);
  if (playerMatch && request.method === 'PUT') {
    const playerId = decodeURIComponent(playerMatch[1]);
    const body = await readJsonBody(request);
    const name = normalizeName(body.name, 'O nome do jogador', 32);
    if (typeof body.currentSpecId !== 'string' || !SPEC_BY_ID.has(body.currentSpecId)) {
      throw new HttpError('Selecione uma spec atual válida.');
    }
    return sendJson(response, 200, await mutateState((state) => {
      assertRosterEditable(state);
      const player = state.players.find((candidate) => candidate.id === playerId);
      if (!player) throw new HttpError('Jogador não encontrado.', 404);
      player.name = name;
      player.currentSpecId = body.currentSpecId;
    }));
  }

  if (playerMatch && request.method === 'DELETE') {
    const playerId = decodeURIComponent(playerMatch[1]);
    return sendJson(response, 200, await mutateState((state) => {
      assertRosterEditable(state);
      const index = state.players.findIndex((candidate) => candidate.id === playerId);
      if (index === -1) throw new HttpError('Jogador não encontrado.', 404);
      state.players.splice(index, 1);
    }));
  }

  if (request.method === 'POST' && route === '/api/draw/start') {
    return sendJson(response, 200, await mutateState((state) => {
      if (state.draw) throw new HttpError('Já existe um sorteio. Reinicie-o antes de começar outro.', 409);
      if (state.players.length < 2) {
        throw new HttpError('Cadastre pelo menos 2 jogadores para formar os dois tanks.', 409);
      }

      const result = generatePlan(state.players);
      state.draw = {
        plan: result.assignments,
        target: result.target,
        // O clique em “Começar” já revela a primeira escolha.
        revealed: 1,
        createdAt: new Date().toISOString(),
      };
    }));
  }

  if (request.method === 'POST' && route === '/api/draw/reveal') {
    return sendJson(response, 200, await mutateState((state) => {
      if (!state.draw) throw new HttpError('Comece um sorteio antes de revelar escolhas.', 409);
      if (state.draw.revealed >= state.draw.plan.length) {
        throw new HttpError('Todas as escolhas já foram reveladas.', 409);
      }
      state.draw.revealed += 1;
    }));
  }

  if (request.method === 'POST' && route === '/api/draw/reset') {
    return sendJson(response, 200, await mutateState((state) => {
      state.draw = null;
    }));
  }

  return sendJson(response, 404, { error: 'Rota não encontrada.' });
}

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

async function serveStatic(request, response, pathname) {
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    throw new HttpError('Caminho inválido.', 400);
  }

  const filePath = path.resolve(PUBLIC_DIR, `.${decodedPath}`);
  if (filePath !== PUBLIC_DIR && !filePath.startsWith(`${PUBLIC_DIR}${path.sep}`)) {
    throw new HttpError('Arquivo não encontrado.', 404);
  }

  let resolvedFile = filePath;
  try {
    const stats = await fs.stat(resolvedFile);
    if (stats.isDirectory()) resolvedFile = path.join(resolvedFile, 'index.html');
  } catch {
    if (decodedPath !== '/') throw new HttpError('Arquivo não encontrado.', 404);
    resolvedFile = path.join(PUBLIC_DIR, 'index.html');
  }

  let contents;
  try {
    contents = await fs.readFile(resolvedFile);
  } catch {
    throw new HttpError('Arquivo não encontrado.', 404);
  }

  response.writeHead(200, {
    'Content-Type': MIME_TYPES[path.extname(resolvedFile).toLowerCase()] || 'application/octet-stream',
    'Cache-Control': 'no-cache',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(request.method === 'HEAD' ? undefined : contents);
}

function createRequestHandler() {
  return async (request, response) => {
    try {
      const url = new URL(request.url, 'http://localhost');
      if (url.pathname.startsWith('/api/')) {
        if (!['GET', 'POST', 'PUT', 'DELETE'].includes(request.method)) {
          return sendJson(response, 405, { error: 'Método não permitido.' });
        }
        return await handleApi(request, response, url);
      }
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return sendJson(response, 405, { error: 'Método não permitido.' });
      }
      return await serveStatic(request, response, url.pathname);
    } catch (error) {
      if (error.status) return sendJson(response, error.status, { error: error.message });
      console.error(error);
      return sendJson(response, 500, { error: 'Ocorreu um erro interno. Tente novamente.' });
    }
  };
}

if (require.main === module) {
  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || '127.0.0.1';
  const server = http.createServer(createRequestHandler());
  server.listen(port, host, () => {
    const displayHost = host === '0.0.0.0' ? 'localhost' : host;
    console.log(`Roll na Goela rodando em http://${displayHost}:${port}`);
    console.log('Para compartilhar na rede local, defina HOST=0.0.0.0 antes de iniciar.');
  });
}

module.exports = {
  CATALOG,
  ROLES,
  FIRST_ROUND_SIZE,
  createRequestHandler,
  generatePlan,
  getCompositionTargets,
};
