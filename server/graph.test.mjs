import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import {
  commit,
  commitTransaction,
  ensureSchema,
  graphEnabled,
  neo4jCommitUrl,
  pickObject,
  recall,
} from './graph.mjs';

const saved = {
  NEO4J_URI: process.env.NEO4J_URI,
  NEO4J_USER: process.env.NEO4J_USER,
  NEO4J_PASSWORD: process.env.NEO4J_PASSWORD,
};

function restoreEnv() {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function clearGraphEnv() {
  delete process.env.NEO4J_URI;
  delete process.env.NEO4J_USER;
  delete process.env.NEO4J_PASSWORD;
}

afterEach(restoreEnv);

test('bolt URIs become the Aura HTTP commit endpoint', () => {
  assert.equal(
    neo4jCommitUrl('neo4j+s://xxxx.databases.neo4j.io'),
    'https://xxxx.databases.neo4j.io:7474/db/neo4j/tx/commit',
  );
  assert.equal(
    neo4jCommitUrl('neo4j+s://xxxx.databases.neo4j.io:7687'),
    'https://xxxx.databases.neo4j.io:7474/db/neo4j/tx/commit',
  );
  assert.equal(
    neo4jCommitUrl('neo4j://localhost:7687'),
    'https://localhost:7474/db/neo4j/tx/commit',
  );
  assert.equal(
    neo4jCommitUrl('neo4j://neo4j:placeholder@localhost:7687'),
    'https://localhost:7474/db/neo4j/tx/commit',
  );
});

test('http origins keep their scheme and host', () => {
  assert.equal(
    neo4jCommitUrl('http://localhost:7474'),
    'http://localhost:7474/db/neo4j/tx/commit',
  );
  assert.equal(
    neo4jCommitUrl('https://xxxx.databases.neo4j.io:7474/db/neo4j/tx/commit'),
    'https://xxxx.databases.neo4j.io:7474/db/neo4j/tx/commit',
  );
  assert.equal(
    neo4jCommitUrl('https://db.example:443/other'),
    'https://db.example/db/neo4j/tx/commit',
  );
});

test('empty or unusable URIs do not invent an endpoint', () => {
  assert.equal(neo4jCommitUrl(''), '');
  assert.equal(neo4jCommitUrl('   '), '');
  assert.equal(neo4jCommitUrl('not a url'), '');
});

test('the graph stays disabled when uri or password is empty', async () => {
  clearGraphEnv();
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = () => {
    calls += 1;
    throw new Error('network');
  };
  try {
    assert.equal(graphEnabled(), false);
    assert.deepEqual(await recall({ subclass: 'thinking_tool', nx: 0.1, ny: 0.2 }), { enabled: false });
    assert.deepEqual(await commit({
      id: 'obj_1',
      subclass: 'thinking_tool',
      classId: 'technology',
      name: 'Lying Scrap-Glass',
      real: 'laptop',
      nx: 0.1,
      ny: 0.2,
      line: 'A short card.',
    }), { enabled: false });
    assert.deepEqual(await ensureSchema(), { enabled: false });

    process.env.NEO4J_URI = 'neo4j+s://example.databases.neo4j.io';
    assert.equal(graphEnabled(), false);

    delete process.env.NEO4J_URI;
    process.env.NEO4J_PASSWORD = 'not-sent';
    assert.equal(graphEnabled(), false);

    process.env.NEO4J_URI = '   ';
    process.env.NEO4J_PASSWORD = '   ';
    assert.equal(graphEnabled(), false);
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('uri and password enable the graph without a request', () => {
  clearGraphEnv();
  process.env.NEO4J_URI = 'http://localhost:7474';
  process.env.NEO4J_PASSWORD = 'not-sent';
  assert.equal(graphEnabled(), true);
});

test('commit posts one merge statement and no extra prose', () => {
  const body = commitTransaction({
    id: 'obj_1',
    subclass: 'thinking_tool',
    classId: 'technology',
    name: 'Lying Scrap-Glass',
    real: 'laptop',
    nx: 0.2,
    ny: 0.4,
    line: 'A short card.',
    myth: 'do not store',
    discourse: 'do not store',
  });
  assert.equal(body.statements.length, 1);
  assert.match(body.statements[0].statement, /MERGE \(o:Object \{id: \$id\}\)/);
  assert.match(body.statements[0].statement, /MERGE \(k:Subclass \{id: \$subclass\}\)/);
  assert.match(body.statements[0].statement, /MERGE \(o\)-\[:IS_KIND\]->\(k\)/);
  assert.deepEqual(body.statements[0].parameters, {
    id: 'obj_1',
    subclass: 'thinking_tool',
    classId: 'technology',
    name: 'Lying Scrap-Glass',
    real: 'laptop',
    nx: 0.2,
    ny: 0.4,
    line: 'A short card.',
  });
});

test('one stored object is returned, and several must sit within 0.28', () => {
  const alone = [{ id: 'obj_1', subclass: 'thinking_tool', nx: 0.1, ny: 0.1 }];
  assert.equal(pickObject(alone, 0.9, 0.9).id, 'obj_1');
  assert.equal(pickObject([], 0.1, 0.1), null);

  const pair = [
    { id: 'obj_1', nx: 0.1, ny: 0.1 },
    { id: 'obj_2', nx: 0.8, ny: 0.8 },
  ];
  assert.equal(pickObject(pair, 0.82, 0.78).id, 'obj_2');
  assert.equal(pickObject(pair, 0.1, 0.9), null);
});
