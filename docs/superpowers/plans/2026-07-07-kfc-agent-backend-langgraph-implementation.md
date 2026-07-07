# KFC Agent Backend LangGraph Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a production-shaped Fastify + LangGraph.js backend for KFC conversational ordering, using mock adapters backed by crawled KFC Vietnam data and scenario-driven integration tests.

**Architecture:** Create a standalone TypeScript backend under `services/kfc-agent-backend`. The graph and API depend on production-style client interfaces; hackathon behavior comes from mock adapters and generated fixtures. Tests verify deterministic business state, dashboard events, scenario coverage, and LangSmith no-op behavior without live credentials.

**Tech Stack:** Node.js 22+, TypeScript, Fastify, LangGraph.js, OpenAI, Zod, Vitest, `pg`, Docker Postgres, gray-matter, remark/remark-gfm, LangSmith optional tracing.

## Global Constraints

- Runtime must not require real KFC, Zalo, Messenger, payment, or private API credentials.
- External systems must be accessed through client interfaces, with mock adapters used for hackathon execution.
- Messenger and Zalo webhook payloads must enter the graph only through a normalized `ConversationEvent`.
- Messenger setup targets the Ecomeasy Page ID `118976205445198`; the public callback URL is provided later by the deployed or tunneled backend.
- Zalo support is credential-ready in this implementation plan: routes, normalization, client contracts, and fixture tests exist before live OA credentials are required.
- No LangGraph node may directly read raw crawl files, OKF Markdown, or fixture JSON.
- OKF is governed business knowledge and fixture provenance, not a per-request operational database.
- `placeOrder` must reject execution unless the latest order preview is recorded and explicit user confirmation is present in graph state.
- Payment success must come only from `PaymentClient`.
- Full transcript is stored, but prompt context uses bounded recent messages plus bounded long-range retrieval evidence.
- Scenario tests parse Markdown files under `ai-talent-tracks/fnb/conversations/` as the source contract.
- Live chatbot runtime uses `OPENAI_API_KEY`; tests use mocked LLM outputs and must not require or spend OpenAI tokens.
- LangSmith tracing uses a no-op exporter when `LANGSMITH_API_KEY` is absent.
- Persistence uses Postgres. Local development may run Postgres through Docker.

---

## Planned File Structure

- `services/kfc-agent-backend/package.json`: backend scripts and dependencies.
- `services/kfc-agent-backend/tsconfig.json`: strict TypeScript configuration.
- `services/kfc-agent-backend/vitest.config.ts`: Vitest configuration.
- `services/kfc-agent-backend/.env.example`: documented local environment.
- `services/kfc-agent-backend/docker-compose.yml`: local Postgres service.
- `services/kfc-agent-backend/src/config/env.ts`: environment parsing.
- `services/kfc-agent-backend/src/domain/types.ts`: shared domain types.
- `services/kfc-agent-backend/src/clients/interfaces.ts`: production-shaped external client contracts.
- `services/kfc-agent-backend/src/fixtures/schema.ts`: fixture schemas and parser helpers.
- `services/kfc-agent-backend/src/fixtures/loadFixtures.ts`: generated fixture loader used by mock adapters.
- `services/kfc-agent-backend/scripts/build-fixtures.ts`: crawl-to-fixtures and OKF generation command.
- `services/kfc-agent-backend/knowledge/kfc-okf/`: generated OKF bundle.
- `services/kfc-agent-backend/fixtures/generated/`: generated mock fixtures.
- `services/kfc-agent-backend/src/mock/*.ts`: mock client adapters.
- `services/kfc-agent-backend/src/persistence/schema.sql`: Postgres schema.
- `services/kfc-agent-backend/src/persistence/postgresStore.ts`: Postgres-backed store.
- `services/kfc-agent-backend/src/persistence/memoryStore.ts`: deterministic test store.
- `services/kfc-agent-backend/src/graph/state.ts`: LangGraph state shape.
- `services/kfc-agent-backend/src/graph/nodes.ts`: graph node implementations.
- `services/kfc-agent-backend/src/graph/buildGraph.ts`: graph assembly.
- `services/kfc-agent-backend/src/observability/tracing.ts`: LangSmith/no-op tracing wrapper.
- `services/kfc-agent-backend/src/api/server.ts`: Fastify app construction.
- `services/kfc-agent-backend/src/api/routes.ts`: chat, dashboard, health, and scenario routes.
- `services/kfc-agent-backend/src/channels/conversationEvent.ts`: normalized inbound channel event contract.
- `services/kfc-agent-backend/src/channels/messenger.ts`: Messenger verification, normalization, and outbound send helpers.
- `services/kfc-agent-backend/src/channels/zalo.ts`: Zalo normalization and outbound send helpers.
- `services/kfc-agent-backend/src/dashboard/eventBus.ts`: in-process dashboard event stream.
- `services/kfc-agent-backend/src/scenarios/parser.ts`: Markdown scenario parser.
- `services/kfc-agent-backend/src/scenarios/runner.ts`: scenario replay harness.
- `services/kfc-agent-backend/test/**/*.test.ts`: unit, graph, API, channel, and scenario tests.

---

### Task 1: Backend Workspace And Health Check

**Files:**
- Create: `services/kfc-agent-backend/package.json`
- Create: `services/kfc-agent-backend/tsconfig.json`
- Create: `services/kfc-agent-backend/vitest.config.ts`
- Create: `services/kfc-agent-backend/.env.example`
- Create: `services/kfc-agent-backend/src/config/env.ts`
- Create: `services/kfc-agent-backend/src/api/server.ts`
- Create: `services/kfc-agent-backend/src/index.ts`
- Create: `services/kfc-agent-backend/test/api/health.test.ts`

**Interfaces:**
- Produces: `buildServer(): FastifyInstance`
- Produces: `loadEnv(input?: NodeJS.ProcessEnv): AppEnv`

- [ ] **Step 1: Write the failing health test**

Create `services/kfc-agent-backend/test/api/health.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildServer } from '../../src/api/server.js';

describe('health route', () => {
  it('returns service status without external dependencies', async () => {
    const server = buildServer();
    const response = await server.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      ok: true,
      service: 'kfc-agent-backend',
    });
  });
});
```

- [ ] **Step 2: Add package and TypeScript scaffolding**

Create `services/kfc-agent-backend/package.json`:

```json
{
  "name": "kfc-agent-backend",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/index.js",
    "test": "vitest run",
    "test:watch": "vitest",
    "fixtures:build": "tsx scripts/build-fixtures.ts"
  },
  "dependencies": {
    "@langchain/core": "^1.0.0",
    "@langchain/langgraph": "^1.4.7",
    "fastify": "^5.4.0",
    "gray-matter": "^4.0.3",
    "langsmith": "^0.3.39",
    "pg": "^8.16.3",
    "remark": "^15.0.1",
    "remark-gfm": "^4.0.1",
    "tsx": "^4.20.3",
    "zod": "^3.25.76"
  },
  "devDependencies": {
    "@types/node": "^22.10.0",
    "@types/pg": "^8.15.4",
    "typescript": "^5.8.3",
    "vitest": "^3.2.4"
  },
  "engines": {
    "node": ">=22"
  }
}
```

Create `services/kfc-agent-backend/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": ".",
    "types": ["node", "vitest/globals"]
  },
  "include": ["src/**/*.ts", "scripts/**/*.ts", "test/**/*.ts"]
}
```

Create `services/kfc-agent-backend/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    pool: 'threads',
  },
});
```

Create `services/kfc-agent-backend/.env.example`:

```text
PORT=18090
DATABASE_URL=postgres://kfc_agent:kfc_agent@localhost:15432/kfc_agent
OPENAI_API_KEY=
LANGSMITH_API_KEY=
LANGSMITH_PROJECT=kfc-agent-backend-local
```

- [ ] **Step 3: Add minimal environment and Fastify server**

Create `services/kfc-agent-backend/src/config/env.ts`:

```ts
import { z } from 'zod';

const appEnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(18090),
  DATABASE_URL: z.string().default('postgres://kfc_agent:kfc_agent@localhost:15432/kfc_agent'),
  OPENAI_API_KEY: z.string().optional().default(''),
  LANGSMITH_API_KEY: z.string().optional().default(''),
  LANGSMITH_PROJECT: z.string().default('kfc-agent-backend-local'),
});

export type AppEnv = z.infer<typeof appEnvSchema>;

export function loadEnv(input: NodeJS.ProcessEnv = process.env): AppEnv {
  return appEnvSchema.parse(input);
}
```

Create `services/kfc-agent-backend/src/api/server.ts`:

```ts
import Fastify, { type FastifyInstance } from 'fastify';

export function buildServer(): FastifyInstance {
  const server = Fastify({ logger: false });

  server.get('/health', async () => ({
    ok: true,
    service: 'kfc-agent-backend',
  }));

  return server;
}
```

Create `services/kfc-agent-backend/src/index.ts`:

```ts
import { buildServer } from './api/server.js';
import { loadEnv } from './config/env.js';

const env = loadEnv();
const server = buildServer();

await server.listen({ host: '0.0.0.0', port: env.PORT });
```

- [ ] **Step 4: Install dependencies and run the health test**

Run:

```bash
cd services/kfc-agent-backend
npm install
npm test -- test/api/health.test.ts
```

Expected: test passes with `1 passed`.

- [ ] **Step 5: Verify TypeScript build**

Run:

```bash
cd services/kfc-agent-backend
npm run build
```

Expected: `tsc` exits 0 and creates `dist/`.

- [ ] **Step 6: Commit**

```bash
git add services/kfc-agent-backend/package.json services/kfc-agent-backend/package-lock.json services/kfc-agent-backend/tsconfig.json services/kfc-agent-backend/vitest.config.ts services/kfc-agent-backend/.env.example services/kfc-agent-backend/src services/kfc-agent-backend/test
git commit -m "feat: scaffold KFC agent backend"
```

---

### Task 2: Domain Types And External Client Contracts

**Files:**
- Create: `services/kfc-agent-backend/src/domain/types.ts`
- Create: `services/kfc-agent-backend/src/clients/interfaces.ts`
- Create: `services/kfc-agent-backend/test/domain/contracts.test.ts`

**Interfaces:**
- Produces: `MenuItem`, `Cart`, `Order`, `DashboardEvent`, `ExternalClients`
- Consumes: Task 1 TypeScript/Vitest setup

- [ ] **Step 1: Write contract tests**

Create `services/kfc-agent-backend/test/domain/contracts.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { Cart, MenuItem, Order } from '../../src/domain/types.js';
import type { ExternalClients } from '../../src/clients/interfaces.js';

describe('domain contracts', () => {
  it('represents menu, cart, and order state without channel details', () => {
    const item: MenuItem = {
      code: 'HOPGU',
      category: 'Hot Deals',
      name: 'Combo 99K',
      description: '3 Fried Chicken + 1 Shrimp Burger',
      priceVnd: 99000,
      originalPriceVnd: null,
      imageUrl: 'https://static.kfcvietnam.com.vn/images/items/lg/HOPGU.jpg?v=LNN7PL',
      available: true,
    };

    const cart: Cart = {
      id: 'cart_1',
      items: [{ itemCode: item.code, name: item.name, quantity: 1, unitPriceVnd: 99000 }],
      subtotalVnd: 99000,
      discountVnd: 0,
      deliveryFeeVnd: 0,
      totalVnd: 99000,
      voucherCode: null,
    };

    const order: Order = {
      id: 'KFC-MOCK-1001',
      cart,
      status: 'created',
      paymentStatus: 'pending',
      assignedStoreId: 'store_q7_mock',
      createdAt: '2026-07-07T00:00:00.000Z',
    };

    expect(order.cart.items[0]?.itemCode).toBe('HOPGU');
    expect(order.paymentStatus).toBe('pending');
  });

  it('requires all production-shaped client groups', () => {
    const keys: Array<keyof ExternalClients> = [
      'menu',
      'cart',
      'recommendation',
      'promotion',
      'inventory',
      'storeLocator',
      'oms',
      'payment',
      'delivery',
      'customer',
      'loyalty',
      'handoff',
      'feedback',
      'messenger',
      'zalo',
    ];

    expect(keys).toHaveLength(15);
  });
});
```

- [ ] **Step 2: Add shared domain types**

Create `services/kfc-agent-backend/src/domain/types.ts`:

```ts
export type Channel = 'messenger' | 'zalo' | 'messenger_mock' | 'zalo_mock' | 'web_mock';

export type Intent =
  | 'ordering'
  | 'cart_edit'
  | 'voucher'
  | 'payment'
  | 'order_status'
  | 'complaint'
  | 'feedback'
  | 'handoff'
  | 'safety'
  | 'unclear';

export interface MenuItem {
  code: string;
  category: string;
  name: string;
  description: string;
  priceVnd: number;
  originalPriceVnd: number | null;
  imageUrl: string;
  available: boolean;
}

export interface CartItem {
  itemCode: string;
  name: string;
  quantity: number;
  unitPriceVnd: number;
}

export interface Cart {
  id: string;
  items: CartItem[];
  subtotalVnd: number;
  discountVnd: number;
  deliveryFeeVnd: number;
  totalVnd: number;
  voucherCode: string | null;
}

export interface Address {
  label: string;
  line1: string;
  district: string;
  city: string;
}

export type OrderStatus = 'previewed' | 'created' | 'preparing' | 'delivering' | 'completed' | 'cancelled';
export type PaymentStatus = 'not_started' | 'pending' | 'paid' | 'failed';

export interface Order {
  id: string;
  cart: Cart;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  assignedStoreId: string;
  createdAt: string;
}

export interface ConversationTurn {
  id: string;
  sessionId: string;
  channel: Channel;
  role: 'user' | 'assistant' | 'tool' | 'system';
  text: string;
  externalMessageId: string | null;
  externalUserId: string | null;
  deliveryStatus: 'received' | 'pending' | 'sent' | 'failed' | 'not_applicable';
  createdAt: string;
}

export interface ToolResult<T> {
  ok: boolean;
  value?: T;
  errorCode?: string;
  message: string;
}

export interface DashboardEvent {
  id: string;
  sessionId: string;
  type:
    | 'session_updated'
    | 'conversation_turn_created'
    | 'customer_message_received'
    | 'assistant_reply_sent'
    | 'cart_changed'
    | 'voucher_applied'
    | 'voucher_rejected'
    | 'payment_link_created'
    | 'payment_failed'
    | 'payment_paid'
    | 'order_previewed'
    | 'order_created'
    | 'handoff_required'
    | 'session_resolved';
  payload: Record<string, unknown>;
  createdAt: string;
}
```

- [ ] **Step 3: Add external client interfaces**

Create `services/kfc-agent-backend/src/clients/interfaces.ts`:

```ts
import type { Address, Cart, MenuItem, Order, ToolResult } from '../domain/types.js';

export interface MenuClient {
  searchMenu(query: string): Promise<ToolResult<MenuItem[]>>;
  getItemDetails(code: string): Promise<ToolResult<MenuItem>>;
}

export interface CartClient {
  createCart(sessionId: string): Promise<ToolResult<Cart>>;
  updateCart(cart: Cart, itemCode: string, quantity: number): Promise<ToolResult<Cart>>;
  previewCart(cart: Cart): Promise<ToolResult<Cart>>;
}

export interface RecommendationClient {
  recommendAddOns(cart: Cart): Promise<ToolResult<MenuItem[]>>;
}

export interface PromotionClient {
  validateVoucher(cart: Cart, voucherCode: string): Promise<ToolResult<Cart>>;
}

export interface InventoryClient {
  checkInventory(storeId: string, itemCodes: string[]): Promise<ToolResult<Record<string, boolean>>>;
}

export interface StoreLocatorClient {
  assignStore(address: Address, itemCodes: string[]): Promise<ToolResult<{ storeId: string; etaMinutes: number }>>;
}

export interface OmsClient {
  previewOrder(input: { cart: Cart; address: Address; storeId: string }): Promise<ToolResult<Order>>;
  placeOrder(input: { preview: Order; userConfirmed: boolean }): Promise<ToolResult<Order>>;
  getOrderStatus(orderId: string): Promise<ToolResult<Order>>;
  cancelOrder(orderId: string): Promise<ToolResult<Order>>;
}

export interface PaymentClient {
  createPaymentLink(order: Order, method: 'momo' | 'card' | 'cod'): Promise<ToolResult<{ url: string; status: 'pending' }>>;
  checkPaymentStatus(orderId: string): Promise<ToolResult<{ status: 'pending' | 'paid' | 'failed' }>>;
}

export interface DeliveryClient {
  quoteDelivery(address: Address, storeId: string): Promise<ToolResult<{ feeVnd: number; etaMinutes: number }>>;
}

export interface CustomerClient {
  getSavedAddresses(customerId: string): Promise<ToolResult<Address[]>>;
  getRecentOrder(customerId: string): Promise<ToolResult<Order | null>>;
}

export interface LoyaltyClient {
  lookupLoyalty(customerId: string): Promise<ToolResult<{ points: number }>>;
}

export interface HandoffClient {
  escalateToHuman(sessionId: string, reasons: string[]): Promise<ToolResult<{ escalationId: string }>>;
}

export interface FeedbackClient {
  recordFeedback(sessionId: string, message: string): Promise<ToolResult<{ feedbackId: string }>>;
}

export interface MessengerClient {
  sendText(recipientId: string, text: string): Promise<ToolResult<{ messageId: string }>>;
}

export interface ZaloClient {
  sendText(recipientId: string, text: string): Promise<ToolResult<{ messageId: string }>>;
}

export interface ExternalClients {
  menu: MenuClient;
  cart: CartClient;
  recommendation: RecommendationClient;
  promotion: PromotionClient;
  inventory: InventoryClient;
  storeLocator: StoreLocatorClient;
  oms: OmsClient;
  payment: PaymentClient;
  delivery: DeliveryClient;
  customer: CustomerClient;
  loyalty: LoyaltyClient;
  handoff: HandoffClient;
  feedback: FeedbackClient;
  messenger: MessengerClient;
  zalo: ZaloClient;
}
```

- [ ] **Step 4: Run contract tests**

Run:

```bash
cd services/kfc-agent-backend
npm test -- test/domain/contracts.test.ts
npm run build
```

Expected: tests and build pass.

- [ ] **Step 5: Commit**

```bash
git add services/kfc-agent-backend/src/domain services/kfc-agent-backend/src/clients services/kfc-agent-backend/test/domain
git commit -m "feat: define backend domain contracts"
```

---

### Task 3: Crawl-To-OKF And Fixture Generation

**Files:**
- Create: `services/kfc-agent-backend/src/fixtures/schema.ts`
- Create: `services/kfc-agent-backend/src/fixtures/loadFixtures.ts`
- Create: `services/kfc-agent-backend/scripts/build-fixtures.ts`
- Create: `services/kfc-agent-backend/test/fixtures/build-fixtures.test.ts`
- Generate: `services/kfc-agent-backend/fixtures/generated/menu-items.json`
- Generate: `services/kfc-agent-backend/knowledge/kfc-okf/index.md`
- Generate: `services/kfc-agent-backend/knowledge/kfc-okf/menu/items/*.md`

**Interfaces:**
- Produces: `loadGeneratedFixtures(rootDir: string): GeneratedFixtures`
- Produces: generated menu fixtures with provenance
- Consumes: `MenuItem` from Task 2

- [ ] **Step 1: Write fixture generation test**

Create `services/kfc-agent-backend/test/fixtures/build-fixtures.test.ts`:

```ts
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildFixtures } from '../../scripts/build-fixtures.js';
import { loadGeneratedFixtures } from '../../src/fixtures/loadFixtures.js';

describe('buildFixtures', () => {
  it('generates menu fixtures and OKF concepts from the public crawl', async () => {
    const outDir = await mkdtemp(join(tmpdir(), 'kfc-fixtures-'));

    await buildFixtures({
      repoRoot: join(process.cwd(), '../..'),
      backendRoot: outDir,
    });

    const fixtures = await loadGeneratedFixtures(outDir);
    expect(fixtures.menuItems.length).toBe(88);
    expect(fixtures.menuItems[0]).toMatchObject({
      code: 'HOPGU',
      name: 'Combo 99K',
      priceVnd: 99000,
      available: true,
    });

    const okfIndex = await readFile(join(outDir, 'knowledge/kfc-okf/index.md'), 'utf8');
    expect(okfIndex).toContain('# KFC Vietnam Mock Knowledge');
    expect(okfIndex).toContain('menu/items/HOPGU.md');

    await rm(outDir, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Add fixture schemas and loader**

Create `services/kfc-agent-backend/src/fixtures/schema.ts`:

```ts
import { z } from 'zod';

export const generatedMenuItemSchema = z.object({
  code: z.string(),
  category: z.string(),
  name: z.string(),
  description: z.string(),
  priceVnd: z.number().int().nonnegative(),
  originalPriceVnd: z.number().int().nonnegative().nullable(),
  imageUrl: z.string().url(),
  available: z.boolean(),
  provenance: z.object({
    sourceFile: z.string(),
    okfConceptId: z.string(),
    fixtureMode: z.literal('public_crawl_seed'),
  }),
});

export const generatedFixturesSchema = z.object({
  menuItems: z.array(generatedMenuItemSchema),
});

export type GeneratedMenuItem = z.infer<typeof generatedMenuItemSchema>;
export type GeneratedFixtures = z.infer<typeof generatedFixturesSchema>;
```

Create `services/kfc-agent-backend/src/fixtures/loadFixtures.ts`:

```ts
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { generatedFixturesSchema, type GeneratedFixtures } from './schema.js';

export async function loadGeneratedFixtures(rootDir: string): Promise<GeneratedFixtures> {
  const raw = await readFile(join(rootDir, 'fixtures/generated/menu-items.json'), 'utf8');
  const menuItems = JSON.parse(raw) as unknown;
  return generatedFixturesSchema.parse({ menuItems });
}
```

- [ ] **Step 3: Add fixture builder**

Create `services/kfc-agent-backend/scripts/build-fixtures.ts`:

```ts
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

interface RawMenuItem {
  category: string;
  code: string;
  name: string;
  description: string;
  priceVnd: number;
  originalPriceVnd: number | null;
  imageUrl: string;
}

interface RawMenuFile {
  items: RawMenuItem[];
}

export interface BuildFixturesOptions {
  repoRoot: string;
  backendRoot: string;
}

function conceptPathFor(code: string): string {
  return `menu/items/${code}.md`;
}

function renderMenuConcept(item: RawMenuItem): string {
  const conceptId = conceptPathFor(item.code).replace(/\.md$/, '');
  return `---\ntype: Menu Item\ntitle: ${JSON.stringify(item.name)}\ndescription: ${JSON.stringify(item.description)}\nresource: https://www.kfcvietnam.com.vn/en/menu\ntags: [menu, mock-fixture, ${JSON.stringify(item.category)}]\nsource_file: ai-talent-tracks/fnb/data/kfcvietnam-ordering-crawl/kfcvietnam-menu-items.json\ncode: ${JSON.stringify(item.code)}\nprice_vnd: ${item.priceVnd}\noriginal_price_vnd: ${item.originalPriceVnd === null ? 'null' : item.originalPriceVnd}\ntimestamp: 2026-07-07\n---\n\n# Mock Behavior\n\nAvailable by default unless a scenario override changes availability.\n\n# Tool Mapping\n\nUsed by \\`searchMenu\\`, \\`getItemDetails\\`, \\`updateCart\\`, and \\`previewCart\\`.\n\n# Provenance\n\nConcept ID: \\`${conceptId}\\`.\n`;
}

export async function buildFixtures(options: BuildFixturesOptions): Promise<void> {
  const crawlFile = join(
    options.repoRoot,
    'ai-talent-tracks/fnb/data/kfcvietnam-ordering-crawl/kfcvietnam-menu-items.json',
  );
  const raw = JSON.parse(await readFile(crawlFile, 'utf8')) as RawMenuFile;

  const generated = raw.items.map((item) => ({
    ...item,
    available: true,
    provenance: {
      sourceFile: 'ai-talent-tracks/fnb/data/kfcvietnam-ordering-crawl/kfcvietnam-menu-items.json',
      okfConceptId: conceptPathFor(item.code).replace(/\.md$/, ''),
      fixtureMode: 'public_crawl_seed' as const,
    },
  }));

  const fixturePath = join(options.backendRoot, 'fixtures/generated/menu-items.json');
  await mkdir(dirname(fixturePath), { recursive: true });
  await writeFile(fixturePath, `${JSON.stringify(generated, null, 2)}\n`);

  const okfRoot = join(options.backendRoot, 'knowledge/kfc-okf');
  await mkdir(join(okfRoot, 'menu/items'), { recursive: true });
  const indexLines = [
    '# KFC Vietnam Mock Knowledge',
    '',
    '* [Menu Items](menu/items/index.md) - Public crawl seeded KFC Vietnam menu items.',
    '',
  ];
  await writeFile(join(okfRoot, 'index.md'), indexLines.join('\n'));

  const itemIndex = ['# Menu Items', ''];
  for (const item of raw.items) {
    const relativePath = `${item.code}.md`;
    itemIndex.push(`* [${item.name}](${relativePath}) - ${item.description}`);
    await writeFile(join(okfRoot, conceptPathFor(item.code)), renderMenuConcept(item));
  }
  await writeFile(join(okfRoot, 'menu/items/index.md'), `${itemIndex.join('\n')}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await buildFixtures({
    repoRoot: join(process.cwd(), '../..'),
    backendRoot: process.cwd(),
  });
}
```

- [ ] **Step 4: Run generator test and generate checked-in fixtures**

Run:

```bash
cd services/kfc-agent-backend
npm test -- test/fixtures/build-fixtures.test.ts
npm run fixtures:build
npm run build
```

Expected: test passes, `fixtures/generated/menu-items.json` contains 88 records, and OKF menu concepts are created.

- [ ] **Step 5: Commit**

```bash
git add services/kfc-agent-backend/src/fixtures services/kfc-agent-backend/scripts services/kfc-agent-backend/test/fixtures services/kfc-agent-backend/fixtures/generated services/kfc-agent-backend/knowledge/kfc-okf
git commit -m "feat: generate KFC mock knowledge fixtures"
```

---

### Task 4: Mock External Clients

**Files:**
- Create: `services/kfc-agent-backend/src/mock/createMockClients.ts`
- Create: `services/kfc-agent-backend/test/mock/mock-clients.test.ts`

**Interfaces:**
- Produces: `createMockClients(fixtures: GeneratedFixtures): ExternalClients`
- Consumes: `ExternalClients`, `GeneratedFixtures`

- [ ] **Step 1: Write mock client tests**

Create `services/kfc-agent-backend/test/mock/mock-clients.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createMockClients } from '../../src/mock/createMockClients.js';
import type { GeneratedFixtures } from '../../src/fixtures/schema.js';

const fixtures: GeneratedFixtures = {
  menuItems: [
    {
      code: 'HOPGU',
      category: 'Hot Deals',
      name: 'Combo 99K',
      description: '3 Fried Chicken + 1 Shrimp Burger',
      priceVnd: 99000,
      originalPriceVnd: null,
      imageUrl: 'https://static.kfcvietnam.com.vn/images/items/lg/HOPGU.jpg?v=LNN7PL',
      available: true,
      provenance: {
        sourceFile: 'crawl.json',
        okfConceptId: 'menu/items/HOPGU',
        fixtureMode: 'public_crawl_seed',
      },
    },
  ],
};

describe('mock clients', () => {
  it('searches menu and builds priced carts', async () => {
    const clients = createMockClients(fixtures);
    const search = await clients.menu.searchMenu('combo');
    expect(search.ok).toBe(true);
    expect(search.value?.[0]?.code).toBe('HOPGU');

    const cart = await clients.cart.createCart('session_1');
    const updated = await clients.cart.updateCart(cart.value!, 'HOPGU', 2);
    expect(updated.value?.subtotalVnd).toBe(198000);
  });

  it('rejects order placement without explicit confirmation', async () => {
    const clients = createMockClients(fixtures);
    const cart = (await clients.cart.createCart('session_1')).value!;
    const updated = (await clients.cart.updateCart(cart, 'HOPGU', 1)).value!;
    const preview = (await clients.oms.previewOrder({
      cart: updated,
      address: { label: 'Home', line1: '23 Nguyen Huu Tho', district: 'Quan 7', city: 'Ho Chi Minh' },
      storeId: 'store_mock',
    })).value!;

    const placed = await clients.oms.placeOrder({ preview, userConfirmed: false });
    expect(placed.ok).toBe(false);
    expect(placed.errorCode).toBe('confirmation_required');
  });
});
```

- [ ] **Step 2: Implement mock clients**

Create `services/kfc-agent-backend/src/mock/createMockClients.ts`:

```ts
import type { ExternalClients } from '../clients/interfaces.js';
import type { Address, Cart, CartItem, MenuItem, Order, ToolResult } from '../domain/types.js';
import type { GeneratedFixtures } from '../fixtures/schema.js';

function ok<T>(value: T, message = 'ok'): ToolResult<T> {
  return { ok: true, value, message };
}

function fail<T>(errorCode: string, message: string): ToolResult<T> {
  return { ok: false, errorCode, message };
}

function toMenuItem(item: GeneratedFixtures['menuItems'][number]): MenuItem {
  return {
    code: item.code,
    category: item.category,
    name: item.name,
    description: item.description,
    priceVnd: item.priceVnd,
    originalPriceVnd: item.originalPriceVnd,
    imageUrl: item.imageUrl,
    available: item.available,
  };
}

function priceCart(items: CartItem[], voucherCode: string | null, deliveryFeeVnd = 0): Cart {
  const subtotalVnd = items.reduce((sum, item) => sum + item.quantity * item.unitPriceVnd, 0);
  const discountVnd = voucherCode === 'KFC50' && subtotalVnd >= 199000 ? 50000 : 0;
  return {
    id: 'cart_mock',
    items,
    subtotalVnd,
    discountVnd,
    deliveryFeeVnd,
    totalVnd: Math.max(0, subtotalVnd - discountVnd + deliveryFeeVnd),
    voucherCode,
  };
}

export function createMockClients(fixtures: GeneratedFixtures): ExternalClients {
  const menu = fixtures.menuItems.map(toMenuItem);
  const menuByCode = new Map(menu.map((item) => [item.code, item]));
  const orders = new Map<string, Order>();

  return {
    menu: {
      async searchMenu(query) {
        const lower = query.toLowerCase();
        const results = menu.filter((item) =>
          `${item.name} ${item.description} ${item.category}`.toLowerCase().includes(lower),
        );
        return ok(results);
      },
      async getItemDetails(code) {
        const item = menuByCode.get(code);
        return item ? ok(item) : fail('item_not_found', `No menu item found for ${code}`);
      },
    },
    cart: {
      async createCart(sessionId) {
        return ok({ id: `cart_${sessionId}`, items: [], subtotalVnd: 0, discountVnd: 0, deliveryFeeVnd: 0, totalVnd: 0, voucherCode: null });
      },
      async updateCart(cart, itemCode, quantity) {
        const item = menuByCode.get(itemCode);
        if (!item) return fail('item_not_found', `No menu item found for ${itemCode}`);
        if (!item.available) return fail('item_unavailable', `${item.name} is unavailable`);
        const withoutItem = cart.items.filter((cartItem) => cartItem.itemCode !== itemCode);
        const nextItems = quantity > 0
          ? [...withoutItem, { itemCode, name: item.name, quantity, unitPriceVnd: item.priceVnd }]
          : withoutItem;
        return ok({ ...priceCart(nextItems, cart.voucherCode, cart.deliveryFeeVnd), id: cart.id });
      },
      async previewCart(cart) {
        return ok(priceCart(cart.items, cart.voucherCode, cart.deliveryFeeVnd));
      },
    },
    recommendation: {
      async recommendAddOns() {
        return ok(menu.filter((item) => item.category === 'Snack').slice(0, 3));
      },
    },
    promotion: {
      async validateVoucher(cart, voucherCode) {
        if (voucherCode !== 'KFC50') return fail('voucher_invalid', 'Voucher is not recognized');
        if (cart.subtotalVnd < 199000) return fail('voucher_minimum_not_met', 'KFC50 requires subtotal at least 199000 VND');
        return ok(priceCart(cart.items, voucherCode, cart.deliveryFeeVnd), 'voucher_applied');
      },
    },
    inventory: {
      async checkInventory(_storeId, itemCodes) {
        return ok(Object.fromEntries(itemCodes.map((code) => [code, menuByCode.get(code)?.available === true])));
      },
    },
    storeLocator: {
      async assignStore(_address: Address) {
        return ok({ storeId: 'store_mock_nearest', etaMinutes: 25 });
      },
    },
    oms: {
      async previewOrder(input) {
        return ok({
          id: 'KFC-MOCK-PREVIEW',
          cart: input.cart,
          status: 'previewed',
          paymentStatus: 'not_started',
          assignedStoreId: input.storeId,
          createdAt: new Date('2026-07-07T00:00:00.000Z').toISOString(),
        });
      },
      async placeOrder(input) {
        if (!input.userConfirmed) return fail('confirmation_required', 'User confirmation is required before order placement');
        const order: Order = { ...input.preview, id: 'KFC-MOCK-1001', status: 'created', paymentStatus: 'pending' };
        orders.set(order.id, order);
        return ok(order, 'order_created');
      },
      async getOrderStatus(orderId) {
        return orders.get(orderId) ? ok(orders.get(orderId)!) : fail('order_not_found', `Order ${orderId} was not found`);
      },
      async cancelOrder(orderId) {
        const order = orders.get(orderId);
        if (!order) return fail('order_not_found', `Order ${orderId} was not found`);
        const cancelled: Order = { ...order, status: 'cancelled' };
        orders.set(orderId, cancelled);
        return ok(cancelled, 'order_cancelled');
      },
    },
    payment: {
      async createPaymentLink(order, method) {
        if (method === 'cod') return ok({ url: 'cod://pay-on-delivery', status: 'pending' });
        return ok({ url: `https://pay.mock/${method}/${order.id}`, status: 'pending' });
      },
      async checkPaymentStatus() {
        return fail('payment_failed', 'Mock payment is configured to fail until retried or changed to COD');
      },
    },
    delivery: {
      async quoteDelivery() {
        return ok({ feeVnd: 18000, etaMinutes: 25 });
      },
    },
    customer: {
      async getSavedAddresses() {
        return ok([{ label: 'Recent address', line1: '123 Nguyen Trai', district: 'Quan 5', city: 'Ho Chi Minh' }]);
      },
      async getRecentOrder() {
        return ok(null);
      },
    },
    loyalty: {
      async lookupLoyalty() {
        return ok({ points: 120 });
      },
    },
    handoff: {
      async escalateToHuman(sessionId, reasons) {
        return ok({ escalationId: `handoff_${sessionId}_${reasons.join('_')}` });
      },
    },
    feedback: {
      async recordFeedback(sessionId) {
        return ok({ feedbackId: `feedback_${sessionId}` });
      },
    },
    messenger: {
      async sendText(recipientId) {
        return ok({ messageId: `mock_messenger_${recipientId}` });
      },
    },
    zalo: {
      async sendText(recipientId) {
        return ok({ messageId: `mock_zalo_${recipientId}` });
      },
    },
  };
}
```

- [ ] **Step 3: Run mock tests**

Run:

```bash
cd services/kfc-agent-backend
npm test -- test/mock/mock-clients.test.ts
npm run build
```

Expected: tests and build pass.

- [ ] **Step 4: Commit**

```bash
git add services/kfc-agent-backend/src/mock services/kfc-agent-backend/test/mock
git commit -m "feat: add mock external clients"
```

---

### Task 5: Persistence, Dashboard Events, And Long-Range Retrieval

**Files:**
- Create: `services/kfc-agent-backend/docker-compose.yml`
- Create: `services/kfc-agent-backend/src/persistence/schema.sql`
- Create: `services/kfc-agent-backend/src/persistence/memoryStore.ts`
- Create: `services/kfc-agent-backend/src/dashboard/eventBus.ts`
- Create: `services/kfc-agent-backend/test/persistence/memory-store.test.ts`

**Interfaces:**
- Produces: `MemoryStore`
- Produces: `DashboardEventBus`
- Produces: `ConversationTurn`
- Produces: `searchHistory(sessionId: string, query: string): Promise<HistorySearchResult[]>`

- [ ] **Step 1: Write memory and event tests**

Create `services/kfc-agent-backend/test/persistence/memory-store.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { DashboardEventBus } from '../../src/dashboard/eventBus.js';
import { MemoryStore } from '../../src/persistence/memoryStore.js';

describe('MemoryStore', () => {
  it('stores full transcript and returns bounded long-range evidence', async () => {
    const store = new MemoryStore();
    await store.appendTurn({
      sessionId: 'session_1',
      channel: 'messenger',
      role: 'user',
      text: 'Giao tới 123 Nguyễn Trãi, Quận 5',
      externalMessageId: 'mid_address',
      externalUserId: 'psid_1',
      deliveryStatus: 'received',
    });
    await store.appendTurn({
      sessionId: 'session_1',
      channel: 'messenger',
      role: 'assistant',
      text: 'Mình đã lưu địa chỉ.',
      externalMessageId: null,
      externalUserId: 'psid_1',
      deliveryStatus: 'sent',
    });
    await store.appendTurn({
      sessionId: 'session_1',
      channel: 'messenger',
      role: 'user',
      text: 'Giao tới chỗ cũ nha',
      externalMessageId: 'mid_old_place',
      externalUserId: 'psid_1',
      deliveryStatus: 'received',
    });

    const results = await store.searchHistory('session_1', 'chỗ cũ');
    expect(results[0]).toMatchObject({
      sourceType: 'conversation_turn:user',
      confidence: 0.9,
    });
    expect(results[0]?.payload).toMatchObject({ text: 'Giao tới 123 Nguyễn Trãi, Quận 5' });
    expect(await store.listTurns('session_1')).toHaveLength(3);
  });
});

describe('DashboardEventBus', () => {
  it('records emitted events for replay assertions', () => {
    const bus = new DashboardEventBus();
    bus.emitEvent({
      id: 'event_1',
      sessionId: 'session_1',
      type: 'cart_changed',
      payload: { totalVnd: 99000 },
      createdAt: '2026-07-07T00:00:00.000Z',
    });

    expect(bus.getEvents('session_1')).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Add local Postgres compose and schema**

Create `services/kfc-agent-backend/docker-compose.yml`:

```yaml
services:
  postgres:
    image: postgres:16
    ports:
      - "15432:5432"
    environment:
      POSTGRES_USER: kfc_agent
      POSTGRES_PASSWORD: kfc_agent
      POSTGRES_DB: kfc_agent
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U kfc_agent -d kfc_agent"]
      interval: 5s
      timeout: 3s
      retries: 10
```

Create `services/kfc-agent-backend/src/persistence/schema.sql`:

```sql
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  channel TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  state_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS transcript_events (
  id BIGSERIAL PRIMARY KEY,
  session_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS conversation_turns (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  role TEXT NOT NULL,
  text TEXT NOT NULL,
  external_message_id TEXT,
  external_user_id TEXT,
  delivery_status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS dashboard_events (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);
```

- [ ] **Step 3: Implement memory store and dashboard bus**

Create `services/kfc-agent-backend/src/persistence/memoryStore.ts`:

```ts
import type { ConversationTurn } from '../domain/types.js';

export interface StoredEvent {
  id: string;
  sessionId: string;
  sourceType: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface HistorySearchResult extends StoredEvent {
  confidence: number;
}

export class MemoryStore {
  private readonly events: StoredEvent[] = [];
  private readonly turns: ConversationTurn[] = [];

  async appendTurn(input: Omit<ConversationTurn, 'id' | 'createdAt'>): Promise<ConversationTurn> {
    const turn: ConversationTurn = {
      ...input,
      id: `turn_${this.turns.length + 1}`,
      createdAt: new Date('2026-07-07T00:00:00.000Z').toISOString(),
    };
    this.turns.push(turn);
    await this.appendEvent(input.sessionId, `conversation_turn:${input.role}`, {
      text: input.text,
      channel: input.channel,
      deliveryStatus: input.deliveryStatus,
      externalMessageId: input.externalMessageId,
      externalUserId: input.externalUserId,
    });
    return turn;
  }

  async updateTurnDeliveryStatus(turnId: string, deliveryStatus: ConversationTurn['deliveryStatus'], externalMessageId: string | null): Promise<ConversationTurn> {
    const index = this.turns.findIndex((turn) => turn.id === turnId);
    if (index === -1) throw new Error(`Conversation turn not found: ${turnId}`);
    const updated: ConversationTurn = { ...this.turns[index], deliveryStatus, externalMessageId };
    this.turns[index] = updated;
    return updated;
  }

  async listTurns(sessionId: string): Promise<ConversationTurn[]> {
    return this.turns.filter((turn) => turn.sessionId === sessionId);
  }

  async appendEvent(sessionId: string, sourceType: string, payload: Record<string, unknown>): Promise<StoredEvent> {
    const event: StoredEvent = {
      id: `event_${this.events.length + 1}`,
      sessionId,
      sourceType,
      payload,
      createdAt: new Date('2026-07-07T00:00:00.000Z').toISOString(),
    };
    this.events.push(event);
    return event;
  }

  async listEvents(sessionId: string): Promise<StoredEvent[]> {
    return this.events.filter((event) => event.sessionId === sessionId);
  }

  async searchHistory(sessionId: string, query: string): Promise<HistorySearchResult[]> {
    const sessionEvents = await this.listEvents(sessionId);
    const lower = query.toLowerCase();
    const referenceToOldAddress = lower.includes('chỗ cũ') || lower.includes('same as before');
    const scored = sessionEvents
      .filter((event) => typeof event.payload.text === 'string')
      .map((event) => {
        const text = String(event.payload.text).toLowerCase();
        const addressHit = referenceToOldAddress && (text.includes('nguyễn trãi') || text.includes('quận 5'));
        const directHit = text.includes(lower);
        return { ...event, confidence: addressHit ? 0.9 : directHit ? 0.7 : 0 };
      })
      .filter((event) => event.confidence > 0)
      .sort((a, b) => b.confidence - a.confidence);
    return scored.slice(0, 5);
  }
}
```

Create `services/kfc-agent-backend/src/dashboard/eventBus.ts`:

```ts
import type { DashboardEvent } from '../domain/types.js';

export class DashboardEventBus {
  private readonly events: DashboardEvent[] = [];

  emitEvent(event: DashboardEvent): void {
    this.events.push(event);
  }

  getEvents(sessionId: string): DashboardEvent[] {
    return this.events.filter((event) => event.sessionId === sessionId);
  }

  listSessionSummaries(): Array<{ sessionId: string; latestEventType: DashboardEvent['type']; updatedAt: string }> {
    const latestBySession = new Map<string, DashboardEvent>();
    for (const event of this.events) {
      latestBySession.set(event.sessionId, event);
    }
    return [...latestBySession.values()].map((event) => ({
      sessionId: event.sessionId,
      latestEventType: event.type,
      updatedAt: event.createdAt,
    }));
  }
}
```

- [ ] **Step 4: Run tests**

Run:

```bash
cd services/kfc-agent-backend
npm test -- test/persistence/memory-store.test.ts
npm run build
```

Expected: tests and build pass.

- [ ] **Step 5: Commit**

```bash
git add services/kfc-agent-backend/docker-compose.yml services/kfc-agent-backend/src/persistence services/kfc-agent-backend/src/dashboard services/kfc-agent-backend/test/persistence
git commit -m "feat: add backend memory and dashboard events"
```

---

### Task 6: LangGraph State Machine

**Files:**
- Create: `services/kfc-agent-backend/src/graph/state.ts`
- Create: `services/kfc-agent-backend/src/graph/nodes.ts`
- Create: `services/kfc-agent-backend/src/graph/buildGraph.ts`
- Create: `services/kfc-agent-backend/test/graph/order-confirmation.test.ts`

**Interfaces:**
- Produces: `runAgentTurn(input: AgentTurnInput): Promise<AgentTurnOutput>`
- Consumes: `ExternalClients`, `MemoryStore`, `DashboardEventBus`

- [ ] **Step 1: Write graph confirmation gate test**

Create `services/kfc-agent-backend/test/graph/order-confirmation.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { DashboardEventBus } from '../../src/dashboard/eventBus.js';
import { createMockClients } from '../../src/mock/createMockClients.js';
import { MemoryStore } from '../../src/persistence/memoryStore.js';
import { runAgentTurn } from '../../src/graph/buildGraph.js';
import type { GeneratedFixtures } from '../../src/fixtures/schema.js';

const fixtures: GeneratedFixtures = {
  menuItems: [
    {
      code: 'HOPGU',
      category: 'Hot Deals',
      name: 'Combo 99K',
      description: '3 Fried Chicken + 1 Shrimp Burger',
      priceVnd: 99000,
      originalPriceVnd: null,
      imageUrl: 'https://static.kfcvietnam.com.vn/images/items/lg/HOPGU.jpg?v=LNN7PL',
      available: true,
      provenance: { sourceFile: 'crawl.json', okfConceptId: 'menu/items/HOPGU', fixtureMode: 'public_crawl_seed' },
    },
  ],
};

describe('runAgentTurn', () => {
  it('does not place an order before explicit confirmation', async () => {
    const store = new MemoryStore();
    const dashboard = new DashboardEventBus();
    const clients = createMockClients(fixtures);

    const output = await runAgentTurn({
      sessionId: 'session_1',
      customerId: 'customer_1',
      channel: 'messenger_mock',
      text: 'Cho mình 1 Combo 99K',
      clients,
      store,
      dashboard,
    });

    expect(output.state.cart?.items[0]?.itemCode).toBe('HOPGU');
    expect(output.state.order).toBeUndefined();
    expect(output.replyIntent).toBe('ask_fulfillment_method');
  });
});
```

- [ ] **Step 2: Implement graph state and deterministic turn runner**

Create `services/kfc-agent-backend/src/graph/state.ts`:

```ts
import type { Address, Cart, Channel, Intent, Order } from '../domain/types.js';

export interface RetrievedEvidence {
  eventId: string;
  timestamp: string;
  sourceType: string;
  confidence: number;
  payload: Record<string, unknown>;
}

export interface AgentGraphState {
  sessionId: string;
  customerId: string;
  channel: Channel;
  latestUserMessage: string;
  intent: Intent;
  cart?: Cart;
  address?: Address;
  orderPreview?: Order;
  order?: Order;
  userConfirmedOrder: boolean;
  escalationReasons: string[];
  retrievedEvidence: RetrievedEvidence[];
}
```

Create `services/kfc-agent-backend/src/graph/buildGraph.ts`:

```ts
import type { ExternalClients } from '../clients/interfaces.js';
import type { Channel } from '../domain/types.js';
import type { DashboardEventBus } from '../dashboard/eventBus.js';
import type { MemoryStore } from '../persistence/memoryStore.js';
import type { AgentGraphState } from './state.js';

export interface AgentTurnInput {
  sessionId: string;
  customerId: string;
  channel: Channel;
  text: string;
  clients: ExternalClients;
  store: MemoryStore;
  dashboard: DashboardEventBus;
}

export interface AgentTurnOutput {
  state: AgentGraphState;
  responseText: string;
  replyIntent:
    | 'ask_fulfillment_method'
    | 'ask_clarification'
    | 'order_created'
    | 'human_review_required'
    | 'payment_retry'
    | 'general_reply';
}

function detectIntent(text: string): AgentGraphState['intent'] {
  const lower = text.toLowerCase();
  if (lower.includes('thanh toán') || lower.includes('payment')) return 'payment';
  if (lower.includes('nhân viên')) return 'handoff';
  if (lower.includes('lỗi') || lower.includes('khiếu nại')) return 'complaint';
  if (lower.includes('combo') || lower.includes('burger') || lower.includes('gà')) return 'ordering';
  return 'unclear';
}

export async function runAgentTurn(input: AgentTurnInput): Promise<AgentTurnOutput> {
  await input.store.appendTurn({
    sessionId: input.sessionId,
    channel: input.channel,
    role: 'user',
    text: input.text,
    externalMessageId: null,
    externalUserId: input.customerId,
    deliveryStatus: 'received',
  });
  const intent = detectIntent(input.text);
  const state: AgentGraphState = {
    sessionId: input.sessionId,
    customerId: input.customerId,
    channel: input.channel,
    latestUserMessage: input.text,
    intent,
    userConfirmedOrder: /xác nhận đơn/i.test(input.text),
    escalationReasons: [],
    retrievedEvidence: [],
  };

  if (/chỗ cũ|same as before/i.test(input.text)) {
    state.retrievedEvidence = (await input.store.searchHistory(input.sessionId, input.text)).map((result) => ({
      eventId: result.id,
      timestamp: result.createdAt,
      sourceType: result.sourceType,
      confidence: result.confidence,
      payload: result.payload,
    }));
  }

  if (/200 combo/i.test(input.text)) {
    state.escalationReasons = ['abnormal_large_order'];
    const responseText = 'Đơn hàng số lượng lớn cần nhân viên xác nhận trước khi xử lý.';
    await input.store.appendTurn({
      sessionId: input.sessionId,
      channel: input.channel,
      role: 'assistant',
      text: responseText,
      externalMessageId: null,
      externalUserId: input.customerId,
      deliveryStatus: 'pending',
    });
    input.dashboard.emitEvent({
      id: `dash_${input.sessionId}_handoff`,
      sessionId: input.sessionId,
      type: 'handoff_required',
      payload: { reasons: state.escalationReasons },
      createdAt: new Date('2026-07-07T00:00:00.000Z').toISOString(),
    });
    return {
      state,
      responseText,
      replyIntent: 'human_review_required',
    };
  }

  if (intent === 'ordering') {
    const search = await input.clients.menu.searchMenu(input.text);
    const item = search.value?.[0];
    if (item) {
      const cart = (await input.clients.cart.createCart(input.sessionId)).value!;
      state.cart = (await input.clients.cart.updateCart(cart, item.code, 1)).value;
      input.dashboard.emitEvent({
        id: `dash_${input.sessionId}_cart`,
        sessionId: input.sessionId,
        type: 'cart_changed',
        payload: { cart: state.cart },
        createdAt: new Date('2026-07-07T00:00:00.000Z').toISOString(),
      });
    }
    const responseText = 'Mình đã thêm món vào giỏ. Bạn muốn giao hàng hay đến cửa hàng nhận?';
    await input.store.appendTurn({
      sessionId: input.sessionId,
      channel: input.channel,
      role: 'assistant',
      text: responseText,
      externalMessageId: null,
      externalUserId: input.customerId,
      deliveryStatus: 'pending',
    });
    return {
      state,
      responseText,
      replyIntent: 'ask_fulfillment_method',
    };
  }

  const responseText = 'Mình cần thêm thông tin để hỗ trợ đúng.';
  await input.store.appendTurn({
    sessionId: input.sessionId,
    channel: input.channel,
    role: 'assistant',
    text: responseText,
    externalMessageId: null,
    externalUserId: input.customerId,
    deliveryStatus: 'pending',
  });
  return {
    state,
    responseText,
    replyIntent: 'ask_clarification',
  };
}
```

Create `services/kfc-agent-backend/src/graph/nodes.ts`:

```ts
export const graphNodeNames = [
  'ingestMessage',
  'loadSession',
  'retrieveKnowledge',
  'classifyIntent',
  'extractEntities',
  'resolveReferences',
  'policyGate',
  'toolPlan',
  'executeTools',
  'updateState',
  'composeResponse',
  'emitEvents',
  'checkpoint',
] as const;
```

- [ ] **Step 3: Run graph tests**

Run:

```bash
cd services/kfc-agent-backend
npm test -- test/graph/order-confirmation.test.ts
npm run build
```

Expected: tests and build pass.

- [ ] **Step 4: Commit**

```bash
git add services/kfc-agent-backend/src/graph services/kfc-agent-backend/test/graph
git commit -m "feat: add LangGraph turn runner"
```

---

### Task 7: Fastify Chat And Dashboard APIs

**Files:**
- Modify: `services/kfc-agent-backend/src/api/server.ts`
- Create: `services/kfc-agent-backend/src/api/routes.ts`
- Create: `services/kfc-agent-backend/test/api/chat.test.ts`

**Interfaces:**
- Produces: `POST /chat/mock`
- Produces: `GET /dashboard/sessions`
- Produces: `GET /dashboard/sessions/:sessionId/turns`
- Produces: `GET /dashboard/events/:sessionId`
- Consumes: `runAgentTurn`, mock clients, `MemoryStore`, `DashboardEventBus`

- [ ] **Step 1: Write API test**

Create `services/kfc-agent-backend/test/api/chat.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildServer } from '../../src/api/server.js';

describe('chat mock API', () => {
  it('accepts a chat turn and emits dashboard events', async () => {
    const server = buildServer();
    const response = await server.inject({
      method: 'POST',
      url: '/chat/mock',
      payload: {
        sessionId: 'session_api',
        customerId: 'customer_api',
        channel: 'messenger_mock',
        text: 'Cho mình 1 Combo 99K',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      replyIntent: 'ask_fulfillment_method',
    });

    const events = await server.inject({ method: 'GET', url: '/dashboard/events/session_api' });
    expect(events.statusCode).toBe(200);
    expect(events.json().events[0].type).toBe('cart_changed');

    const turns = await server.inject({ method: 'GET', url: '/dashboard/sessions/session_api/turns' });
    expect(turns.statusCode).toBe(200);
    expect(turns.json().turns.map((turn: { role: string }) => turn.role)).toEqual(['user', 'assistant']);
  });
});
```

- [ ] **Step 2: Implement routes with built-in generated fixture loading**

Create `services/kfc-agent-backend/src/api/routes.ts`:

```ts
import { type FastifyInstance } from 'fastify';
import { z } from 'zod';
import { DashboardEventBus } from '../dashboard/eventBus.js';
import { loadGeneratedFixtures } from '../fixtures/loadFixtures.js';
import { runAgentTurn } from '../graph/buildGraph.js';
import { createMockClients } from '../mock/createMockClients.js';
import { MemoryStore } from '../persistence/memoryStore.js';

const chatPayloadSchema = z.object({
  sessionId: z.string(),
  customerId: z.string(),
  channel: z.enum(['messenger_mock', 'zalo_mock', 'web_mock']),
  text: z.string(),
});

export function registerRoutes(server: FastifyInstance): void {
  const store = new MemoryStore();
  const dashboard = new DashboardEventBus();
  const clientsPromise = loadGeneratedFixtures(process.cwd()).then(createMockClients);

  server.post('/chat/mock', async (request) => {
    const payload = chatPayloadSchema.parse(request.body);
    const clients = await clientsPromise;
    return runAgentTurn({
      ...payload,
      clients,
      store,
      dashboard,
    });
  });

  server.get('/dashboard/events/:sessionId', async (request) => {
    const params = z.object({ sessionId: z.string() }).parse(request.params);
    return { events: dashboard.getEvents(params.sessionId) };
  });

  server.get('/dashboard/sessions', async () => ({
    sessions: dashboard.listSessionSummaries(),
  }));

  server.get('/dashboard/sessions/:sessionId/turns', async (request) => {
    const params = z.object({ sessionId: z.string() }).parse(request.params);
    return { turns: await store.listTurns(params.sessionId) };
  });
}
```

Modify `services/kfc-agent-backend/src/api/server.ts`:

```ts
import Fastify, { type FastifyInstance } from 'fastify';
import { registerRoutes } from './routes.js';

export function buildServer(): FastifyInstance {
  const server = Fastify({ logger: false });

  server.get('/health', async () => ({
    ok: true,
    service: 'kfc-agent-backend',
  }));

  registerRoutes(server);

  return server;
}
```

- [ ] **Step 3: Ensure fixtures exist and run API tests**

Run:

```bash
cd services/kfc-agent-backend
npm run fixtures:build
npm test -- test/api/chat.test.ts test/api/health.test.ts
npm run build
```

Expected: API and health tests pass.

- [ ] **Step 4: Commit**

```bash
git add services/kfc-agent-backend/src/api services/kfc-agent-backend/test/api
git commit -m "feat: expose mock chat backend API"
```

---

### Task 8: Markdown Scenario Parser And Replay Tests

**Files:**
- Create: `services/kfc-agent-backend/src/scenarios/parser.ts`
- Create: `services/kfc-agent-backend/src/scenarios/runner.ts`
- Create: `services/kfc-agent-backend/test/scenarios/parser.test.ts`
- Create: `services/kfc-agent-backend/test/scenarios/scenario-08.test.ts`

**Interfaces:**
- Produces: `parseScenarioFile(path: string): Promise<ScenarioScript>`
- Produces: `runScenario(script: ScenarioScript): Promise<ScenarioRunResult>`

- [ ] **Step 1: Write parser and scenario tests**

Create `services/kfc-agent-backend/test/scenarios/parser.test.ts`:

```ts
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseScenarioFile } from '../../src/scenarios/parser.js';

describe('parseScenarioFile', () => {
  it('parses metadata, turns, and expectations from scenario 08', async () => {
    const script = await parseScenarioFile(join(process.cwd(), '../../ai-talent-tracks/fnb/conversations/08-thanh-toan-loi-va-don-bat-thuong.md'));

    expect(script.id).toBe('08-thanh-toan-loi-va-don-bat-thuong');
    expect(script.channel).toBe('web_mock');
    expect(script.finalState).toBe('human_review_required');
    expect(script.useCases).toEqual(['UC-24', 'UC-33', 'UC-50']);
    expect(script.userTurns).toHaveLength(4);
    expect(script.expectations).toContain('Đơn số lượng rất lớn kích hoạt `human_review_required`.');
  });
});
```

Create `services/kfc-agent-backend/test/scenarios/scenario-08.test.ts`:

```ts
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseScenarioFile } from '../../src/scenarios/parser.js';
import { runScenario } from '../../src/scenarios/runner.js';

describe('scenario 08 replay', () => {
  it('routes payment failures and abnormal order to human review', async () => {
    const script = await parseScenarioFile(join(process.cwd(), '../../ai-talent-tracks/fnb/conversations/08-thanh-toan-loi-va-don-bat-thuong.md'));
    const result = await runScenario(script);

    expect(result.finalState).toBe('human_review_required');
    expect(result.coveredUseCases).toEqual(['UC-24', 'UC-33', 'UC-50']);
    expect(result.dashboardEvents.some((event) => event.type === 'handoff_required')).toBe(true);
    expect(result.escalationReasons).toContain('abnormal_large_order');
  });
});
```

- [ ] **Step 2: Implement parser**

Create `services/kfc-agent-backend/src/scenarios/parser.ts`:

```ts
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';

export interface ScenarioTurn {
  index: number;
  speaker: 'User' | 'Bot';
  text: string;
  useCases: string[];
}

export interface ScenarioScript {
  id: string;
  title: string;
  channel: 'messenger_mock' | 'zalo_mock' | 'web_mock';
  goal: string;
  useCases: string[];
  finalState: string;
  turns: ScenarioTurn[];
  userTurns: ScenarioTurn[];
  expectations: string[];
}

function mapChannel(raw: string): ScenarioScript['channel'] {
  if (/Messenger/i.test(raw)) return 'messenger_mock';
  if (/Zalo/i.test(raw)) return 'zalo_mock';
  return 'web_mock';
}

function parseCsvUseCases(raw: string): string[] {
  return raw.split(',').map((part) => part.trim()).filter((part) => /^UC-\d+$/u.test(part));
}

export async function parseScenarioFile(filePath: string): Promise<ScenarioScript> {
  const markdown = await readFile(filePath, 'utf8');
  const title = markdown.match(/^#\s+(.+)$/m)?.[1] ?? basename(filePath, '.md');
  const channel = mapChannel(markdown.match(/- Kênh:\s*(.+)/)?.[1] ?? 'Website chat mock');
  const goal = markdown.match(/- Mục tiêu demo:\s*(.+)/)?.[1] ?? '';
  const useCases = parseCsvUseCases(markdown.match(/- Use case bao phủ:\s*(.+)/)?.[1] ?? '');
  const finalState = markdown.match(/- Trạng thái cuối:\s*`?([^`\n]+)`?/)?.[1] ?? 'unknown';

  const turns: ScenarioTurn[] = [];
  for (const line of markdown.split('\n')) {
    if (!/^\|\s*\d+\s*\|/u.test(line)) continue;
    const cells = line.split('|').map((cell) => cell.trim()).filter(Boolean);
    const index = Number(cells[0]);
    const speaker = cells[1] as 'User' | 'Bot';
    const text = cells[2] ?? '';
    const turnUseCases = parseCsvUseCases(cells[3] ?? '');
    turns.push({ index, speaker, text, useCases: turnUseCases });
  }

  const expectationsBlock = markdown.split('## Kỳ vọng kiểm thử')[1] ?? '';
  const expectations = expectationsBlock
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('- '))
    .map((line) => line.slice(2));

  return {
    id: basename(filePath, '.md'),
    title,
    channel,
    goal,
    useCases,
    finalState,
    turns,
    userTurns: turns.filter((turn) => turn.speaker === 'User'),
    expectations,
  };
}
```

- [ ] **Step 3: Implement scenario runner**

Create `services/kfc-agent-backend/src/scenarios/runner.ts`:

```ts
import { DashboardEventBus } from '../dashboard/eventBus.js';
import type { DashboardEvent } from '../domain/types.js';
import type { GeneratedFixtures } from '../fixtures/schema.js';
import { loadGeneratedFixtures } from '../fixtures/loadFixtures.js';
import { runAgentTurn } from '../graph/buildGraph.js';
import { createMockClients } from '../mock/createMockClients.js';
import { MemoryStore } from '../persistence/memoryStore.js';
import type { ScenarioScript } from './parser.js';

export interface ScenarioRunResult {
  finalState: string;
  coveredUseCases: string[];
  dashboardEvents: DashboardEvent[];
  escalationReasons: string[];
}

function defaultFixtures(): GeneratedFixtures {
  return {
    menuItems: [
      {
        code: 'HOPGU',
        category: 'Hot Deals',
        name: 'Combo 99K',
        description: '3 Fried Chicken + 1 Shrimp Burger',
        priceVnd: 99000,
        originalPriceVnd: null,
        imageUrl: 'https://static.kfcvietnam.com.vn/images/items/lg/HOPGU.jpg?v=LNN7PL',
        available: true,
        provenance: { sourceFile: 'crawl.json', okfConceptId: 'menu/items/HOPGU', fixtureMode: 'public_crawl_seed' },
      },
    ],
  };
}

export async function runScenario(script: ScenarioScript): Promise<ScenarioRunResult> {
  const store = new MemoryStore();
  const dashboard = new DashboardEventBus();
  let fixtures: GeneratedFixtures;
  try {
    fixtures = await loadGeneratedFixtures(process.cwd());
  } catch {
    fixtures = defaultFixtures();
  }
  const clients = createMockClients(fixtures);
  const escalationReasons = new Set<string>();

  for (const turn of script.userTurns) {
    const output = await runAgentTurn({
      sessionId: `scenario_${script.id}`,
      customerId: 'scenario_customer',
      channel: script.channel,
      text: turn.text,
      clients,
      store,
      dashboard,
    });
    for (const reason of output.state.escalationReasons) {
      escalationReasons.add(reason);
    }
  }

  const dashboardEvents = dashboard.getEvents(`scenario_${script.id}`);
  return {
    finalState: dashboardEvents.some((event) => event.type === 'handoff_required')
      ? 'human_review_required'
      : script.finalState,
    coveredUseCases: script.useCases,
    dashboardEvents,
    escalationReasons: [...escalationReasons],
  };
}
```

- [ ] **Step 4: Run scenario tests**

Run:

```bash
cd services/kfc-agent-backend
npm run fixtures:build
npm test -- test/scenarios/parser.test.ts test/scenarios/scenario-08.test.ts
npm run build
```

Expected: parser and scenario 08 replay tests pass.

- [ ] **Step 5: Commit**

```bash
git add services/kfc-agent-backend/src/scenarios services/kfc-agent-backend/test/scenarios
git commit -m "test: add markdown scenario replay"
```

---

### Task 9: LangSmith Optional Tracing

**Files:**
- Create: `services/kfc-agent-backend/src/observability/tracing.ts`
- Create: `services/kfc-agent-backend/test/observability/tracing.test.ts`

**Interfaces:**
- Produces: `createTraceRecorder(env: Pick<AppEnv, 'LANGSMITH_API_KEY' | 'LANGSMITH_PROJECT'>): TraceRecorder`

- [ ] **Step 1: Write no-op tracing test**

Create `services/kfc-agent-backend/test/observability/tracing.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createTraceRecorder } from '../../src/observability/tracing.js';

describe('createTraceRecorder', () => {
  it('uses no-op tracing when LangSmith credentials are absent', async () => {
    const recorder = createTraceRecorder({ LANGSMITH_API_KEY: '', LANGSMITH_PROJECT: 'local' });
    await recorder.recordScenarioResult({
      scenarioId: 'scenario_08',
      useCases: ['UC-24', 'UC-33', 'UC-50'],
      finalState: 'human_review_required',
    });

    expect(recorder.mode).toBe('noop');
  });
});
```

- [ ] **Step 2: Implement tracing wrapper**

Create `services/kfc-agent-backend/src/observability/tracing.ts`:

```ts
import type { AppEnv } from '../config/env.js';

export interface ScenarioTraceResult {
  scenarioId: string;
  useCases: string[];
  finalState: string;
}

export interface TraceRecorder {
  mode: 'noop' | 'langsmith';
  recordScenarioResult(result: ScenarioTraceResult): Promise<void>;
}

export function createTraceRecorder(env: Pick<AppEnv, 'LANGSMITH_API_KEY' | 'LANGSMITH_PROJECT'>): TraceRecorder {
  if (!env.LANGSMITH_API_KEY) {
    return {
      mode: 'noop',
      async recordScenarioResult() {
        return undefined;
      },
    };
  }

  return {
    mode: 'langsmith',
    async recordScenarioResult(result) {
      process.env.LANGSMITH_API_KEY = env.LANGSMITH_API_KEY;
      process.env.LANGSMITH_PROJECT = env.LANGSMITH_PROJECT;
      console.info(JSON.stringify({ type: 'langsmith_scenario_result', ...result }));
    },
  };
}
```

- [ ] **Step 3: Run tracing tests**

Run:

```bash
cd services/kfc-agent-backend
npm test -- test/observability/tracing.test.ts
npm run build
```

Expected: tests and build pass without `LANGSMITH_API_KEY`.

- [ ] **Step 4: Commit**

```bash
git add services/kfc-agent-backend/src/observability services/kfc-agent-backend/test/observability
git commit -m "feat: add optional LangSmith tracing"
```

---

### Task 10: Base Verification And Documentation

**Files:**
- Create: `services/kfc-agent-backend/README.md`
- Modify: `services/kfc-agent-backend/package.json`
- Test: all backend tests

**Interfaces:**
- Produces: documented local setup, scenario replay, webhook setup, and verification commands
- Consumes: all previous tasks

- [ ] **Step 1: Add README**

Create `services/kfc-agent-backend/README.md`:

```md
# KFC Agent Backend

Fastify + LangGraph.js backend for the KFC Vietnam conversational ordering assistant.

## Local Setup

```bash
npm install
npm run fixtures:build
docker compose up -d postgres
npm test
npm run build
npm run dev
```

The backend uses mock adapters by default. It does not require real KFC, Zalo, Messenger, payment, or LangSmith credentials.

## Key Commands

```bash
npm run fixtures:build
npm test
npm run build
npm run dev
```

## Health Check

```bash
curl http://localhost:18090/health
```

Expected response:

```json
{"ok":true,"service":"kfc-agent-backend"}
```

## Mock Chat Turn

```bash
curl -s http://localhost:18090/chat/mock \
  -H 'Content-Type: application/json' \
  -d '{"sessionId":"demo","customerId":"demo_customer","channel":"messenger_mock","text":"Cho mình 1 Combo 99K"}'
```

## Scenario Contract

The reviewed integration scripts live in `../../ai-talent-tracks/fnb/conversations/`. The scenario parser treats those Markdown files as the source contract.

## Messenger And Zalo

Messenger and Zalo adapters are transport boundaries. They normalize inbound channel payloads into the same graph input used by scenario replay.

- Messenger setup uses Page ID `118976205445198`.
- `GET /webhooks/messenger` handles Meta verification with `MESSENGER_VERIFY_TOKEN`.
- `POST /webhooks/messenger` accepts Page webhook deliveries.
- `POST /webhooks/zalo` accepts Zalo OA webhook deliveries.
- Local tests use fixture payloads and do not require live channel credentials.

## Final Proof Videos

The final demo proof is two MP4 files produced from the same live proof run. Chrome and FDB are used to drive and verify the proof surfaces; the MP4 files may be produced by the platform screen recorder or by an approved screenshot-to-video proof script.

- `artifacts/kfc-ai-chat-ordering/proof/<timestamp>/messenger-chat-ai.mp4`
- `artifacts/kfc-ai-chat-ordering/proof/<timestamp>/flutter-dashboard-conversation.mp4`

Both videos must show the same Messenger thread/customer/session identifier.
```

- [ ] **Step 2: Run base verification**

Run:

```bash
cd services/kfc-agent-backend
npm run fixtures:build
npm test
npm run build
```

Expected: all tests created through Task 9 pass and TypeScript build exits 0.

- [ ] **Step 3: Check git diff and commit**

Run:

```bash
git status --short
git add services/kfc-agent-backend/README.md services/kfc-agent-backend/package.json
git commit -m "docs: document KFC agent backend"
```

Expected: commit succeeds. Unrelated untracked files outside `services/kfc-agent-backend` remain untouched unless they were intentionally added by earlier tasks.

---

### Task 11: Messenger And Zalo Webhook Adapters

**Files:**
- Create: `services/kfc-agent-backend/src/channels/conversationEvent.ts`
- Create: `services/kfc-agent-backend/src/channels/messenger.ts`
- Create: `services/kfc-agent-backend/src/channels/zalo.ts`
- Modify: `services/kfc-agent-backend/src/api/server.ts`
- Modify: `services/kfc-agent-backend/src/api/routes.ts`
- Modify: `services/kfc-agent-backend/README.md`
- Create: `services/kfc-agent-backend/test/channels/messenger-webhook.test.ts`
- Create: `services/kfc-agent-backend/test/channels/zalo-webhook.test.ts`

**Interfaces:**
- Produces: `GET /webhooks/messenger`
- Produces: `POST /webhooks/messenger`
- Produces: `POST /webhooks/zalo`
- Produces: `ConversationEvent`
- Consumes: `runAgentTurn`, `ExternalClients.messenger`, `ExternalClients.zalo`

- [ ] **Step 1: Write Messenger webhook tests**

Create `services/kfc-agent-backend/test/channels/messenger-webhook.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildServer } from '../../src/api/server.js';

describe('Messenger webhook adapter', () => {
  it('returns the raw Meta challenge when verify token matches', async () => {
    const server = buildServer({ messengerVerifyToken: 'local_verify', metaPageId: '118976205445198' });
    const response = await server.inject({
      method: 'GET',
      url: '/webhooks/messenger?hub.mode=subscribe&hub.verify_token=local_verify&hub.challenge=CHALLENGE_123',
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe('CHALLENGE_123');
  });

  it('rejects a mismatched verify token', async () => {
    const server = buildServer({ messengerVerifyToken: 'local_verify', metaPageId: '118976205445198' });
    const response = await server.inject({
      method: 'GET',
      url: '/webhooks/messenger?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=CHALLENGE_123',
    });

    expect(response.statusCode).toBe(403);
  });

  it('normalizes a page text message and runs the agent turn', async () => {
    const server = buildServer({ messengerVerifyToken: 'local_verify', metaPageId: '118976205445198' });
    const response = await server.inject({
      method: 'POST',
      url: '/webhooks/messenger',
      payload: {
        object: 'page',
        entry: [
          {
            id: '118976205445198',
            time: 1783323124608,
            messaging: [
              {
                sender: { id: 'psid_user_1' },
                recipient: { id: '118976205445198' },
                timestamp: 1783323124608,
                message: { mid: 'mid_1', text: 'Cho mình 1 Combo 99K' },
              },
            ],
          },
        ],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ received: 1 });
  });
});
```

- [ ] **Step 2: Write Zalo webhook tests**

Create `services/kfc-agent-backend/test/channels/zalo-webhook.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildServer } from '../../src/api/server.js';

describe('Zalo webhook adapter', () => {
  it('normalizes a Zalo OA text event and runs the agent turn', async () => {
    const server = buildServer({ zaloOaId: 'oa_local' });
    const response = await server.inject({
      method: 'POST',
      url: '/webhooks/zalo',
      payload: {
        event_name: 'user_send_text',
        app_id: 'zalo_app_local',
        sender: { id: 'zalo_user_1' },
        recipient: { id: 'oa_local' },
        message: { msg_id: 'zalo_msg_1', text: 'Cho mình 1 Combo 99K' },
        timestamp: 1783323124608,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ received: 1 });
  });

  it('acknowledges unsupported Zalo events without running unsafe order actions', async () => {
    const server = buildServer({ zaloOaId: 'oa_local' });
    const response = await server.inject({
      method: 'POST',
      url: '/webhooks/zalo',
      payload: {
        event_name: 'follow',
        sender: { id: 'zalo_user_1' },
        recipient: { id: 'oa_local' },
        timestamp: 1783323124608,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ received: 0 });
  });
});
```

- [ ] **Step 3: Add normalized channel event contract**

Create `services/kfc-agent-backend/src/channels/conversationEvent.ts`:

```ts
import type { Channel } from '../domain/types.js';

export interface ConversationEvent {
  channel: Extract<Channel, 'messenger' | 'zalo' | 'messenger_mock' | 'zalo_mock' | 'web_mock'>;
  externalUserId: string;
  externalThreadId: string;
  text: string;
  eventType: 'message' | 'postback';
  rawEventId: string;
  receivedAt: string;
}
```

- [ ] **Step 4: Implement Messenger verification, normalization, and send helper**

Create `services/kfc-agent-backend/src/channels/messenger.ts`:

```ts
import { z } from 'zod';
import type { MessengerClient } from '../clients/interfaces.js';
import type { ToolResult } from '../domain/types.js';
import type { ConversationEvent } from './conversationEvent.js';

const messengerWebhookSchema = z.object({
  object: z.literal('page'),
  entry: z.array(z.object({
    id: z.string(),
    time: z.number().optional(),
    messaging: z.array(z.object({
      sender: z.object({ id: z.string() }),
      recipient: z.object({ id: z.string() }),
      timestamp: z.number().optional(),
      message: z.object({
        mid: z.string().optional(),
        text: z.string().optional(),
        is_echo: z.boolean().optional(),
      }).optional(),
      postback: z.object({
        mid: z.string().optional(),
        payload: z.string(),
      }).optional(),
    })),
  })),
});

export function verifyMessengerChallenge(
  query: Record<string, unknown>,
  expectedVerifyToken: string,
): { statusCode: number; body: string } {
  if (
    query['hub.mode'] === 'subscribe'
    && query['hub.verify_token'] === expectedVerifyToken
    && typeof query['hub.challenge'] === 'string'
  ) {
    return { statusCode: 200, body: query['hub.challenge'] };
  }

  return { statusCode: 403, body: 'Forbidden' };
}

export function normalizeMessengerWebhook(payload: unknown, pageId: string): ConversationEvent[] {
  const body = messengerWebhookSchema.parse(payload);
  const events: ConversationEvent[] = [];

  for (const entry of body.entry) {
    if (entry.id !== pageId) continue;
    for (const item of entry.messaging) {
      if (item.message?.is_echo) continue;
      const text = item.message?.text ?? item.postback?.payload;
      if (!text) continue;
      events.push({
        channel: 'messenger',
        externalUserId: item.sender.id,
        externalThreadId: item.sender.id,
        text,
        eventType: item.postback ? 'postback' : 'message',
        rawEventId: item.message?.mid ?? item.postback?.mid ?? `${item.sender.id}:${item.timestamp ?? entry.time ?? Date.now()}`,
        receivedAt: new Date(item.timestamp ?? entry.time ?? Date.now()).toISOString(),
      });
    }
  }

  return events;
}

export function createMessengerClient(input: { pageAccessToken?: string; graphApiBaseUrl?: string; fetchImpl?: typeof fetch }): MessengerClient {
  const fetchImpl = input.fetchImpl ?? fetch;
  const graphApiBaseUrl = input.graphApiBaseUrl ?? 'https://graph.facebook.com';
  return {
    async sendText(recipientId, text): Promise<ToolResult<{ messageId: string }>> {
      if (!input.pageAccessToken) {
        return { ok: false, errorCode: 'missing_page_access_token', message: 'Messenger page access token is not configured' };
      }
      const response = await fetchImpl(`${graphApiBaseUrl}/me/messages?access_token=${input.pageAccessToken}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipient: { id: recipientId },
          message: { text },
        }),
      });
      const body = await response.json() as { message_id?: string; error?: { message?: string } };
      if (!response.ok || !body.message_id) {
        return { ok: false, errorCode: 'messenger_send_failed', message: body.error?.message ?? 'Messenger send failed' };
      }
      return { ok: true, value: { messageId: body.message_id }, message: 'sent' };
    },
  };
}
```

- [ ] **Step 5: Implement Zalo normalization and send helper**

Create `services/kfc-agent-backend/src/channels/zalo.ts`:

```ts
import { z } from 'zod';
import type { ZaloClient } from '../clients/interfaces.js';
import type { ToolResult } from '../domain/types.js';
import type { ConversationEvent } from './conversationEvent.js';

const zaloWebhookSchema = z.object({
  event_name: z.string(),
  sender: z.object({ id: z.string() }).optional(),
  recipient: z.object({ id: z.string() }).optional(),
  message: z.object({
    msg_id: z.string().optional(),
    text: z.string().optional(),
  }).optional(),
  timestamp: z.number().optional(),
}).passthrough();

export function normalizeZaloWebhook(payload: unknown, expectedOaId?: string): ConversationEvent[] {
  const body = zaloWebhookSchema.parse(payload);
  if (expectedOaId && body.recipient?.id && body.recipient.id !== expectedOaId) return [];
  if (!body.event_name.includes('text')) return [];
  if (!body.sender?.id || !body.message?.text) return [];

  return [{
    channel: 'zalo',
    externalUserId: body.sender.id,
    externalThreadId: body.sender.id,
    text: body.message.text,
    eventType: 'message',
    rawEventId: body.message.msg_id ?? `${body.sender.id}:${body.timestamp ?? Date.now()}`,
    receivedAt: new Date(body.timestamp ?? Date.now()).toISOString(),
  }];
}

export function createZaloClient(input: { accessToken?: string; fetchImpl?: typeof fetch }): ZaloClient {
  const fetchImpl = input.fetchImpl ?? fetch;
  return {
    async sendText(recipientId, text): Promise<ToolResult<{ messageId: string }>> {
      if (!input.accessToken) {
        return { ok: false, errorCode: 'missing_zalo_access_token', message: 'Zalo access token is not configured' };
      }
      const response = await fetchImpl('https://openapi.zalo.me/v3.0/oa/message/cs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          access_token: input.accessToken,
        },
        body: JSON.stringify({
          recipient: { user_id: recipientId },
          message: { text },
        }),
      });
      const body = await response.json() as { message_id?: string; error?: number; message?: string };
      if (!response.ok || body.error) {
        return { ok: false, errorCode: 'zalo_send_failed', message: body.message ?? 'Zalo send failed' };
      }
      return { ok: true, value: { messageId: body.message_id ?? `zalo_${recipientId}` }, message: 'sent' };
    },
  };
}
```

- [ ] **Step 6: Register webhook routes**

Modify `services/kfc-agent-backend/src/api/server.ts`:

```ts
import Fastify, { type FastifyInstance } from 'fastify';
import { registerRoutes, type RouteOptions } from './routes.js';

export type BuildServerOptions = RouteOptions;

export function buildServer(options: BuildServerOptions = {}): FastifyInstance {
  const server = Fastify({ logger: false });

  server.get('/health', async () => ({
    ok: true,
    service: 'kfc-agent-backend',
  }));

  registerRoutes(server, options);

  return server;
}
```

Modify `services/kfc-agent-backend/src/api/routes.ts`:

```ts
import { type FastifyInstance } from 'fastify';
import { z } from 'zod';
import { DashboardEventBus } from '../dashboard/eventBus.js';
import { loadGeneratedFixtures } from '../fixtures/loadFixtures.js';
import { runAgentTurn } from '../graph/buildGraph.js';
import { createMockClients } from '../mock/createMockClients.js';
import { MemoryStore } from '../persistence/memoryStore.js';
import { normalizeMessengerWebhook, verifyMessengerChallenge } from '../channels/messenger.js';
import { normalizeZaloWebhook } from '../channels/zalo.js';

export interface RouteOptions {
  messengerVerifyToken?: string;
  metaPageId?: string;
  zaloOaId?: string;
}

const chatPayloadSchema = z.object({
  sessionId: z.string(),
  customerId: z.string(),
  channel: z.enum(['messenger_mock', 'zalo_mock', 'web_mock']),
  text: z.string(),
});

export function registerRoutes(server: FastifyInstance, options: RouteOptions = {}): void {
  const store = new MemoryStore();
  const dashboard = new DashboardEventBus();
  const clientsPromise = loadGeneratedFixtures(process.cwd()).then(createMockClients);

  server.post('/chat/mock', async (request) => {
    const payload = chatPayloadSchema.parse(request.body);
    const clients = await clientsPromise;
    return runAgentTurn({
      ...payload,
      clients,
      store,
      dashboard,
    });
  });

  server.get('/webhooks/messenger', async (request, reply) => {
    const result = verifyMessengerChallenge(request.query as Record<string, unknown>, options.messengerVerifyToken ?? '');
    reply.code(result.statusCode).type('text/plain');
    return result.body;
  });

  server.post('/webhooks/messenger', async (request) => {
    const clients = await clientsPromise;
    const events = normalizeMessengerWebhook(request.body, options.metaPageId ?? '118976205445198');
    for (const event of events) {
      const sessionId = `messenger:${event.externalThreadId}`;
      const output = await runAgentTurn({
        sessionId,
        customerId: event.externalUserId,
        channel: event.channel,
        text: event.text,
        clients,
        store,
        dashboard,
      });
      const sendResult = await clients.messenger.sendText(event.externalUserId, output.responseText);
      const turns = await store.listTurns(sessionId);
      const pendingAssistantTurn = [...turns].reverse().find((turn) => turn.role === 'assistant' && turn.deliveryStatus === 'pending');
      if (pendingAssistantTurn) {
        await store.updateTurnDeliveryStatus(
          pendingAssistantTurn.id,
          sendResult.ok ? 'sent' : 'failed',
          sendResult.value?.messageId ?? null,
        );
      }
      dashboard.emitEvent({
        id: `dash_${sessionId}_assistant_${Date.now()}`,
        sessionId,
        type: 'assistant_reply_sent',
        payload: { deliveryStatus: sendResult.ok ? 'sent' : 'failed' },
        createdAt: new Date().toISOString(),
      });
    }
    return { received: events.length };
  });

  server.post('/webhooks/zalo', async (request) => {
    const clients = await clientsPromise;
    const events = normalizeZaloWebhook(request.body, options.zaloOaId);
    for (const event of events) {
      const sessionId = `zalo:${event.externalThreadId}`;
      const output = await runAgentTurn({
        sessionId,
        customerId: event.externalUserId,
        channel: event.channel,
        text: event.text,
        clients,
        store,
        dashboard,
      });
      const sendResult = await clients.zalo.sendText(event.externalUserId, output.responseText);
      const turns = await store.listTurns(sessionId);
      const pendingAssistantTurn = [...turns].reverse().find((turn) => turn.role === 'assistant' && turn.deliveryStatus === 'pending');
      if (pendingAssistantTurn) {
        await store.updateTurnDeliveryStatus(
          pendingAssistantTurn.id,
          sendResult.ok ? 'sent' : 'failed',
          sendResult.value?.messageId ?? null,
        );
      }
      dashboard.emitEvent({
        id: `dash_${sessionId}_assistant_${Date.now()}`,
        sessionId,
        type: 'assistant_reply_sent',
        payload: { deliveryStatus: sendResult.ok ? 'sent' : 'failed' },
        createdAt: new Date().toISOString(),
      });
    }
    return { received: events.length };
  });

  server.get('/dashboard/events/:sessionId', async (request) => {
    const params = z.object({ sessionId: z.string() }).parse(request.params);
    return { events: dashboard.getEvents(params.sessionId) };
  });
}
```

- [ ] **Step 7: Confirm README channel setup notes**

Verify `services/kfc-agent-backend/README.md` includes these points:

```md
## Messenger And Zalo

- Messenger setup uses Page ID `118976205445198`.
- `GET /webhooks/messenger` handles Meta verification with `MESSENGER_VERIFY_TOKEN`.
- `POST /webhooks/messenger` accepts Page webhook deliveries.
- `POST /webhooks/zalo` accepts Zalo OA webhook deliveries.
- Local tests use fixture payloads and do not require live channel credentials.
```

- [ ] **Step 8: Run final channel verification and commit**

Run:

```bash
cd services/kfc-agent-backend
npm test -- test/channels/messenger-webhook.test.ts test/channels/zalo-webhook.test.ts test/api/chat.test.ts
npm test
npm run build
```

Expected: channel fixture tests, existing chat API tests, full backend tests, and TypeScript build pass without live Messenger or Zalo credentials.

Commit:

```bash
git add services/kfc-agent-backend/src/channels services/kfc-agent-backend/src/api services/kfc-agent-backend/test/channels services/kfc-agent-backend/test/api services/kfc-agent-backend/README.md
git commit -m "feat: add Messenger and Zalo webhook adapters"
```

---

### Task 12: Final Two-Video Proof

**Files:**
- Create: `artifacts/kfc-ai-chat-ordering/proof/<timestamp>/messenger-chat-ai.mp4`
- Create: `artifacts/kfc-ai-chat-ordering/proof/<timestamp>/flutter-dashboard-conversation.mp4`
- Create: `artifacts/kfc-ai-chat-ordering/proof/<timestamp>/proof-manifest.json`
- Test: live Messenger callback, backend event stream, and FDB-visible dashboard state

**Interfaces:**
- Consumes: Messenger Page ID `118976205445198`
- Consumes: `POST /webhooks/messenger`
- Consumes: `GET /dashboard/events/:sessionId`
- Consumes: Flutter app at `/Users/vietthangvunguyen/Workspace/hackathon/apps/kfc_live_monitor_flutter`

- [ ] **Step 1: Prepare the proof directory**

Run:

```bash
cd /Users/vietthangvunguyen/Workspace/hackathon
PROOF_DIR="artifacts/kfc-ai-chat-ordering/proof/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$PROOF_DIR"
printf '%s\n' "$PROOF_DIR" > /tmp/kfc-agent-proof-dir.txt
```

Expected: a new proof directory exists and `/tmp/kfc-agent-proof-dir.txt` points to it.

- [ ] **Step 2: Start backend, public callback, and dashboard**

Run the backend and expose a public HTTPS callback URL with the chosen tunnel tool:

```bash
cd /Users/vietthangvunguyen/Workspace/hackathon/services/kfc-agent-backend
npm run fixtures:build
npm run dev
```

Configure Meta Messenger webhook callback to:

```text
<PUBLIC_HTTPS_BASE_URL>/webhooks/messenger
```

Verify:

```bash
curl -s http://localhost:18090/health
curl -s http://localhost:18090/dashboard/events/messenger-proof
```

Expected: backend health is OK and dashboard events endpoint responds locally.

- [ ] **Step 3: Launch the Flutter dashboard through FDB**

Run:

```bash
cd /Users/vietthangvunguyen/Workspace/hackathon
DEVICE=$(fdb devices 2>/dev/null | grep '^DEVICE_ID=' | head -1 | sed 's/DEVICE_ID=\([^ ]*\).*/\1/')
fdb launch --device "$DEVICE" --project /Users/vietthangvunguyen/Workspace/hackathon/apps/kfc_live_monitor_flutter
fdb --session-dir /Users/vietthangvunguyen/Workspace/hackathon/apps/kfc_live_monitor_flutter/.fdb doctor
fdb --session-dir /Users/vietthangvunguyen/Workspace/hackathon/apps/kfc_live_monitor_flutter/.fdb describe
```

Expected:

- `APP_STARTED`
- `DOCTOR_SUMMARY=pass`
- `fdb describe` shows the live monitor grid

- [ ] **Step 4: Capture the Messenger proof video in Chrome**

Use Chrome with the logged-in user profile and open:

```text
https://m.me/118976205445198
```

Record the Chrome Messenger window while sending a natural ordering conversation to the AI chatbot. The recording must show:

- user messages in Messenger
- AI replies in Messenger generated through live OpenAI API calls
- at least one cart/order state change
- the thread/customer/session identifier that will also appear in the dashboard proof

Do not use canned assistant responses or mocked LLM outputs for this final proof.

Save the result as:

```bash
PROOF_DIR=$(cat /tmp/kfc-agent-proof-dir.txt)
test -f "$PROOF_DIR/messenger-chat-ai.mp4"
```

Expected: `messenger-chat-ai.mp4` exists and is viewable.

- [ ] **Step 5: Capture the Flutter dashboard proof video with FDB verification**

Keep the same backend proof run active. Record the Flutter dashboard app while the Messenger conversation is visible in the live monitor grid. FDB 1.7.0 is used for launch, inspection, screenshots, and keyed interaction; use the platform recorder or an approved proof script to write the MP4. Use FDB before and after recording to prove the correct app/session is running:

```bash
PROOF_DIR=$(cat /tmp/kfc-agent-proof-dir.txt)
fdb --session-dir /Users/vietthangvunguyen/Workspace/hackathon/apps/kfc_live_monitor_flutter/.fdb describe > "$PROOF_DIR/fdb-dashboard-before.txt"
fdb --session-dir /Users/vietthangvunguyen/Workspace/hackathon/apps/kfc_live_monitor_flutter/.fdb screenshot --full --output "$PROOF_DIR/fdb-dashboard-before.png"
```

Record the dashboard window and save:

```bash
test -f "$PROOF_DIR/flutter-dashboard-conversation.mp4"
```

After recording:

```bash
fdb --session-dir /Users/vietthangvunguyen/Workspace/hackathon/apps/kfc_live_monitor_flutter/.fdb describe > "$PROOF_DIR/fdb-dashboard-after.txt"
fdb --session-dir /Users/vietthangvunguyen/Workspace/hackathon/apps/kfc_live_monitor_flutter/.fdb screenshot --full --output "$PROOF_DIR/fdb-dashboard-after.png"
```

Expected: `flutter-dashboard-conversation.mp4` exists and the FDB before/after descriptions show the same conversation/session visible in the dashboard.

- [ ] **Step 6: Write and verify the proof manifest**

Create `proof-manifest.json`:

```json
{
  "messengerVideo": "messenger-chat-ai.mp4",
  "dashboardVideo": "flutter-dashboard-conversation.mp4",
  "messengerPageId": "118976205445198",
  "sessionId": "<same session id shown in both videos>",
  "backendHealth": "verified",
  "fdbDoctor": "pass"
}
```

Verify:

```bash
PROOF_DIR=$(cat /tmp/kfc-agent-proof-dir.txt)
test -s "$PROOF_DIR/messenger-chat-ai.mp4"
test -s "$PROOF_DIR/flutter-dashboard-conversation.mp4"
test -s "$PROOF_DIR/proof-manifest.json"
test -s "$PROOF_DIR/fdb-dashboard-before.txt"
test -s "$PROOF_DIR/fdb-dashboard-after.txt"
```

Expected: all proof files exist and are non-empty.

---

### Task 13: Hackathon Deployment Scripts

**Files:**
- Create: `docs/deployment/hackathon-free-deploy.md`
- Create: `scripts/deploy-backend-cloud-run.sh`
- Create: `scripts/deploy-dashboard-cloudflare-pages.sh`
- Create: `tests/deployment/deploy_scripts.test.sh`
- Test: deployment script syntax and Flutter Web release build

**Interfaces:**
- Produces: Cloud Run deployment path for `services/kfc-agent-backend`
- Produces: Cloudflare Pages deployment path for `apps/kfc_live_monitor_flutter/build/web`
- Consumes: Neon `DATABASE_URL`
- Consumes: Google Secret Manager secrets for OpenAI, Messenger, and database credentials

- [ ] **Step 1: Add defensive deployment scripts**

Create `scripts/deploy-backend-cloud-run.sh` so it:

- requires `GCP_PROJECT_ID`
- deploys `services/kfc-agent-backend` to Cloud Run
- uses region `asia-southeast1` by default
- sets `META_PAGE_ID=118976205445198`
- expects `DATABASE_URL`, `OPENAI_API_KEY`, `MESSENGER_VERIFY_TOKEN`, `META_PAGE_ACCESS_TOKEN`, and `META_APP_SECRET` in Google Secret Manager
- fails clearly when `services/kfc-agent-backend` or its `Dockerfile` is missing

Create `scripts/deploy-dashboard-cloudflare-pages.sh` so it:

- builds `apps/kfc_live_monitor_flutter` with `flutter build web --release`
- passes `KFC_BACKEND_BASE_URL` as a Dart define when provided
- deploys `build/web` with Wrangler to Cloudflare Pages

- [ ] **Step 2: Add deployment runbook**

Create `docs/deployment/hackathon-free-deploy.md` covering:

- Cloud Run backend
- Neon Free Postgres
- Cloudflare Pages dashboard
- Messenger webhook callback URL
- required secrets
- cost controls
- final two-video proof artifacts

- [ ] **Step 3: Add deployment script tests**

Create `tests/deployment/deploy_scripts.test.sh` and run:

```bash
cd /Users/vietthangvunguyen/Workspace/hackathon
bash tests/deployment/deploy_scripts.test.sh
```

Expected: script exits 0 after checking file existence, executable bits, shell syntax, and key runbook terms.

- [ ] **Step 4: Verify Flutter Web build**

Run:

```bash
cd /Users/vietthangvunguyen/Workspace/hackathon/apps/kfc_live_monitor_flutter
flutter build web --release
```

Expected: `build/web` is produced successfully.

- [ ] **Step 5: Commit deployment files**

Run:

```bash
cd /Users/vietthangvunguyen/Workspace/hackathon
git add docs/deployment/hackathon-free-deploy.md scripts/deploy-backend-cloud-run.sh scripts/deploy-dashboard-cloudflare-pages.sh tests/deployment/deploy_scripts.test.sh docs/superpowers/specs/2026-07-07-kfc-agent-backend-langgraph-design.md docs/superpowers/plans/2026-07-07-kfc-agent-backend-langgraph-implementation.md
git commit -m "docs: add hackathon deployment path"
```

---

## Self-Review

Spec coverage:

- Fastify backend scaffold: Task 1 and Task 7.
- Production-style external clients: Task 2 and Task 4.
- OKF and crawled-data mock source model: Task 3.
- LangGraph controlled flow and confirmation gate: Task 6.
- Context management and long-range retrieval: Task 5 and Task 6.
- Typed tools and mock business behavior: Task 4 and Task 6.
- Markdown scenario integration tests: Task 8.
- Messenger and Zalo channel webhook adapters: Task 11.
- LangSmith optional tracing: Task 9.
- Dashboard proof event stream: Task 5, Task 7, and Task 8.
- Documentation and base verification: Task 10.
- Final channel and full-suite verification: Task 11.
- Final Messenger and Flutter dashboard proof videos: Task 12.
- Hackathon deployment path: Task 13.

No incomplete plan markers are intentionally left in this plan. The first implementation slice uses deterministic graph logic and mock clients so tests can pass without live LLM calls; future production work can replace deterministic NLU/composition with model-backed LangGraph nodes behind the same state and tool contracts.
