import {
  CreateTableCommand,
  DescribeTableCommand,
  DynamoDBClient,
} from '@aws-sdk/client-dynamodb';
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  ScanCommand,
} from '@aws-sdk/lib-dynamodb';
import { Product } from '../model/Product';
import { ProductStore } from './ProductStore';

export interface StoreConfig {
  endpoint: string;
  protocol: string;
  accessKey: string;
  secretKey: string;
  region: string;
  tableName: string;
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): StoreConfig {
  const required = [
    'GEMINIDB_ENDPOINT',
    'GEMINIDB_ACCESS_KEY',
    'GEMINIDB_SECRET_KEY',
    'PRODUCT_TABLE',
  ];
  const missing = required.filter((key) => !env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing table configuration: ${missing.join(', ')}`);
  }
  return {
    endpoint: String(env.GEMINIDB_ENDPOINT),
    protocol: env.GEMINIDB_PROTOCOL || 'http',
    accessKey: String(env.GEMINIDB_ACCESS_KEY),
    secretKey: String(env.GEMINIDB_SECRET_KEY),
    region: env.REGION || 'cn-north-4',
    tableName: String(env.PRODUCT_TABLE),
  };
}

/**
 * The table service speaks the DynamoDB-compatible wire protocol, so the
 * protocol client is the only way to reach it. Credentials are the instance account (rwuser)
 * plus the instance administrator password, supplied as function user data.
 */
export function buildClient(config: StoreConfig): DynamoDBDocumentClient {
  const base = new DynamoDBClient({
    region: config.region,
    endpoint: `${config.protocol}://${config.endpoint}`,
    credentials: {
      accessKeyId: config.accessKey,
      secretAccessKey: config.secretKey,
    },
  });
  return DynamoDBDocumentClient.from(base, {
    marshallOptions: { removeUndefinedValues: true },
  });
}

/**
 * Describe first, create only when absent. Some compatible backends expose
 * tables lazily, so a ResourceNotFoundException is treated as "needs create".
 */
export async function ensureTable(
  client: Pick<DynamoDBDocumentClient, 'send'>,
  tableName: string
): Promise<void> {
  try {
    await client.send(new DescribeTableCommand({ TableName: tableName }));
  } catch {
    await client.send(
      new CreateTableCommand({
        TableName: tableName,
        AttributeDefinitions: [{ AttributeName: 'id', AttributeType: 'S' }],
        KeySchema: [{ AttributeName: 'id', KeyType: 'HASH' }],
      })
    );
  }
}

/** The single adapter behind the port: reads use Get/Scan, writes use Put/Delete. */
export class GeminiDbStore implements ProductStore {
  private readonly config: StoreConfig;
  private readonly client: Pick<DynamoDBDocumentClient, 'send'>;

  constructor(
    config: StoreConfig = readConfig(),
    client?: Pick<DynamoDBDocumentClient, 'send'>
  ) {
    this.config = config;
    this.client = client || buildClient(config);
  }

  async getProduct(id: string): Promise<Product | undefined> {
    await ensureTable(this.client, this.config.tableName);
    const result = await this.client.send(
      new GetCommand({ TableName: this.config.tableName, Key: { id } })
    );
    return result.Item as Product | undefined;
  }

  async putProduct(product: Product): Promise<void> {
    await ensureTable(this.client, this.config.tableName);
    await this.client.send(
      new PutCommand({
        TableName: this.config.tableName,
        Item: { id: product.id, name: product.name, price: product.price },
      })
    );
  }

  async deleteProduct(id: string): Promise<void> {
    await ensureTable(this.client, this.config.tableName);
    await this.client.send(
      new DeleteCommand({ TableName: this.config.tableName, Key: { id } })
    );
  }

  async getProducts(): Promise<Product[] | undefined> {
    await ensureTable(this.client, this.config.tableName);
    const result = await this.client.send(
      new ScanCommand({ TableName: this.config.tableName, Limit: 20 })
    );
    return result.Items as Product[] | undefined;
  }
}
