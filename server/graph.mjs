// Memory in Neo4j, over the HTTP transactional API. No driver.
// Book prose stays out. `line` is the short card already on the object.

const COMMIT_STATEMENT = [
  'MERGE (o:Object {id: $id})',
  'SET o.subclass = $subclass, o.classId = $classId, o.name = $name, o.real = $real, o.nx = $nx, o.ny = $ny, o.line = $line',
  'MERGE (k:Subclass {id: $subclass})',
  'MERGE (o)-[:IS_KIND]->(k)',
].join(' ');

const RECALL_STATEMENT = [
  'MATCH (o:Object)-[:IS_KIND]->(:Subclass {id: $subclass})',
  'RETURN o.id AS id, o.subclass AS subclass, o.classId AS classId, o.name AS name, o.real AS real, o.nx AS nx, o.ny AS ny, o.line AS line',
].join(' ');

const SCHEMA = [
  [
    'CREATE CONSTRAINT object_id IF NOT EXISTS FOR (o:Object) REQUIRE o.id IS UNIQUE',
    'CREATE CONSTRAINT object_id IF NOT EXISTS ON (o:Object) ASSERT o.id IS UNIQUE',
  ],
  [
    'CREATE CONSTRAINT subclass_id IF NOT EXISTS FOR (k:Subclass) REQUIRE k.id IS UNIQUE',
    'CREATE CONSTRAINT subclass_id IF NOT EXISTS ON (k:Subclass) ASSERT k.id IS UNIQUE',
  ],
];

// Same radius as floor recall: a second object counts only inside this distance.
const RECALL_RADIUS = 0.28;

function readEnv() {
  return {
    uri: String(process.env.NEO4J_URI ?? '').trim(),
    user: String(process.env.NEO4J_USER ?? '').trim() || 'neo4j',
    password: String(process.env.NEO4J_PASSWORD ?? ''),
  };
}

export function graphEnabled() {
  const { uri, password } = readEnv();
  return uri.length > 0 && password.trim().length > 0;
}

// neo4j+s://host and neo4j://host become https://host:7474/.../tx/commit.
// An http(s) URI is used as the origin, path and all.
export function neo4jCommitUrl(uri) {
  const raw = String(uri ?? '').trim();
  if (!raw) return '';
  let url;
  try {
    url = new URL(raw);
  } catch {
    return '';
  }
  if (url.protocol === 'http:' || url.protocol === 'https:') {
    return `${url.origin}/db/neo4j/tx/commit`;
  }
  if (url.protocol === 'neo4j+s:' || url.protocol === 'neo4j:') {
    if (!url.hostname) return '';
    return `https://${url.hostname}:7474/db/neo4j/tx/commit`;
  }
  return '';
}

function memoryOf(object = {}) {
  return {
    id: object.id ?? null,
    subclass: object.subclass ?? null,
    classId: object.classId ?? null,
    name: object.name ?? null,
    real: object.real ?? null,
    nx: object.nx ?? null,
    ny: object.ny ?? null,
    line: object.line ?? null,
  };
}

export function commitTransaction(object) {
  return {
    statements: [
      {
        statement: COMMIT_STATEMENT,
        parameters: memoryOf(object),
      },
    ],
  };
}

export function pickObject(objects, nx, ny) {
  if (!objects?.length) return null;
  if (objects.length === 1) return objects[0];
  let best = null;
  let bestDistance = RECALL_RADIUS;
  for (const item of objects) {
    const distance = Math.hypot((item.nx ?? 0.5) - nx, (item.ny ?? 0.5) - ny);
    if (distance < bestDistance) {
      best = item;
      bestDistance = distance;
    }
  }
  return best;
}

function authHeader(user, password) {
  const token = Buffer.from(`${user}:${password}`, 'utf8').toString('base64');
  return `Basic ${token}`;
}

async function execute(statements) {
  const { uri, user, password } = readEnv();
  const endpoint = neo4jCommitUrl(uri);
  if (!endpoint) throw new Error('Neo4j URI is not an http or bolt address');
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
      authorization: authHeader(user, password),
    },
    body: JSON.stringify({ statements }),
  });
  if (res.status === 401 || res.status === 403) {
    throw new Error(`Neo4j request failed (${res.status})`);
  }
  let payload = {};
  const text = await res.text();
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = {};
    }
  }
  if (Array.isArray(payload.errors) && payload.errors.length) {
    const message = payload.errors.map((item) => item.message).filter(Boolean).join('; ');
    const error = new Error(message || 'Neo4j rejected the statement');
    error.syntax = true;
    throw error;
  }
  if (!res.ok) throw new Error(`Neo4j request failed (${res.status})`);
  return payload;
}

function rowsFrom(payload) {
  const data = payload?.results?.[0]?.data || [];
  return data.map((entry) => {
    const [id, subclass, classId, name, real, nx, ny, line] = entry.row || [];
    return { id, subclass, classId, name, real, nx, ny, line };
  });
}

export async function recall({ subclass, nx, ny } = {}) {
  if (!graphEnabled()) return { enabled: false };
  const payload = await execute([
    {
      statement: RECALL_STATEMENT,
      parameters: { subclass: subclass ?? null },
    },
  ]);
  return { enabled: true, object: pickObject(rowsFrom(payload), nx, ny) };
}

export async function commit(object) {
  if (!graphEnabled()) return { enabled: false };
  await execute(commitTransaction(object).statements);
  return { enabled: true };
}

export async function ensureSchema() {
  if (!graphEnabled()) return { enabled: false };
  for (const [modern, legacy] of SCHEMA) {
    try {
      await execute([{ statement: modern }]);
    } catch (error) {
      if (!error.syntax) throw error;
      try {
        await execute([{ statement: legacy }]);
      } catch (legacyError) {
        if (!legacyError.syntax) throw legacyError;
      }
    }
  }
  return { enabled: true };
}
