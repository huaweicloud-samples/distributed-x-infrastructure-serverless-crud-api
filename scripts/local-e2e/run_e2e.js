'use strict';

// Offline verification of the four handlers, the hexagonal layering, the
// event decoding layer and the store adapter. No cloud connection is used.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const PKG = path.join(ROOT, 'build', 'package');
const ENTRY = path.join(PKG, 'index.js');

if (!fs.existsSync(ENTRY)) {
  console.error('Missing build/package/index.js. Run scripts/package-function.sh first.');
  process.exit(2);
}

const lib = require(ENTRY);
const {
  createGetProductsHandler,
  createGetProductHandler,
  createPutProductHandler,
  createDeleteProductHandler,
  pathId,
  bodyText,
  resourcePath,
  traceId,
  reply,
  createObservability,
  readConfig,
  buildClient,
  ensureTable,
  GeminiDbStore,
  isProduct,
} = lib;

let passed = 0;
let failed = 0;
const failures = [];

async function check(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log('  PASS  ' + name);
  } catch (err) {
    failed += 1;
    failures.push(name + ' :: ' + err.message);
    console.log('  FAIL  ' + name + ' :: ' + err.message);
  }
}

const PRODUCT = { id: 'p-42', name: 'Red Shoes', price: 12.5 };

function makeEvent(overrides) {
  return Object.assign(
    {
      httpMethod: 'GET',
      path: '/products',
      pathParameters: null,
      queryStringParameters: null,
      body: null,
      isBase64Encoded: false,
      headers: {},
      requestContext: { resourcePath: '/products', requestId: 'local-e2e-request' },
    },
    overrides || {}
  );
}

function fakeStore(overrides) {
  const opts = overrides || {};
  const calls = [];
  return {
    calls: calls,
    async getProducts() {
      calls.push(['getProducts']);
      return Object.prototype.hasOwnProperty.call(opts, 'products')
        ? opts.products
        : [PRODUCT];
    },
    async getProduct(id) {
      calls.push(['getProduct', id]);
      return Object.prototype.hasOwnProperty.call(opts, 'product')
        ? opts.product
        : PRODUCT;
    },
    async putProduct(product) {
      calls.push(['putProduct', product]);
    },
    async deleteProduct(id) {
      calls.push(['deleteProduct', id]);
    },
  };
}

function quietObs(lines) {
  return (trace) => ({
    traceId: trace || 'test-trace',
    log(level, message, fields) {
      lines.push({ type: 'log', level: level, message: message, fields: fields });
    },
    metric(name, value, dims) {
      lines.push({ type: 'metric', name: name, value: value, dims: dims });
    },
  });
}

function body(res) {
  return JSON.parse(res.body);
}

(async function main() {
  console.log('=== Four independent handlers ===');

  await check('four handler factories are distinct functions', () => {
    const factories = [
      createGetProductsHandler,
      createGetProductHandler,
      createPutProductHandler,
      createDeleteProductHandler,
    ];
    assert.strictEqual(new Set(factories).size, 4);
    factories.forEach((f) => assert.strictEqual(typeof f, 'function'));
  });

  await check('four compiled entry files each export a handler', () => {
    const names = ['getProducts', 'getProduct', 'putProduct', 'deleteProduct'];
    names.forEach((name) => {
      const mod = require(path.join(PKG, name + '.js'));
      assert.strictEqual(typeof mod.handler, 'function', name);
    });
  });

  await check('declared handler fields match the four compiled entry files', () => {
    const tf = fs.readFileSync(path.join(ROOT, 'infra', 'functions.tf'), 'utf8');
    [
      'getProducts.handler',
      'getProduct.handler',
      'putProduct.handler',
      'deleteProduct.handler',
    ].forEach((h) => assert.ok(tf.includes(h), 'missing ' + h));
  });

  console.log('=== Hexagonal layering ===');

  await check('handlers module depends on the port only, never a concrete adapter', () => {
    const src = fs.readFileSync(path.join(PKG, 'handlers.js'), 'utf8');
    assert.ok(!src.includes('GeminiDbStore'));
  });

  await check('each entry point binds the port to a concrete adapter', () => {
    ['getProducts', 'getProduct', 'putProduct', 'deleteProduct'].forEach((name) => {
      const src = fs.readFileSync(path.join(PKG, name + '.js'), 'utf8');
      assert.ok(src.includes('GeminiDbStore'), name);
      assert.ok(src.includes('storeFactory'), name);
    });
  });

  await check('the port has no runtime implementation in compiled form', () => {
    const src = fs.readFileSync(path.join(PKG, 'store', 'ProductStore.js'), 'utf8');
    assert.ok(!src.includes('class '));
    assert.ok(!src.includes('prototype.getProduct'));
  });

  await check('TypeScript sources are present for every compiled entry', () => {
    const tsDir = path.join(ROOT, 'src', 'functions', 'src');
    ['getProducts', 'getProduct', 'putProduct', 'deleteProduct', 'handlers'].forEach(
      (name) => assert.ok(fs.existsSync(path.join(tsDir, name + '.ts')), name)
    );
    assert.ok(fs.existsSync(path.join(tsDir, 'store', 'ProductStore.ts')));
    assert.ok(fs.existsSync(path.join(tsDir, 'store', 'GeminiDbStore.ts')));
    assert.ok(fs.existsSync(path.join(tsDir, 'model', 'Product.ts')));
  });

  console.log('=== GET /products ===');

  await check('returns 200 with a products array', async () => {
    const lines = [];
    const handler = createGetProductsHandler({
      store: fakeStore(),
      obsFactory: quietObs(lines),
    });
    const res = await handler(makeEvent(), {});
    assert.strictEqual(res.statusCode, 200);
    assert.deepStrictEqual(body(res), { products: [PRODUCT] });
  });

  await check('uses only the read port method', async () => {
    const store = fakeStore();
    await createGetProductsHandler({ store: store, obsFactory: quietObs([]) })(
      makeEvent(),
      {}
    );
    assert.deepStrictEqual(store.calls, [['getProducts']]);
  });

  await check('emits the productsRetrieved metric and a completion log', async () => {
    const lines = [];
    await createGetProductsHandler({
      store: fakeStore(),
      obsFactory: quietObs(lines),
    })(makeEvent(), {});
    assert.ok(lines.some((l) => l.type === 'metric' && l.name === 'productsRetrieved'));
    assert.ok(lines.some((l) => l.type === 'log' && l.message === 'request completed'));
  });

  await check('tolerates an undefined list from the store', async () => {
    const res = await createGetProductsHandler({
      store: fakeStore({ products: undefined }),
      obsFactory: quietObs([]),
    })(makeEvent(), {});
    assert.deepStrictEqual(body(res), { products: [] });
  });

  console.log('=== GET /products/{id} ===');

  const oneEvent = () =>
    makeEvent({
      httpMethod: 'GET',
      path: '/release/products/p-42',
      pathParameters: { id: 'p-42' },
      requestContext: { resourcePath: '/products/{id}', requestId: 'req-2' },
    });

  await check('returns 200 with the product', async () => {
    const res = await createGetProductHandler({
      store: fakeStore(),
      obsFactory: quietObs([]),
    })(oneEvent(), {});
    assert.strictEqual(res.statusCode, 200);
    assert.deepStrictEqual(body(res), PRODUCT);
  });

  await check('returns 404 when the product is absent', async () => {
    const res = await createGetProductHandler({
      store: fakeStore({ product: undefined }),
      obsFactory: quietObs([]),
    })(oneEvent(), {});
    assert.strictEqual(res.statusCode, 404);
    assert.deepStrictEqual(body(res), { message: 'Product not found' });
  });

  await check('returns 400 when the id is missing', async () => {
    const res = await createGetProductHandler({
      store: fakeStore(),
      obsFactory: quietObs([]),
    })(makeEvent(), {});
    assert.strictEqual(res.statusCode, 400);
    assert.ok(body(res).message.includes("Missing 'id'"));
  });

  console.log('=== PUT /products/{id} ===');

  const putEvent = (overrides) =>
    makeEvent(
      Object.assign(
        {
          httpMethod: 'PUT',
          path: '/release/products/p-42',
          pathParameters: { id: 'p-42' },
          body: JSON.stringify(PRODUCT),
          requestContext: { resourcePath: '/products/{id}', requestId: 'req-3' },
        },
        overrides || {}
      )
    );

  await check('returns 201 for a valid product', async () => {
    const res = await createPutProductHandler({
      store: fakeStore(),
      obsFactory: quietObs([]),
    })(putEvent(), {});
    assert.strictEqual(res.statusCode, 201);
    assert.deepStrictEqual(body(res), { message: 'Product created' });
  });

  await check('writes the exact parsed product through the port', async () => {
    const store = fakeStore();
    await createPutProductHandler({ store: store, obsFactory: quietObs([]) })(
      putEvent(),
      {}
    );
    assert.deepStrictEqual(store.calls, [['putProduct', PRODUCT]]);
  });

  await check('emits the productCreated metric', async () => {
    const lines = [];
    await createPutProductHandler({
      store: fakeStore(),
      obsFactory: quietObs(lines),
    })(putEvent(), {});
    assert.ok(lines.some((l) => l.type === 'metric' && l.name === 'productCreated'));
  });

  await check('rejects a missing id with 400', async () => {
    const res = await createPutProductHandler({
      store: fakeStore(),
      obsFactory: quietObs([]),
    })(putEvent({ pathParameters: null, path: '/products' }), {});
    assert.strictEqual(res.statusCode, 400);
  });

  await check('rejects an empty body with 400', async () => {
    const res = await createPutProductHandler({
      store: fakeStore(),
      obsFactory: quietObs([]),
    })(putEvent({ body: null }), {});
    assert.strictEqual(res.statusCode, 400);
    assert.deepStrictEqual(body(res), { message: 'Empty request body' });
  });

  await check('rejects malformed JSON with 400', async () => {
    const res = await createPutProductHandler({
      store: fakeStore(),
      obsFactory: quietObs([]),
    })(putEvent({ body: '{not-json' }), {});
    assert.strictEqual(res.statusCode, 400);
    assert.ok(body(res).message.includes('Failed to parse'));
  });

  await check('rejects a non-object JSON body with 400', async () => {
    const res = await createPutProductHandler({
      store: fakeStore(),
      obsFactory: quietObs([]),
    })(putEvent({ body: '[1,2,3]' }), {});
    assert.strictEqual(res.statusCode, 400);
  });

  await check('rejects a path/body id mismatch with 400', async () => {
    const res = await createPutProductHandler({
      store: fakeStore(),
      obsFactory: quietObs([]),
    })(putEvent({ body: JSON.stringify({ id: 'other', name: 'x', price: 1 }) }), {});
    assert.strictEqual(res.statusCode, 400);
    assert.ok(body(res).message.includes('does not match'));
  });

  await check('accepts a base64-encoded body', async () => {
    const res = await createPutProductHandler({
      store: fakeStore(),
      obsFactory: quietObs([]),
    })(
      putEvent({
        body: Buffer.from(JSON.stringify(PRODUCT)).toString('base64'),
        isBase64Encoded: true,
      }),
      {}
    );
    assert.strictEqual(res.statusCode, 201);
  });

  await check('accepts an already parsed object body', async () => {
    const res = await createPutProductHandler({
      store: fakeStore(),
      obsFactory: quietObs([]),
    })(putEvent({ body: PRODUCT }), {});
    assert.strictEqual(res.statusCode, 201);
  });

  console.log('=== DELETE /products/{id} ===');

  const delEvent = () =>
    makeEvent({
      httpMethod: 'DELETE',
      path: '/release/products/p-42',
      pathParameters: { id: 'p-42' },
      requestContext: { resourcePath: '/products/{id}', requestId: 'req-4' },
    });

  await check('returns 200 and calls the delete port method', async () => {
    const store = fakeStore();
    const res = await createDeleteProductHandler({
      store: store,
      obsFactory: quietObs([]),
    })(delEvent(), {});
    assert.strictEqual(res.statusCode, 200);
    assert.deepStrictEqual(body(res), { message: 'Product deleted' });
    assert.deepStrictEqual(store.calls, [['deleteProduct', 'p-42']]);
  });

  await check('emits the productDeleted metric', async () => {
    const lines = [];
    await createDeleteProductHandler({
      store: fakeStore(),
      obsFactory: quietObs(lines),
    })(delEvent(), {});
    assert.ok(lines.some((l) => l.type === 'metric' && l.name === 'productDeleted'));
  });

  await check('rejects a missing id with 400', async () => {
    const res = await createDeleteProductHandler({
      store: fakeStore(),
      obsFactory: quietObs([]),
    })(makeEvent(), {});
    assert.strictEqual(res.statusCode, 400);
  });

  console.log('=== Error boundary and responses ===');

  await check('a failing store returns 500 and logs the failure', async () => {
    const store = fakeStore();
    store.putProduct = async () => {
      throw new Error('table unavailable');
    };
    const lines = [];
    const res = await createPutProductHandler({
      store: store,
      obsFactory: quietObs(lines),
    })(putEvent(), {});
    assert.strictEqual(res.statusCode, 500);
    assert.deepStrictEqual(body(res), { message: 'Internal server error' });
    assert.ok(lines.some((l) => l.type === 'log' && l.level === 'ERROR'));
  });

  await check('responses carry status, CORS headers and a JSON body', () => {
    const res = reply(200, { ok: true }, { CORS_ALLOW_ORIGIN: 'https://example.test' });
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.headers['Access-Control-Allow-Origin'], 'https://example.test');
    assert.strictEqual(res.headers['Content-Type'], 'application/json');
    assert.strictEqual(res.isBase64Encoded, false);
    assert.deepStrictEqual(JSON.parse(res.body), { ok: true });
  });

  console.log('=== Event decoding ===');

  await check('path id resolves from path parameters', () => {
    assert.strictEqual(pathId(makeEvent({ pathParameters: { id: 'abc' } })), 'abc');
  });

  await check('path id resolves from query parameters', () => {
    assert.strictEqual(
      pathId(makeEvent({ queryStringParameters: { id: 'q-1' } })),
      'q-1'
    );
  });

  await check('path id resolves from a staged path tail', () => {
    assert.strictEqual(pathId(makeEvent({ path: '/release/products/xyz' })), 'xyz');
    assert.strictEqual(pathId(makeEvent({ path: '/products' })), undefined);
  });

  await check('body decoding handles base64, plain text and objects', () => {
    assert.strictEqual(
      bodyText(makeEvent({ body: 'eyJhIjoxfQ==', isBase64Encoded: true })),
      '{"a":1}'
    );
    assert.strictEqual(bodyText(makeEvent({ body: 'plain' })), 'plain');
    assert.strictEqual(bodyText(makeEvent({ body: { a: 1 } })), '{"a":1}');
    assert.strictEqual(bodyText(makeEvent({ body: null })), null);
  });

  await check('resource path falls back to event.path', () => {
    assert.strictEqual(resourcePath(makeEvent()), '/products');
    assert.strictEqual(
      resourcePath(makeEvent({ requestContext: null, path: '/fallback' })),
      '/fallback'
    );
  });

  await check('trace id is taken from a case-insensitive header', () => {
    assert.strictEqual(
      traceId(makeEvent({ headers: { 'X-Trace-Id': 'trace-77' } })),
      'trace-77'
    );
    assert.strictEqual(traceId(makeEvent({ requestContext: { requestId: 'req-9' } })), 'req-9');
  });

  console.log('=== Observability facade ===');

  await check('log lines are structured with service and trace id', () => {
    const lines = [];
    const obs = createObservability('trace-1', { LOG_LEVEL: 'INFO' }, (l) =>
      lines.push(JSON.parse(l))
    );
    obs.log('INFO', 'hello', { product_id: 'p-1' });
    const line = lines[0];
    assert.strictEqual(line.type, 'log');
    assert.strictEqual(levelOrThrow(line), 'INFO');
    assert.strictEqual(line.trace_id, 'trace-1');
    assert.strictEqual(line.service, 'serverless-crud-api');
    assert.strictEqual(line.product_id, 'p-1');
    assert.ok(line.ts);
  });

  await check('metric lines carry namespace, name, value and unit', () => {
    const lines = [];
    const obs = createObservability('trace-2', {}, (l) => lines.push(JSON.parse(l)));
    obs.metric('productCreated', 1, { status_code: 201 });
    const line = lines[0];
    assert.strictEqual(line.type, 'metric');
    assert.strictEqual(line.metric, 'productCreated');
    assert.strictEqual(line.namespace, 'HuaweiCloud/ServerlessCRUD');
    assert.strictEqual(line.value, 1);
    assert.strictEqual(line.unit, 'Count');
    assert.strictEqual(line.status_code, 201);
  });

  await check('LOG_LEVEL filters lower-severity lines', () => {
    const lines = [];
    const obs = createObservability('trace-3', { LOG_LEVEL: 'WARN' }, (l) =>
      lines.push(JSON.parse(l))
    );
    obs.log('INFO', 'hidden');
    obs.log('WARN', 'visible');
    assert.strictEqual(lines.length, 1);
    assert.strictEqual(lines[0].message, 'visible');
  });

  console.log('=== Store adapter ===');

  await check('readConfig requires all four settings and applies defaults', () => {
    assert.throws(() => readConfig({}), /Missing table configuration/);
    const cfg = readConfig({
      GEMINIDB_ENDPOINT: '10.0.1.20:80',
      GEMINIDB_ACCESS_KEY: 'rwuser',
      GEMINIDB_SECRET_KEY: 'test-secret',
      PRODUCT_TABLE: 'Products',
    });
    assert.strictEqual(cfg.protocol, 'http');
    assert.strictEqual(cfg.region, 'cn-north-4');
    assert.strictEqual(cfg.tableName, 'Products');
  });

  await check('buildClient constructs a client without a network call', () => {
    const client = buildClient({
      endpoint: '10.0.1.20:80',
      protocol: 'http',
      accessKey: 'rwuser',
      secretKey: 'test-secret',
      region: 'cn-north-4',
      tableName: 'Products',
    });
    assert.strictEqual(typeof client.send, 'function');
  });

  await check('ensureTable probes description before creating a table', async () => {
    const seen = [];
    const fake = {
      async send(command) {
        seen.push(command.constructor.name);
        if (command.constructor.name === 'DescribeTableCommand') {
          throw new Error('ResourceNotFoundException');
        }
        return {};
      },
    };
    await ensureTable(fake, 'Products');
    assert.deepStrictEqual(seen, ['DescribeTableCommand', 'CreateTableCommand']);
  });

  await check('GeminiDbStore implements all four port methods', () => {
    const proto = GeminiDbStore.prototype;
    ['getProduct', 'putProduct', 'deleteProduct', 'getProducts'].forEach((m) =>
      assert.strictEqual(typeof proto[m], 'function', m)
    );
  });

  await check('GeminiDbStore issues only the expected command per port method', async () => {
    const seen = [];
    const fake = {
      async send(command) {
        const name = command.constructor.name;
        seen.push(name);
        if (name === 'GetCommand') return { Item: PRODUCT };
        if (name === 'ScanCommand') return { Items: [PRODUCT] };
        return {};
      },
    };
    const store = new GeminiDbStore(
      {
        endpoint: '10.0.1.20:80',
        protocol: 'http',
        accessKey: 'rwuser',
        secretKey: 'test-secret',
        region: 'cn-north-4',
        tableName: 'Products',
      },
      fake
    );
    await store.getProduct('p-42');
    await store.getProducts();
    await store.putProduct(PRODUCT);
    await store.deleteProduct('p-42');
    assert.ok(seen.includes('GetCommand'));
    assert.ok(seen.includes('ScanCommand'));
    assert.ok(seen.includes('PutCommand'));
    assert.ok(seen.includes('DeleteCommand'));
  });

  await check('isProduct rejects arrays, null and bodies without a string id', () => {
    assert.strictEqual(isProduct(PRODUCT), true);
    assert.strictEqual(isProduct([PRODUCT]), false);
    assert.strictEqual(isProduct(null), false);
    assert.strictEqual(isProduct({ name: 'x' }), false);
  });

  console.log('\n=== Summary: ' + passed + ' passed, ' + failed + ' failed ===');
  if (failed > 0) {
    console.log('\nFailures:\n' + failures.join('\n'));
    process.exit(1);
  }
})();

function levelOrThrow(line) {
  return line.level;
}
