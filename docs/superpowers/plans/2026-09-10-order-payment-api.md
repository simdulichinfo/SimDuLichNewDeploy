# Order/Payment API (Đợt 4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add order creation, order lookup, SePay payment (initiate + webhook + admin manual
confirm), and admin order/payment/log listing to `simDulichNew`, replicating the old Java
order-service/payment-service contract exactly so the existing frontend works unchanged.

**Architecture:** Next.js Route Handlers under `app/api/orders/...` and `app/api/payments/...`, no
microservices/message queue — order creation and payment confirmation are direct function calls in
the same process. Public order/payment reads go through a `security definer` RPC
(`get_order_by_code`) instead of direct table SELECT, since `orders`/`order_items` allow public
INSERT (guest checkout) but must not allow public SELECT (would let anyone list all orders via a
direct Supabase REST call). The two payment-status-mutating routes with no per-user JWT to scope by
(the real SePay webhook and the dev-only webhook simulator) use a new service-role Supabase client
— the only place in this project that uses `SUPABASE_SERVICE_ROLE_KEY`.

**Tech Stack:** Next.js 16.3.4 Route Handlers, `@supabase/supabase-js`, Vitest.

## Global Constraints

- Route paths match the old Java BE exactly (see
  `docs/superpowers/specs/2026-09-10-order-payment-api-design.md`) — `/api/orders/orders/...`,
  `/api/orders/admin/orders/...`, `/api/payments/payments/...`, `/api/payments/admin/...`.
- Every error response is `{ message: "..." }` with an appropriate status code (400/401/403/404/500).
- `orders`/`order_items` RLS: public INSERT allowed, no public SELECT policy at all — public
  lookup-by-code goes ONLY through the `get_order_by_code` RPC. Admin/staff get `for all` access via
  `is_admin_or_staff()` (already defined in migration `0003`).
- `payment_transactions`/`api_logs` RLS: admin/staff `for all` only, no public policy of any kind.
- `SUPABASE_SERVICE_ROLE_KEY` is used ONLY in the two webhook-family routes (`/payments/webhook/
  sepay/callback` and the dev-only `/payments/webhook/{provider}`) — never in any user-facing or
  admin-facing route. Both routes have no per-user JWT to scope a client by (the real webhook
  authenticates via a static API key header, the dev simulator authenticates via nothing at all,
  matching old behavior) — this is the shared justification for the exception, not two separate ones.
- `GET /api/orders/admin/orders` and `GET /api/payments/admin/payments`/`admin/api-logs` use
  **0-indexed pagination**, field `number` — matches the Spring `Page` convention already used by
  `/api/identity/auth/users` and `/api/catalog/admin/products/search` from earlier plans.
- `POST /api/payments/payments/webhook/{provider}` (dev simulator) returns 404 when
  `process.env.NODE_ENV === 'production'`, checked before any DB client is created.
- Order total is always computed server-side from the current `products.price_buy` at order-creation
  time — the client never sends a price. Each `order_item` stores a **snapshot** of `product_title`,
  `unit_price`, `sim_type` at creation time (this doubles as the fix for the old system's missing
  `productName` field — order items always show the name as it was when purchased).
- Order code scheme: `"SDL"` + 8 random characters from the alphabet
  `"23456789ABCDEFGHJKMNPQRSTVWXYZ"` (excludes `0,1,I,L,O,U` to avoid ambiguous characters), retried
  up to 5 times on a `23505` (unique violation) before giving up.
- Physical-SIM validation: if ANY item in an order has `simType === "physical"`,
  `shippingMethod` must be `"delivery"` with a non-empty `shippingAddress`; otherwise
  `shippingMethod` must be `"email"`.
- SePay webhook idempotency: gate on the `payment_transactions.transaction_ref` unique constraint
  (`"SEPAY-" + payload.id`), not on `orders.payment_status` alone — a retried webhook delivery
  re-attempts the insert, which fails harmlessly on the unique constraint, and the order-status
  update only runs after a successful (non-duplicate) insert.
- Vitest: mock Supabase via the chainable query-builder pattern already used throughout this repo
  (`select/eq/in/insert/update/rpc/order/range/maybeSingle/... → then(resolve)`); each test file
  defines its own local builder mock.
- Next.js 16: Route Handler `params` is a `Promise` — always `await params`. Read query strings via
  `new URL(request.url).searchParams`, never an injected `searchParams` argument.

---

### Task 1: Migration — orders/payments schema, RLS, RPC

**Files:**
- Create: `supabase/migrations/0007_orders_payments.sql`

**Interfaces:**
- Consumes: `public.is_admin_or_staff()` (already created in migration `0003`).
- Produces: tables `public.orders`, `public.order_items`, `public.payment_transactions`,
  `public.api_logs`; RPC `public.get_order_by_code(p_order_code text) returns jsonb`. All later
  tasks depend on these existing.

This task is pure SQL — no Vitest test, matching the precedent set by prior schema-only migrations
in this project (no live DB in CI; verified by manual read + later manual application).

- [ ] **Step 1: Create `supabase/migrations/0007_orders_payments.sql`**

```sql
create table public.orders (
  id bigserial primary key,
  order_code text not null unique,
  user_id uuid references auth.users(id),
  cust_name text not null,
  cust_email text not null,
  cust_phone text not null,
  total_amount numeric(15,2) not null,
  payment_method text not null check (payment_method in ('momo','vnpay','payos','sepay','cod')),
  payment_status text not null default 'pending',
  shipping_method text not null check (shipping_method in ('email','delivery')),
  shipping_address text,
  shipping_status text not null default 'none',
  carrier_name text,
  tracking_code text,
  created_at timestamptz not null default now()
);

create index idx_orders_created_at on public.orders(created_at desc);

create table public.order_items (
  id bigserial primary key,
  order_id bigint not null references public.orders(id) on delete cascade,
  product_id bigint not null references public.products(id),
  product_title text not null,
  quantity int not null check (quantity > 0),
  unit_price numeric(15,2) not null,
  sim_type text not null check (sim_type in ('esim','physical'))
);

create index idx_order_items_order on public.order_items(order_id);

create table public.payment_transactions (
  id bigserial primary key,
  order_id bigint not null references public.orders(id),
  transaction_ref text not null unique,
  amount numeric(15,2) not null,
  raw_response text,
  created_at timestamptz not null default now()
);

create index idx_payment_transactions_order on public.payment_transactions(order_id);

create table public.api_logs (
  id bigserial primary key,
  order_id bigint references public.orders(id),
  api_type text not null,
  endpoint text,
  request_body text,
  response_body text,
  http_status int,
  created_at timestamptz not null default now()
);

create index idx_api_logs_order on public.api_logs(order_id);

alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.payment_transactions enable row level security;
alter table public.api_logs enable row level security;

create policy "Anyone can create orders"
  on public.orders for insert
  to anon, authenticated
  with check (true);

create policy "Admins can manage orders"
  on public.orders for all
  using (public.is_admin_or_staff())
  with check (public.is_admin_or_staff());

create policy "Anyone can create order items"
  on public.order_items for insert
  to anon, authenticated
  with check (true);

create policy "Admins can manage order items"
  on public.order_items for all
  using (public.is_admin_or_staff())
  with check (public.is_admin_or_staff());

create policy "Admins can manage payment transactions"
  on public.payment_transactions for all
  using (public.is_admin_or_staff())
  with check (public.is_admin_or_staff());

create policy "Admins can manage api logs"
  on public.api_logs for all
  using (public.is_admin_or_staff())
  with check (public.is_admin_or_staff());

create or replace function public.get_order_by_code(p_order_code text)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  result jsonb;
begin
  select jsonb_build_object(
    'id', o.id, 'orderCode', o.order_code, 'userId', o.user_id,
    'custName', o.cust_name, 'custEmail', o.cust_email, 'custPhone', o.cust_phone,
    'totalAmount', o.total_amount, 'paymentMethod', o.payment_method, 'paymentStatus', o.payment_status,
    'shippingMethod', o.shipping_method, 'shippingAddress', o.shipping_address, 'shippingStatus', o.shipping_status,
    'carrierName', o.carrier_name, 'trackingCode', o.tracking_code, 'createdAt', o.created_at,
    'items', coalesce((select jsonb_agg(jsonb_build_object(
        'id', oi.id, 'productId', oi.product_id, 'productName', oi.product_title,
        'quantity', oi.quantity, 'unitPrice', oi.unit_price, 'simType', oi.sim_type
      )) from public.order_items oi where oi.order_id = o.id), '[]'::jsonb)
  ) into result
  from public.orders o
  where o.order_code = p_order_code;
  return result;
end;
$$;

grant execute on function public.get_order_by_code(text) to anon, authenticated;
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/0007_orders_payments.sql
git commit -m "feat: add orders/payments schema, RLS, and get_order_by_code RPC"
```

---

### Task 2: Service-role client + optional-auth helper

**Files:**
- Create: `lib/supabase/serviceClient.js`
- Create: `lib/supabase/__tests__/serviceClient.test.js`
- Modify: `lib/apiAuth.js`
- Create: `lib/__tests__/apiAuth.optionalAuthenticate.test.js`
- Modify: `.env.example`

**Interfaces:**
- Consumes: `createApiClient` from `lib/supabase/apiClient.js` (already exists).
- Produces: `createServiceClient()` (sync, returns a Supabase client authenticated with
  `SUPABASE_SERVICE_ROLE_KEY`, or `null` if the env var is missing) — Task 6 (webhook routes)
  consumes this. `optionalAuthenticate(request)` in `lib/apiAuth.js` (async, returns `{user: null,
  supabase: <anon client>}` when no `Authorization` header is present, or delegates to the existing
  `authenticate(request)` when one is — Task 3 (create-order route) consumes this.

- [ ] **Step 1: Write the failing test for `createServiceClient`**

Create `lib/supabase/__tests__/serviceClient.test.js`:

```js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createServiceClient } from '../serviceClient';

describe('createServiceClient', () => {
  const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';
  });

  afterEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl;
    process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey;
  });

  it('trả về null khi thiếu SUPABASE_SERVICE_ROLE_KEY', () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    expect(createServiceClient()).toBeNull();
  });

  it('trả về null khi thiếu NEXT_PUBLIC_SUPABASE_URL', () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    expect(createServiceClient()).toBeNull();
  });

  it('tạo client thành công khi có đủ biến môi trường', () => {
    const client = createServiceClient();
    expect(client).not.toBeNull();
    expect(client.auth.autoRefreshToken).toBe(false);
  });
});
```

- [ ] **Step 2: Run test, confirm it fails**

Run: `npm test -- serviceClient.test.js`
Expected: FAIL with "Cannot find module '../serviceClient'".

- [ ] **Step 3: Create `lib/supabase/serviceClient.js`**

```js
import { createClient } from '@supabase/supabase-js';

export function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    return null;
  }

  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
```

- [ ] **Step 4: Run test, confirm it passes**

Run: `npm test -- serviceClient.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Write the failing test for `optionalAuthenticate`**

Create `lib/__tests__/apiAuth.optionalAuthenticate.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';

const createApiClientMock = vi.fn();

vi.mock('../supabase/apiClient', () => ({
  createApiClient: (...args) => createApiClientMock(...args),
}));

import { optionalAuthenticate, AuthError } from '../apiAuth';

function makeRequest(headers = {}) {
  return { headers: { get: (key) => headers[key.toLowerCase()] ?? null } };
}

describe('optionalAuthenticate', () => {
  beforeEach(() => {
    createApiClientMock.mockReset();
  });

  it('trả user null và client ẩn danh khi không có header Authorization', async () => {
    const anonClient = {};
    createApiClientMock.mockReturnValue(anonClient);

    const result = await optionalAuthenticate(makeRequest());

    expect(createApiClientMock).toHaveBeenCalledWith();
    expect(result).toEqual({ user: null, supabase: anonClient });
  });

  it('ném AuthError khi có header Authorization nhưng token không hợp lệ', async () => {
    const scopedClient = { auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: { message: 'invalid' } }) } };
    createApiClientMock.mockReturnValue(scopedClient);

    await expect(optionalAuthenticate(makeRequest({ authorization: 'Bearer bad-token' })))
      .rejects.toBeInstanceOf(AuthError);
  });

  it('trả user thật khi header Authorization có token hợp lệ', async () => {
    const queryBuilder = {
      select: vi.fn(function select() { return this; }),
      eq: vi.fn(function eq() { return this; }),
      maybeSingle: vi.fn().mockResolvedValue({
        data: { id: 'u1', name: 'A', email: 'a@simdulich.vn', phone: '0900000000', role: 'customer', status: 'active' },
        error: null,
      }),
    };
    const scopedClient = {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u1' } }, error: null }) },
      from: vi.fn(() => queryBuilder),
    };
    createApiClientMock.mockReturnValue(scopedClient);

    const result = await optionalAuthenticate(makeRequest({ authorization: 'Bearer good-token' }));

    expect(result.user.id).toBe('u1');
    expect(result.supabase).toBe(scopedClient);
  });
});
```

- [ ] **Step 6: Run test, confirm it fails**

Run: `npm test -- apiAuth.optionalAuthenticate.test.js`
Expected: FAIL — `optionalAuthenticate` is not exported yet.

- [ ] **Step 7: Add `optionalAuthenticate` to `lib/apiAuth.js`**

Add this export to the existing `lib/apiAuth.js` (keep every existing export unchanged):

```js
export async function optionalAuthenticate(request) {
  const authHeader = request.headers.get('authorization') || '';
  if (!authHeader) {
    return { user: null, supabase: createApiClient() };
  }
  return authenticate(request);
}
```

- [ ] **Step 8: Run test, confirm it passes**

Run: `npm test -- apiAuth.optionalAuthenticate.test.js`
Expected: PASS (3 tests).

- [ ] **Step 9: Add the new environment variable to `.env.example`**

Add this line to `.env.example` (keep existing lines unchanged):

```
SUPABASE_SERVICE_ROLE_KEY=
```

- [ ] **Step 10: Run the full suite, then commit**

Run: `npm test`
Expected: PASS.

```bash
git add lib/supabase/serviceClient.js lib/supabase/__tests__/serviceClient.test.js lib/apiAuth.js lib/__tests__/apiAuth.optionalAuthenticate.test.js .env.example
git commit -m "feat: add service-role client and optional-auth helper for order/payment routes"
```

---

### Task 3: Order creation + public order lookup

**Files:**
- Create: `lib/orders.js`
- Create: `lib/__tests__/orders.test.js`
- Create: `app/api/orders/orders/route.js`
- Create: `app/api/orders/orders/__tests__/route.test.js`
- Create: `app/api/orders/orders/[orderCode]/route.js`
- Create: `app/api/orders/orders/[orderCode]/__tests__/route.test.js`

**Interfaces:**
- Consumes: `optionalAuthenticate`, `authErrorResponse` from `lib/apiAuth.js` (Task 2);
  `createApiClient` from `lib/supabase/apiClient.js`.
- Produces: `OrderError` (class, has `.status`), `createOrder(supabase, {userId, custName,
  custEmail, custPhone, paymentMethod, shippingMethod, shippingAddress, items})` (async, returns
  the created order in `OrderResponse` shape or throws `OrderError`), `getOrderByCode(supabase,
  orderCode)` (async, returns the order in `OrderResponse` shape or `null` if not found, or throws
  `OrderError` on a genuine DB error) in `lib/orders.js`.

- [ ] **Step 1: Write the failing test for `lib/orders.js`**

Create `lib/__tests__/orders.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';

function createQueryBuilderMock(result) {
  const builder = {
    select: vi.fn(() => builder),
    insert: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    in: vi.fn(() => builder),
    maybeSingle: vi.fn(() => builder),
    then: (resolve) => resolve(result),
  };
  return builder;
}

const fromMock = vi.fn();
const rpcMock = vi.fn();
const supabaseMock = { from: fromMock, rpc: rpcMock };

import { createOrder, getOrderByCode, OrderError } from '../orders';

describe('lib/orders — createOrder', () => {
  beforeEach(() => {
    fromMock.mockReset();
  });

  it('tạo đơn thành công cho sản phẩm eSIM, tự tính lại tổng tiền từ DB', async () => {
    const productsQuery = createQueryBuilderMock({
      data: [{ id: 1, title: 'eSIM Nhật Bản', price_buy: 89000, sim_type: 'esim', status: 'active' }],
      error: null,
    });
    const orderInsertQuery = createQueryBuilderMock({
      data: { id: 100, order_code: 'SDL2345ABCD', user_id: null, cust_name: 'A', cust_email: 'a@x.vn', cust_phone: '0900000000', total_amount: 178000, payment_method: 'sepay', payment_status: 'pending', shipping_method: 'email', shipping_address: null, shipping_status: 'none', carrier_name: null, tracking_code: null, created_at: '2026-09-10T00:00:00Z' },
      error: null,
    });
    const itemsInsertQuery = createQueryBuilderMock({
      data: [{ id: 1, product_id: 1, product_title: 'eSIM Nhật Bản', quantity: 2, unit_price: 89000, sim_type: 'esim' }],
      error: null,
    });
    let orderCallCount = 0;
    fromMock.mockImplementation((table) => {
      if (table === 'products') return productsQuery;
      if (table === 'orders') { orderCallCount += 1; return orderInsertQuery; }
      if (table === 'order_items') return itemsInsertQuery;
      throw new Error(`unexpected table ${table}`);
    });

    const result = await createOrder(supabaseMock, {
      userId: null, custName: 'A', custEmail: 'a@x.vn', custPhone: '0900000000',
      paymentMethod: 'sepay', shippingMethod: 'email', shippingAddress: null,
      items: [{ productId: 1, quantity: 2 }],
    });

    expect(orderInsertQuery.insert).toHaveBeenCalledWith(expect.objectContaining({ total_amount: 178000 }));
    expect(result).toEqual({
      id: 100, orderCode: 'SDL2345ABCD', userId: null,
      custName: 'A', custEmail: 'a@x.vn', custPhone: '0900000000',
      totalAmount: 178000, paymentMethod: 'sepay', paymentStatus: 'pending',
      shippingMethod: 'email', shippingAddress: null, shippingStatus: 'none',
      carrierName: null, trackingCode: null, createdAt: '2026-09-10T00:00:00Z',
      items: [{ id: 1, productId: 1, productName: 'eSIM Nhật Bản', quantity: 2, unitPrice: 89000, simType: 'esim' }],
    });
  });

  it('ném OrderError 400 khi sản phẩm vật lý mà shippingMethod không phải delivery', async () => {
    fromMock.mockReturnValue(createQueryBuilderMock({
      data: [{ id: 2, title: 'SIM vật lý Việt Nam', price_buy: 150000, sim_type: 'physical', status: 'active' }],
      error: null,
    }));

    await expect(createOrder(supabaseMock, {
      userId: null, custName: 'A', custEmail: 'a@x.vn', custPhone: '0900000000',
      paymentMethod: 'sepay', shippingMethod: 'email', shippingAddress: null,
      items: [{ productId: 2, quantity: 1 }],
    })).rejects.toMatchObject({ status: 400 });
  });

  it('ném OrderError 400 khi sản phẩm không tồn tại hoặc không active', async () => {
    fromMock.mockReturnValue(createQueryBuilderMock({ data: [], error: null }));

    await expect(createOrder(supabaseMock, {
      userId: null, custName: 'A', custEmail: 'a@x.vn', custPhone: '0900000000',
      paymentMethod: 'sepay', shippingMethod: 'email', shippingAddress: null,
      items: [{ productId: 999, quantity: 1 }],
    })).rejects.toMatchObject({ status: 400 });
  });

  it('ném OrderError 400 khi items rỗng', async () => {
    await expect(createOrder(supabaseMock, {
      userId: null, custName: 'A', custEmail: 'a@x.vn', custPhone: '0900000000',
      paymentMethod: 'sepay', shippingMethod: 'email', shippingAddress: null,
      items: [],
    })).rejects.toMatchObject({ status: 400 });
  });
});

describe('lib/orders — getOrderByCode', () => {
  beforeEach(() => {
    rpcMock.mockReset();
  });

  it('trả order khi RPC tìm thấy', async () => {
    rpcMock.mockResolvedValue({ data: { id: 1, orderCode: 'SDL2345ABCD', items: [] }, error: null });

    const result = await getOrderByCode(supabaseMock, 'SDL2345ABCD');

    expect(rpcMock).toHaveBeenCalledWith('get_order_by_code', { p_order_code: 'SDL2345ABCD' });
    expect(result).toEqual({ id: 1, orderCode: 'SDL2345ABCD', items: [] });
  });

  it('trả null khi RPC không tìm thấy', async () => {
    rpcMock.mockResolvedValue({ data: null, error: null });

    const result = await getOrderByCode(supabaseMock, 'KHONGTONTAI');

    expect(result).toBeNull();
  });

  it('ném OrderError 500 khi RPC lỗi', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'boom' } });

    await expect(getOrderByCode(supabaseMock, 'SDL2345ABCD')).rejects.toBeInstanceOf(OrderError);
  });
});
```

- [ ] **Step 2: Run test, confirm it fails**

Run: `npm test -- lib/__tests__/orders.test.js`
Expected: FAIL with "Cannot find module '../orders'".

- [ ] **Step 3: Create `lib/orders.js`**

```js
export class OrderError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

const ORDER_CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';

function generateOrderCode() {
  let code = 'SDL';
  for (let i = 0; i < 8; i++) {
    code += ORDER_CODE_ALPHABET[Math.floor(Math.random() * ORDER_CODE_ALPHABET.length)];
  }
  return code;
}

function mapOrderItem(row) {
  return {
    id: row.id,
    productId: row.product_id,
    productName: row.product_title,
    quantity: row.quantity,
    unitPrice: Number(row.unit_price),
    simType: row.sim_type,
  };
}

function mapOrderDetail(row, items) {
  return {
    id: row.id,
    orderCode: row.order_code,
    userId: row.user_id,
    custName: row.cust_name,
    custEmail: row.cust_email,
    custPhone: row.cust_phone,
    totalAmount: Number(row.total_amount),
    paymentMethod: row.payment_method,
    paymentStatus: row.payment_status,
    shippingMethod: row.shipping_method,
    shippingAddress: row.shipping_address,
    shippingStatus: row.shipping_status,
    carrierName: row.carrier_name,
    trackingCode: row.tracking_code,
    createdAt: row.created_at,
    items: (items || []).map(mapOrderItem),
  };
}

export async function createOrder(supabase, {
  userId, custName, custEmail, custPhone, paymentMethod, shippingMethod, shippingAddress, items,
}) {
  if (!items || items.length === 0) {
    throw new OrderError('Đơn hàng phải có ít nhất 1 sản phẩm.', 400);
  }

  const productIds = items.map((it) => it.productId);
  const { data: products, error: productsError } = await supabase
    .from('products')
    .select('id, title, price_buy, sim_type, status')
    .in('id', productIds);
  if (productsError) {
    throw new OrderError('Không tải được thông tin sản phẩm.', 500);
  }
  const productById = new Map((products || []).map((p) => [p.id, p]));

  const orderItemsToInsert = [];
  let totalAmount = 0;
  let hasPhysical = false;
  for (const item of items) {
    const product = productById.get(item.productId);
    if (!product || product.status !== 'active') {
      throw new OrderError(`Sản phẩm với id ${item.productId} không tồn tại hoặc đã ngừng bán.`, 400);
    }
    if (!Number.isFinite(item.quantity) || item.quantity <= 0) {
      throw new OrderError('Số lượng sản phẩm phải lớn hơn 0.', 400);
    }
    if (product.sim_type === 'physical') {
      hasPhysical = true;
    }
    const unitPrice = Number(product.price_buy);
    totalAmount += unitPrice * item.quantity;
    orderItemsToInsert.push({
      product_id: product.id,
      product_title: product.title,
      quantity: item.quantity,
      unit_price: unitPrice,
      sim_type: product.sim_type,
    });
  }

  if (hasPhysical) {
    if (shippingMethod !== 'delivery' || !shippingAddress) {
      throw new OrderError('Đơn hàng có SIM vật lý phải chọn giao hàng và nhập địa chỉ.', 400);
    }
  } else if (shippingMethod !== 'email') {
    throw new OrderError('Đơn hàng eSIM phải chọn nhận qua email.', 400);
  }

  let order = null;
  for (let attempt = 0; attempt < 5 && !order; attempt++) {
    const orderCode = generateOrderCode();
    const { data, error } = await supabase
      .from('orders')
      .insert({
        order_code: orderCode,
        user_id: userId ?? null,
        cust_name: custName,
        cust_email: custEmail,
        cust_phone: custPhone,
        total_amount: totalAmount,
        payment_method: paymentMethod,
        payment_status: 'pending',
        shipping_method: shippingMethod,
        shipping_address: shippingAddress ?? null,
        shipping_status: shippingMethod === 'delivery' ? 'pending' : 'none',
      })
      .select('*')
      .maybeSingle();
    if (!error) {
      order = data;
      break;
    }
    if (error.code !== '23505') {
      throw new OrderError('Không tạo được đơn hàng.', 500);
    }
  }
  if (!order) {
    throw new OrderError('Không tạo được mã đơn hàng duy nhất, vui lòng thử lại.', 500);
  }

  const { data: insertedItems, error: itemsError } = await supabase
    .from('order_items')
    .insert(orderItemsToInsert.map((it) => ({ ...it, order_id: order.id })))
    .select('*');
  if (itemsError) {
    throw new OrderError('Không tạo được chi tiết đơn hàng.', 500);
  }

  return mapOrderDetail(order, insertedItems);
}

export async function getOrderByCode(supabase, orderCode) {
  const { data, error } = await supabase.rpc('get_order_by_code', { p_order_code: orderCode });
  if (error) {
    throw new OrderError('Không tra được đơn hàng.', 500);
  }
  return data ?? null;
}
```

- [ ] **Step 4: Run test, confirm it passes**

Run: `npm test -- lib/__tests__/orders.test.js`
Expected: PASS (7 tests).

- [ ] **Step 5: Write the failing test for `POST /api/orders/orders`**

Create `app/api/orders/orders/__tests__/route.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';

const optionalAuthenticateMock = vi.fn();
const createOrderMock = vi.fn();

vi.mock('../../../../../lib/apiAuth', async () => {
  const actual = await vi.importActual('../../../../../lib/apiAuth');
  return { ...actual, optionalAuthenticate: (...args) => optionalAuthenticateMock(...args) };
});
vi.mock('../../../../../lib/orders', async () => {
  const actual = await vi.importActual('../../../../../lib/orders');
  return { ...actual, createOrder: (...args) => createOrderMock(...args) };
});

import { POST } from '../route';

function makeRequest(body) {
  return { headers: { get: () => null }, json: () => Promise.resolve(body) };
}

describe('POST /api/orders/orders', () => {
  beforeEach(() => {
    optionalAuthenticateMock.mockReset();
    createOrderMock.mockReset();
  });

  it('tạo đơn thành công cho khách vãng lai (không có token), trả 201', async () => {
    optionalAuthenticateMock.mockResolvedValue({ user: null, supabase: {} });
    createOrderMock.mockResolvedValue({ id: 1, orderCode: 'SDL2345ABCD' });

    const response = await POST(makeRequest({
      custName: 'A', custEmail: 'a@x.vn', custPhone: '0900000000',
      paymentMethod: 'sepay', shippingMethod: 'email', shippingAddress: null,
      items: [{ productId: 1, quantity: 1 }],
    }));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.orderCode).toBe('SDL2345ABCD');
    expect(createOrderMock).toHaveBeenCalledWith({}, expect.objectContaining({ userId: null }));
  });

  it('trả 400 khi thiếu trường bắt buộc', async () => {
    optionalAuthenticateMock.mockResolvedValue({ user: null, supabase: {} });

    const response = await POST(makeRequest({ custName: '', custEmail: 'a@x.vn', custPhone: '0900000000', paymentMethod: 'sepay', shippingMethod: 'email', items: [] }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ message: 'Thiếu thông tin bắt buộc.' });
    expect(createOrderMock).not.toHaveBeenCalled();
  });

  it('trả đúng status/message khi createOrder ném OrderError', async () => {
    optionalAuthenticateMock.mockResolvedValue({ user: null, supabase: {} });
    const { OrderError } = await vi.importActual('../../../../../lib/orders');
    createOrderMock.mockRejectedValue(new OrderError('Sản phẩm không tồn tại.', 400));

    const response = await POST(makeRequest({
      custName: 'A', custEmail: 'a@x.vn', custPhone: '0900000000',
      paymentMethod: 'sepay', shippingMethod: 'email', shippingAddress: null,
      items: [{ productId: 999, quantity: 1 }],
    }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ message: 'Sản phẩm không tồn tại.' });
  });
});
```

- [ ] **Step 6: Run test, confirm it fails**

Run: `npm test -- app/api/orders/orders/__tests__/route.test.js`
Expected: FAIL with "Cannot find module '../route'".

- [ ] **Step 7: Create `app/api/orders/orders/route.js`**

```js
import { NextResponse } from 'next/server';
import { optionalAuthenticate, authErrorResponse } from '../../../../lib/apiAuth';
import { createOrder, OrderError } from '../../../../lib/orders';

export async function POST(request) {
  try {
    const { user, supabase } = await optionalAuthenticate(request);
    if (!supabase) {
      return NextResponse.json({ message: 'Máy chủ chưa cấu hình Supabase.' }, { status: 500 });
    }

    const body = await request.json();
    const { custName, custEmail, custPhone, paymentMethod, shippingMethod, shippingAddress, items } = body;
    if (!custName || !custEmail || !custPhone || !paymentMethod || !shippingMethod || !items?.length) {
      return NextResponse.json({ message: 'Thiếu thông tin bắt buộc.' }, { status: 400 });
    }

    const order = await createOrder(supabase, {
      userId: user?.id ?? null, custName, custEmail, custPhone, paymentMethod, shippingMethod, shippingAddress, items,
    });
    return NextResponse.json(order, { status: 201 });
  } catch (error) {
    if (error instanceof OrderError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    return authErrorResponse(error);
  }
}
```

- [ ] **Step 8: Run test, confirm it passes**

Run: `npm test -- app/api/orders/orders/__tests__/route.test.js`
Expected: PASS (3 tests).

- [ ] **Step 9: Write the failing test for `GET /api/orders/orders/[orderCode]`**

Create `app/api/orders/orders/[orderCode]/__tests__/route.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';

const createApiClientMock = vi.fn();
const getOrderByCodeMock = vi.fn();

vi.mock('../../../../../../lib/supabase/apiClient', () => ({
  createApiClient: (...args) => createApiClientMock(...args),
}));
vi.mock('../../../../../../lib/orders', async () => {
  const actual = await vi.importActual('../../../../../../lib/orders');
  return { ...actual, getOrderByCode: (...args) => getOrderByCodeMock(...args) };
});

import { GET } from '../route';

describe('GET /api/orders/orders/[orderCode]', () => {
  beforeEach(() => {
    createApiClientMock.mockReset();
    getOrderByCodeMock.mockReset();
  });

  it('trả order khi tìm thấy', async () => {
    createApiClientMock.mockReturnValue({});
    getOrderByCodeMock.mockResolvedValue({ id: 1, orderCode: 'SDL2345ABCD', paymentStatus: 'pending' });

    const response = await GET({}, { params: Promise.resolve({ orderCode: 'SDL2345ABCD' }) });
    const body = await response.json();

    expect(body.orderCode).toBe('SDL2345ABCD');
  });

  it('trả 404 khi không tìm thấy', async () => {
    createApiClientMock.mockReturnValue({});
    getOrderByCodeMock.mockResolvedValue(null);

    const response = await GET({}, { params: Promise.resolve({ orderCode: 'KHONGTONTAI' }) });
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toEqual({ message: 'Không tìm thấy đơn hàng.' });
  });
});
```

- [ ] **Step 10: Run test, confirm it fails**

Run: `npm test -- "app/api/orders/orders/\[orderCode\]"`
Expected: FAIL with "Cannot find module '../route'".

- [ ] **Step 11: Create `app/api/orders/orders/[orderCode]/route.js`**

```js
import { NextResponse } from 'next/server';
import { createApiClient } from '../../../../../lib/supabase/apiClient';
import { getOrderByCode } from '../../../../../lib/orders';

export async function GET(request, { params }) {
  const { orderCode } = await params;
  const supabase = createApiClient();
  if (!supabase) {
    return NextResponse.json({ message: 'Máy chủ chưa cấu hình Supabase.' }, { status: 500 });
  }

  try {
    const order = await getOrderByCode(supabase, orderCode);
    if (!order) {
      return NextResponse.json({ message: 'Không tìm thấy đơn hàng.' }, { status: 404 });
    }
    return NextResponse.json(order);
  } catch {
    return NextResponse.json({ message: 'Có lỗi xảy ra, vui lòng thử lại.' }, { status: 500 });
  }
}
```

- [ ] **Step 12: Run test, confirm it passes**

Run: `npm test -- "app/api/orders/orders/\[orderCode\]"`
Expected: PASS (2 tests).

- [ ] **Step 13: Run the full suite, then commit**

Run: `npm test`
Expected: PASS.

```bash
git add lib/orders.js lib/__tests__/orders.test.js app/api/orders/orders
git commit -m "feat: add order creation and public order lookup"
```

---

### Task 4: Admin order listing + detail

**Files:**
- Create: `lib/adminOrders.js`
- Create: `lib/__tests__/adminOrders.test.js`
- Create: `app/api/orders/admin/orders/route.js`
- Create: `app/api/orders/admin/orders/__tests__/route.test.js`
- Create: `app/api/orders/admin/orders/[id]/route.js`
- Create: `app/api/orders/admin/orders/[id]/__tests__/route.test.js`

**Interfaces:**
- Consumes: `authenticate`, `authErrorResponse`, `requireRole` from `lib/apiAuth.js`.
- Produces: `mapOrderSummary(row)` (exported — Task 7 reuses this for the admin manual-confirm
  response), `listOrdersAdmin(supabase, {page, size})` → `{data: {content, number, totalElements,
  totalPages}, error}`, `getOrderAdminById(supabase, id)` → `{data: OrderResponse|null, error}` in
  `lib/adminOrders.js`.

- [ ] **Step 1: Write the failing test for `lib/adminOrders.js`**

Create `lib/__tests__/adminOrders.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';

function createQueryBuilderMock(result) {
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    order: vi.fn(() => builder),
    range: vi.fn(() => builder),
    maybeSingle: vi.fn(() => builder),
    then: (resolve) => resolve(result),
  };
  return builder;
}

const fromMock = vi.fn();
const supabaseMock = { from: fromMock };

const sampleOrderRow = {
  id: 1, order_code: 'SDL2345ABCD', user_id: null, cust_name: 'A', cust_email: 'a@x.vn', cust_phone: '0900000000',
  total_amount: 178000, payment_method: 'sepay', payment_status: 'pending', shipping_method: 'email',
  shipping_address: null, shipping_status: 'none', carrier_name: null, tracking_code: null, created_at: '2026-09-10T00:00:00Z',
};

import { listOrdersAdmin, getOrderAdminById, mapOrderSummary } from '../adminOrders';

describe('lib/adminOrders', () => {
  beforeEach(() => {
    fromMock.mockReset();
  });

  describe('listOrdersAdmin', () => {
    it('phân trang 0-indexed, trả field number', async () => {
      const query = createQueryBuilderMock({ data: [sampleOrderRow], count: 1, error: null });
      fromMock.mockReturnValue(query);

      const result = await listOrdersAdmin(supabaseMock, { page: 0, size: 20 });

      expect(query.range).toHaveBeenCalledWith(0, 19);
      expect(result.data.number).toBe(0);
      expect(result.data.content[0]).toEqual(mapOrderSummary(sampleOrderRow));
    });

    it('dùng page=0/size=20 khi tham số không hợp lệ (NaN)', async () => {
      const query = createQueryBuilderMock({ data: [], count: 0, error: null });
      fromMock.mockReturnValue(query);

      const result = await listOrdersAdmin(supabaseMock, { page: NaN, size: NaN });

      expect(query.range).toHaveBeenCalledWith(0, 19);
      expect(result.data.number).toBe(0);
      expect(result.data.size).toBe(20);
    });
  });

  describe('getOrderAdminById', () => {
    it('trả order kèm items', async () => {
      const orderQuery = createQueryBuilderMock({ data: sampleOrderRow, error: null });
      const itemsQuery = createQueryBuilderMock({
        data: [{ id: 1, product_id: 1, product_title: 'eSIM Nhật Bản', quantity: 2, unit_price: 89000, sim_type: 'esim' }],
        error: null,
      });
      fromMock.mockImplementation((table) => (table === 'orders' ? orderQuery : itemsQuery));

      const result = await getOrderAdminById(supabaseMock, 1);

      expect(result.data.items).toEqual([{ id: 1, productId: 1, productName: 'eSIM Nhật Bản', quantity: 2, unitPrice: 89000, simType: 'esim' }]);
    });

    it('trả data null khi không tìm thấy', async () => {
      fromMock.mockReturnValue(createQueryBuilderMock({ data: null, error: null }));

      const result = await getOrderAdminById(supabaseMock, 999);

      expect(result).toEqual({ data: null, error: null });
    });
  });
});
```

- [ ] **Step 2: Run test, confirm it fails**

Run: `npm test -- adminOrders.test.js`
Expected: FAIL with "Cannot find module '../adminOrders'".

- [ ] **Step 3: Create `lib/adminOrders.js`**

```js
export function mapOrderSummary(row) {
  return {
    id: row.id,
    orderCode: row.order_code,
    userId: row.user_id,
    custName: row.cust_name,
    custEmail: row.cust_email,
    totalAmount: Number(row.total_amount),
    paymentMethod: row.payment_method,
    paymentStatus: row.payment_status,
    shippingMethod: row.shipping_method,
    shippingStatus: row.shipping_status,
    carrierName: row.carrier_name,
    trackingCode: row.tracking_code,
    createdAt: row.created_at,
  };
}

function mapOrderItem(row) {
  return {
    id: row.id,
    productId: row.product_id,
    productName: row.product_title,
    quantity: row.quantity,
    unitPrice: Number(row.unit_price),
    simType: row.sim_type,
  };
}

function mapOrderDetail(row, items) {
  return {
    ...mapOrderSummary(row),
    custPhone: row.cust_phone,
    shippingAddress: row.shipping_address,
    items: (items || []).map(mapOrderItem),
  };
}

export async function listOrdersAdmin(supabase, { page, size } = {}) {
  const safePage = Number.isFinite(page) && page >= 0 ? Math.trunc(page) : 0;
  const safeSize = Number.isFinite(size) && size > 0 ? Math.trunc(size) : 20;
  const from = safePage * safeSize;
  const to = from + safeSize - 1;

  const { data, count, error } = await supabase
    .from('orders')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, to);
  if (error) return { data: null, error };

  const totalElements = count || 0;
  return {
    data: {
      content: (data || []).map(mapOrderSummary),
      number: safePage,
      size: safeSize,
      totalElements,
      totalPages: Math.ceil(totalElements / safeSize),
    },
    error: null,
  };
}

export async function getOrderAdminById(supabase, id) {
  const { data: order, error } = await supabase.from('orders').select('*').eq('id', id).maybeSingle();
  if (error) return { data: null, error };
  if (!order) return { data: null, error: null };

  const { data: items, error: itemsError } = await supabase.from('order_items').select('*').eq('order_id', id);
  if (itemsError) return { data: null, error: itemsError };

  return { data: mapOrderDetail(order, items), error: null };
}
```

- [ ] **Step 4: Run test, confirm it passes**

Run: `npm test -- adminOrders.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Write the failing test for `GET /api/orders/admin/orders`**

Create `app/api/orders/admin/orders/__tests__/route.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';

const authenticateMock = vi.fn();
const listOrdersAdminMock = vi.fn();

vi.mock('../../../../../../lib/apiAuth', async () => {
  const actual = await vi.importActual('../../../../../../lib/apiAuth');
  return { ...actual, authenticate: (...args) => authenticateMock(...args) };
});
vi.mock('../../../../../../lib/adminOrders', () => ({
  listOrdersAdmin: (...args) => listOrdersAdminMock(...args),
}));

import { GET } from '../route';

function makeRequest(url) {
  return { url, headers: { get: () => 'Bearer good-token' } };
}

describe('GET /api/orders/admin/orders', () => {
  beforeEach(() => {
    authenticateMock.mockReset();
    listOrdersAdminMock.mockReset();
  });

  it('đọc page/size từ query string', async () => {
    authenticateMock.mockResolvedValue({ user: { role: 'admin' }, supabase: {} });
    listOrdersAdminMock.mockResolvedValue({ data: { content: [], number: 1, size: 10, totalElements: 0, totalPages: 0 }, error: null });

    await GET(makeRequest('http://localhost:3000/api/orders/admin/orders?page=1&size=10'));

    expect(listOrdersAdminMock).toHaveBeenCalledWith({}, { page: 1, size: 10 });
  });

  it('trả 403 khi caller không phải admin/staff', async () => {
    authenticateMock.mockResolvedValue({ user: { role: 'customer' }, supabase: {} });

    const response = await GET(makeRequest('http://localhost:3000/api/orders/admin/orders'));

    expect(response.status).toBe(403);
  });
});
```

- [ ] **Step 6: Run test, confirm it fails**

Run: `npm test -- app/api/orders/admin/orders/__tests__/route.test.js`
Expected: FAIL with "Cannot find module '../route'".

- [ ] **Step 7: Create `app/api/orders/admin/orders/route.js`**

```js
import { NextResponse } from 'next/server';
import { authenticate, authErrorResponse, requireRole } from '../../../../../lib/apiAuth';
import { listOrdersAdmin } from '../../../../../lib/adminOrders';

export async function GET(request) {
  try {
    const { user, supabase } = await authenticate(request);
    requireRole(user, ['admin', 'staff']);

    const { searchParams } = new URL(request.url);
    const { data, error } = await listOrdersAdmin(supabase, {
      page: searchParams.get('page') != null ? Number(searchParams.get('page')) : undefined,
      size: searchParams.get('size') != null ? Number(searchParams.get('size')) : undefined,
    });
    if (error) {
      return NextResponse.json({ message: 'Không tải được danh sách đơn hàng.' }, { status: 500 });
    }
    return NextResponse.json(data);
  } catch (error) {
    return authErrorResponse(error);
  }
}
```

- [ ] **Step 8: Run test, confirm it passes**

Run: `npm test -- app/api/orders/admin/orders/__tests__/route.test.js`
Expected: PASS (2 tests).

- [ ] **Step 9: Write the failing test for `GET /api/orders/admin/orders/[id]`**

Create `app/api/orders/admin/orders/[id]/__tests__/route.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';

const authenticateMock = vi.fn();
const getOrderAdminByIdMock = vi.fn();

vi.mock('../../../../../../../lib/apiAuth', async () => {
  const actual = await vi.importActual('../../../../../../../lib/apiAuth');
  return { ...actual, authenticate: (...args) => authenticateMock(...args) };
});
vi.mock('../../../../../../../lib/adminOrders', () => ({
  getOrderAdminById: (...args) => getOrderAdminByIdMock(...args),
}));

import { GET } from '../route';

function makeRequest() {
  return { headers: { get: () => 'Bearer good-token' } };
}

describe('GET /api/orders/admin/orders/[id]', () => {
  beforeEach(() => {
    authenticateMock.mockReset();
    getOrderAdminByIdMock.mockReset();
  });

  it('trả order khi tìm thấy', async () => {
    authenticateMock.mockResolvedValue({ user: { role: 'admin' }, supabase: {} });
    getOrderAdminByIdMock.mockResolvedValue({ data: { id: 1, orderCode: 'SDL2345ABCD' }, error: null });

    const response = await GET(makeRequest(), { params: Promise.resolve({ id: '1' }) });
    const body = await response.json();

    expect(body.orderCode).toBe('SDL2345ABCD');
  });

  it('trả 404 khi không tìm thấy', async () => {
    authenticateMock.mockResolvedValue({ user: { role: 'admin' }, supabase: {} });
    getOrderAdminByIdMock.mockResolvedValue({ data: null, error: null });

    const response = await GET(makeRequest(), { params: Promise.resolve({ id: '999' }) });

    expect(response.status).toBe(404);
  });
});
```

- [ ] **Step 10: Run test, confirm it fails**

Run: `npm test -- "app/api/orders/admin/orders/\[id\]"`
Expected: FAIL with "Cannot find module '../route'".

- [ ] **Step 11: Create `app/api/orders/admin/orders/[id]/route.js`**

```js
import { NextResponse } from 'next/server';
import { authenticate, authErrorResponse, requireRole } from '../../../../../../lib/apiAuth';
import { getOrderAdminById } from '../../../../../../lib/adminOrders';

export async function GET(request, { params }) {
  try {
    const { user, supabase } = await authenticate(request);
    requireRole(user, ['admin', 'staff']);
    const { id } = await params;

    const { data, error } = await getOrderAdminById(supabase, id);
    if (error) {
      return NextResponse.json({ message: 'Không tải được đơn hàng.' }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ message: 'Không tìm thấy đơn hàng.' }, { status: 404 });
    }
    return NextResponse.json(data);
  } catch (error) {
    return authErrorResponse(error);
  }
}
```

- [ ] **Step 12: Run test, confirm it passes**

Run: `npm test -- "app/api/orders/admin/orders/\[id\]"`
Expected: PASS (2 tests).

- [ ] **Step 13: Run the full suite, then commit**

Run: `npm test`
Expected: PASS.

```bash
git add lib/adminOrders.js lib/__tests__/adminOrders.test.js app/api/orders/admin
git commit -m "feat: add admin order listing and detail"
```

---

### Task 5: SePay payment initiation

**Files:**
- Create: `lib/payments.js`
- Create: `lib/__tests__/payments.test.js`
- Create: `app/api/payments/payments/initiate/route.js`
- Create: `app/api/payments/payments/initiate/__tests__/route.test.js`
- Modify: `.env.example`

**Interfaces:**
- Consumes: `getOrderByCode` from `lib/orders.js` (Task 3).
- Produces: `buildSepayPayUrl({totalAmount, orderCode})` (pure function, returns the VietQR image
  URL string), `initiatePayment(supabase, {orderCode, provider})` → `{data:
  InitiatePaymentResponse|null, error: {status, message}|null}` in `lib/payments.js`.

- [ ] **Step 1: Write the failing test for `lib/payments.js`**

Create `lib/__tests__/payments.test.js`:

```js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const getOrderByCodeMock = vi.fn();

vi.mock('../orders', () => ({
  getOrderByCode: (...args) => getOrderByCodeMock(...args),
}));

import { buildSepayPayUrl, initiatePayment } from '../payments';

describe('buildSepayPayUrl', () => {
  const originalAcc = process.env.SEPAY_ACCOUNT_NUMBER;
  const originalBank = process.env.SEPAY_BANK_NAME;

  beforeEach(() => {
    process.env.SEPAY_ACCOUNT_NUMBER = '0123456789';
    process.env.SEPAY_BANK_NAME = 'MBBank';
  });

  afterEach(() => {
    process.env.SEPAY_ACCOUNT_NUMBER = originalAcc;
    process.env.SEPAY_BANK_NAME = originalBank;
  });

  it('dựng đúng URL VietQR', () => {
    const url = buildSepayPayUrl({ totalAmount: 178000, orderCode: 'SDL2345ABCD' });
    expect(url).toBe('https://qr.sepay.vn/img?acc=0123456789&bank=MBBank&amount=178000&des=SDL2345ABCD');
  });
});

describe('initiatePayment', () => {
  beforeEach(() => {
    getOrderByCodeMock.mockReset();
    process.env.SEPAY_ACCOUNT_NUMBER = '0123456789';
    process.env.SEPAY_BANK_NAME = 'MBBank';
    process.env.SEPAY_ACCOUNT_HOLDER = 'CONG TY SIMDULICH';
  });

  it('trả InitiatePaymentResponse khi order tồn tại và provider là sepay', async () => {
    getOrderByCodeMock.mockResolvedValue({ id: 1, orderCode: 'SDL2345ABCD', totalAmount: 178000 });

    const result = await initiatePayment({}, { orderCode: 'SDL2345ABCD', provider: 'sepay' });

    expect(result.error).toBeNull();
    expect(result.data).toEqual({
      orderId: 1, orderCode: 'SDL2345ABCD', provider: 'sepay', amount: 178000,
      payUrl: 'https://qr.sepay.vn/img?acc=0123456789&bank=MBBank&amount=178000&des=SDL2345ABCD',
      providerRef: 'SDL2345ABCD', bankName: 'MBBank', accountNumber: '0123456789', accountHolder: 'CONG TY SIMDULICH',
    });
  });

  it('trả error 404 khi không tìm thấy order', async () => {
    getOrderByCodeMock.mockResolvedValue(null);

    const result = await initiatePayment({}, { orderCode: 'KHONGTONTAI', provider: 'sepay' });

    expect(result.data).toBeNull();
    expect(result.error).toEqual({ status: 404, message: 'Không tìm thấy đơn hàng.' });
  });

  it('trả error 400 khi provider không phải sepay', async () => {
    getOrderByCodeMock.mockResolvedValue({ id: 1, orderCode: 'SDL2345ABCD', totalAmount: 178000 });

    const result = await initiatePayment({}, { orderCode: 'SDL2345ABCD', provider: 'momo' });

    expect(result.data).toBeNull();
    expect(result.error).toEqual({ status: 400, message: 'Cổng thanh toán chưa được hỗ trợ.' });
  });
});
```

- [ ] **Step 2: Run test, confirm it fails**

Run: `npm test -- lib/__tests__/payments.test.js`
Expected: FAIL with "Cannot find module '../payments'".

- [ ] **Step 3: Create `lib/payments.js`**

```js
import { getOrderByCode } from './orders';

export function buildSepayPayUrl({ totalAmount, orderCode }) {
  const acc = process.env.SEPAY_ACCOUNT_NUMBER;
  const bank = process.env.SEPAY_BANK_NAME;
  return `https://qr.sepay.vn/img?acc=${encodeURIComponent(acc)}&bank=${encodeURIComponent(bank)}&amount=${totalAmount}&des=${encodeURIComponent(orderCode)}`;
}

export async function initiatePayment(supabase, { orderCode, provider }) {
  const order = await getOrderByCode(supabase, orderCode);
  if (!order) {
    return { data: null, error: { status: 404, message: 'Không tìm thấy đơn hàng.' } };
  }
  if (provider !== 'sepay') {
    return { data: null, error: { status: 400, message: 'Cổng thanh toán chưa được hỗ trợ.' } };
  }

  return {
    data: {
      orderId: order.id,
      orderCode: order.orderCode,
      provider,
      amount: order.totalAmount,
      payUrl: buildSepayPayUrl({ totalAmount: order.totalAmount, orderCode: order.orderCode }),
      providerRef: order.orderCode,
      bankName: process.env.SEPAY_BANK_NAME,
      accountNumber: process.env.SEPAY_ACCOUNT_NUMBER,
      accountHolder: process.env.SEPAY_ACCOUNT_HOLDER,
    },
    error: null,
  };
}
```

- [ ] **Step 4: Run test, confirm it passes**

Run: `npm test -- lib/__tests__/payments.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Write the failing test for `POST /api/payments/payments/initiate`**

Create `app/api/payments/payments/initiate/__tests__/route.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';

const createApiClientMock = vi.fn();
const initiatePaymentMock = vi.fn();

vi.mock('../../../../../../lib/supabase/apiClient', () => ({
  createApiClient: (...args) => createApiClientMock(...args),
}));
vi.mock('../../../../../../lib/payments', () => ({
  initiatePayment: (...args) => initiatePaymentMock(...args),
}));

import { POST } from '../route';

function makeRequest(body) {
  return { json: () => Promise.resolve(body) };
}

describe('POST /api/payments/payments/initiate', () => {
  beforeEach(() => {
    createApiClientMock.mockReset();
    initiatePaymentMock.mockReset();
  });

  it('trả InitiatePaymentResponse khi thành công', async () => {
    createApiClientMock.mockReturnValue({});
    initiatePaymentMock.mockResolvedValue({ data: { orderCode: 'SDL2345ABCD', payUrl: 'https://...' }, error: null });

    const response = await POST(makeRequest({ orderCode: 'SDL2345ABCD', provider: 'sepay' }));
    const body = await response.json();

    expect(body.orderCode).toBe('SDL2345ABCD');
  });

  it('trả đúng status/message khi initiatePayment trả error', async () => {
    createApiClientMock.mockReturnValue({});
    initiatePaymentMock.mockResolvedValue({ data: null, error: { status: 404, message: 'Không tìm thấy đơn hàng.' } });

    const response = await POST(makeRequest({ orderCode: 'KHONGTONTAI', provider: 'sepay' }));
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toEqual({ message: 'Không tìm thấy đơn hàng.' });
  });
});
```

- [ ] **Step 6: Run test, confirm it fails**

Run: `npm test -- app/api/payments/payments/initiate`
Expected: FAIL with "Cannot find module '../route'".

- [ ] **Step 7: Create `app/api/payments/payments/initiate/route.js`**

```js
import { NextResponse } from 'next/server';
import { createApiClient } from '../../../../../lib/supabase/apiClient';
import { initiatePayment } from '../../../../../lib/payments';

export async function POST(request) {
  const supabase = createApiClient();
  if (!supabase) {
    return NextResponse.json({ message: 'Máy chủ chưa cấu hình Supabase.' }, { status: 500 });
  }

  const { orderCode, provider } = await request.json();
  const { data, error } = await initiatePayment(supabase, { orderCode, provider });
  if (error) {
    return NextResponse.json({ message: error.message }, { status: error.status });
  }
  return NextResponse.json(data);
}
```

- [ ] **Step 8: Run test, confirm it passes**

Run: `npm test -- app/api/payments/payments/initiate`
Expected: PASS (2 tests).

- [ ] **Step 9: Add the new environment variables to `.env.example`**

Add these lines to `.env.example` (keep existing lines unchanged):

```
SEPAY_ACCOUNT_NUMBER=
SEPAY_BANK_NAME=
SEPAY_ACCOUNT_HOLDER=
```

- [ ] **Step 10: Run the full suite, then commit**

Run: `npm test`
Expected: PASS.

```bash
git add lib/payments.js lib/__tests__/payments.test.js app/api/payments/payments/initiate .env.example
git commit -m "feat: add SePay payment initiation"
```

---

### Task 6: SePay webhook + dev-only webhook simulator

**Files:**
- Create: `lib/paymentsWebhook.js`
- Create: `lib/__tests__/paymentsWebhook.test.js`
- Create: `app/api/payments/payments/webhook/sepay/callback/route.js`
- Create: `app/api/payments/payments/webhook/sepay/callback/__tests__/route.test.js`
- Create: `app/api/payments/payments/webhook/[provider]/route.js`
- Create: `app/api/payments/payments/webhook/[provider]/__tests__/route.test.js`
- Modify: `.env.example`

**Interfaces:**
- Consumes: `createServiceClient` from `lib/supabase/serviceClient.js` (Task 2).
- Produces: `processSepayWebhook(serviceClient, payload)` → `{matched: boolean, reason?: string,
  duplicate?: boolean}`, `simulatePaymentWebhook(serviceClient, {orderId, amount, transactionRef})`
  → `{matched: boolean, reason?: string}` in `lib/paymentsWebhook.js`.

- [ ] **Step 1: Write the failing test for `lib/paymentsWebhook.js`**

Create `lib/__tests__/paymentsWebhook.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';

function createQueryBuilderMock(result) {
  const builder = {
    select: vi.fn(() => builder),
    insert: vi.fn(() => builder),
    update: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    maybeSingle: vi.fn(() => builder),
    then: (resolve) => resolve(result),
  };
  return builder;
}

const fromMock = vi.fn();
const serviceClientMock = { from: fromMock };

import { processSepayWebhook, simulatePaymentWebhook } from '../paymentsWebhook';

describe('processSepayWebhook', () => {
  beforeEach(() => {
    fromMock.mockReset();
  });

  it('bỏ qua giao dịch chuyển ra (transferType != in)', async () => {
    const result = await processSepayWebhook(serviceClientMock, { transferType: 'out', content: 'SDL2345ABCD', transferAmount: 178000, id: 1 });

    expect(result).toEqual({ matched: false, reason: 'not_incoming' });
    expect(fromMock).not.toHaveBeenCalled();
  });

  it('ghi api_logs khi không tìm thấy mã đơn trong content', async () => {
    const logQuery = createQueryBuilderMock({ data: null, error: null });
    fromMock.mockReturnValue(logQuery);

    const result = await processSepayWebhook(serviceClientMock, { transferType: 'in', content: 'chuyen tien khong ro noi dung', transferAmount: 178000, id: 1 });

    expect(result).toEqual({ matched: false, reason: 'no_order_code' });
    expect(fromMock).toHaveBeenCalledWith('api_logs');
  });

  it('khớp mã đơn + số tiền -> cập nhật paid và ghi transaction', async () => {
    const orderQuery = createQueryBuilderMock({ data: { id: 1, total_amount: 178000, payment_status: 'pending' }, error: null });
    const insertTxQuery = createQueryBuilderMock({ data: null, error: null });
    const updateOrderQuery = createQueryBuilderMock({ data: null, error: null });
    fromMock.mockImplementation((table) => {
      if (table === 'orders') return orderQuery.eq.mock.calls.length === 0 ? orderQuery : updateOrderQuery;
      if (table === 'payment_transactions') return insertTxQuery;
      throw new Error(`unexpected table ${table}`);
    });

    const result = await processSepayWebhook(serviceClientMock, { transferType: 'in', content: 'CK toi don SDL2345ABCD', transferAmount: 178000, id: 42 });

    expect(insertTxQuery.insert).toHaveBeenCalledWith(expect.objectContaining({ order_id: 1, transaction_ref: 'SEPAY-42', amount: 178000 }));
    expect(result).toEqual({ matched: true });
  });

  it('ghi api_logs khi số tiền không khớp, không cập nhật order', async () => {
    const orderQuery = createQueryBuilderMock({ data: { id: 1, total_amount: 178000, payment_status: 'pending' }, error: null });
    const logQuery = createQueryBuilderMock({ data: null, error: null });
    fromMock.mockImplementation((table) => (table === 'orders' ? orderQuery : logQuery));

    const result = await processSepayWebhook(serviceClientMock, { transferType: 'in', content: 'CK toi don SDL2345ABCD', transferAmount: 100000, id: 42 });

    expect(result).toEqual({ matched: false, reason: 'amount_mismatch' });
    expect(fromMock).toHaveBeenCalledWith('api_logs');
  });

  it('webhook gọi lại (transaction_ref trùng) -> trả duplicate, không update lại order', async () => {
    const orderQuery = createQueryBuilderMock({ data: { id: 1, total_amount: 178000, payment_status: 'paid' }, error: null });
    const insertTxQuery = createQueryBuilderMock({ data: null, error: { code: '23505' } });
    fromMock.mockImplementation((table) => (table === 'orders' ? orderQuery : insertTxQuery));

    const result = await processSepayWebhook(serviceClientMock, { transferType: 'in', content: 'CK toi don SDL2345ABCD', transferAmount: 178000, id: 42 });

    expect(result).toEqual({ matched: true, duplicate: true });
  });
});

describe('simulatePaymentWebhook', () => {
  beforeEach(() => {
    fromMock.mockReset();
  });

  it('đánh dấu order paid và ghi transaction', async () => {
    const orderQuery = createQueryBuilderMock({ data: { id: 1, payment_status: 'pending' }, error: null });
    const insertTxQuery = createQueryBuilderMock({ data: null, error: null });
    const updateOrderQuery = createQueryBuilderMock({ data: null, error: null });
    fromMock.mockImplementation((table) => {
      if (table === 'orders') return orderQuery.eq.mock.calls.length === 0 ? orderQuery : updateOrderQuery;
      return insertTxQuery;
    });

    const result = await simulatePaymentWebhook(serviceClientMock, { orderId: 1, amount: 178000, transactionRef: 'SIM-1' });

    expect(result).toEqual({ matched: true });
  });

  it('trả matched false khi không tìm thấy order', async () => {
    fromMock.mockReturnValue(createQueryBuilderMock({ data: null, error: null }));

    const result = await simulatePaymentWebhook(serviceClientMock, { orderId: 999, amount: 178000, transactionRef: 'SIM-1' });

    expect(result).toEqual({ matched: false, reason: 'order_not_found' });
  });
});
```

- [ ] **Step 2: Run test, confirm it fails**

Run: `npm test -- paymentsWebhook.test.js`
Expected: FAIL with "Cannot find module '../paymentsWebhook'".

- [ ] **Step 3: Create `lib/paymentsWebhook.js`**

```js
const ORDER_CODE_RE = /SDL[A-Z0-9]{8}/i;

async function logUnmatched(serviceClient, payload, orderId, message) {
  await serviceClient.from('api_logs').insert({
    order_id: orderId,
    api_type: 'SEPAY_WEBHOOK_UNMATCHED',
    endpoint: '/api/payments/payments/webhook/sepay/callback',
    request_body: JSON.stringify(payload),
    response_body: message,
    http_status: 200,
  });
}

export async function processSepayWebhook(serviceClient, payload) {
  const { transferType, content, transferAmount, id } = payload;

  if (transferType !== 'in') {
    return { matched: false, reason: 'not_incoming' };
  }

  const match = ORDER_CODE_RE.exec(content || '');
  if (!match) {
    await logUnmatched(serviceClient, payload, null, 'Không tìm thấy mã đơn trong nội dung chuyển khoản.');
    return { matched: false, reason: 'no_order_code' };
  }
  const orderCode = match[0].toUpperCase();

  const { data: order } = await serviceClient
    .from('orders')
    .select('id, total_amount, payment_status')
    .eq('order_code', orderCode)
    .maybeSingle();
  if (!order) {
    await logUnmatched(serviceClient, payload, null, `Không tìm thấy đơn hàng với mã ${orderCode}.`);
    return { matched: false, reason: 'order_not_found' };
  }

  if (Number(order.total_amount) !== Number(transferAmount)) {
    await logUnmatched(serviceClient, payload, order.id, `Số tiền không khớp: đơn ${order.total_amount}, chuyển khoản ${transferAmount}.`);
    return { matched: false, reason: 'amount_mismatch' };
  }

  const transactionRef = `SEPAY-${id}`;
  const { error: insertError } = await serviceClient
    .from('payment_transactions')
    .insert({ order_id: order.id, transaction_ref: transactionRef, amount: transferAmount, raw_response: JSON.stringify(payload) });

  if (insertError && insertError.code === '23505') {
    return { matched: true, duplicate: true };
  }
  if (insertError) {
    console.error('[sepayWebhook] failed to record transaction', insertError);
    return { matched: false, reason: 'transaction_insert_failed' };
  }

  if (order.payment_status !== 'paid') {
    const { error: updateError } = await serviceClient
      .from('orders')
      .update({ payment_status: 'paid' })
      .eq('id', order.id)
      .eq('payment_status', 'pending');
    if (updateError) {
      console.error('[sepayWebhook] failed to update order status', updateError);
    }
  }

  return { matched: true };
}

export async function simulatePaymentWebhook(serviceClient, { orderId, amount, transactionRef }) {
  const { data: order } = await serviceClient
    .from('orders')
    .select('id, payment_status')
    .eq('id', orderId)
    .maybeSingle();
  if (!order) {
    return { matched: false, reason: 'order_not_found' };
  }

  const { error: insertError } = await serviceClient
    .from('payment_transactions')
    .insert({ order_id: order.id, transaction_ref: transactionRef, amount, raw_response: JSON.stringify({ simulated: true }) });

  if (insertError && insertError.code === '23505') {
    return { matched: true, duplicate: true };
  }
  if (insertError) {
    return { matched: false, reason: 'transaction_insert_failed' };
  }

  if (order.payment_status !== 'paid') {
    await serviceClient.from('orders').update({ payment_status: 'paid' }).eq('id', order.id).eq('payment_status', 'pending');
  }

  return { matched: true };
}
```

- [ ] **Step 4: Run test, confirm it passes**

Run: `npm test -- paymentsWebhook.test.js`
Expected: PASS (7 tests).

- [ ] **Step 5: Write the failing test for `POST /api/payments/payments/webhook/sepay/callback`**

Create `app/api/payments/payments/webhook/sepay/callback/__tests__/route.test.js`:

```js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const createServiceClientMock = vi.fn();
const processSepayWebhookMock = vi.fn();

vi.mock('../../../../../../../lib/supabase/serviceClient', () => ({
  createServiceClient: (...args) => createServiceClientMock(...args),
}));
vi.mock('../../../../../../../lib/paymentsWebhook', () => ({
  processSepayWebhook: (...args) => processSepayWebhookMock(...args),
}));

import { POST } from '../route';

function makeRequest(body, apiKeyHeader) {
  return {
    headers: { get: (key) => (key.toLowerCase() === 'authorization' ? apiKeyHeader ?? null : null) },
    json: () => Promise.resolve(body),
  };
}

describe('POST /api/payments/payments/webhook/sepay/callback', () => {
  const originalKey = process.env.SEPAY_API_KEY;

  beforeEach(() => {
    createServiceClientMock.mockReset();
    processSepayWebhookMock.mockReset();
    process.env.SEPAY_API_KEY = 'real-key';
  });

  afterEach(() => {
    process.env.SEPAY_API_KEY = originalKey;
  });

  it('trả 401 khi thiếu hoặc sai API key', async () => {
    const response = await POST(makeRequest({ transferType: 'in' }, 'Apikey wrong-key'));

    expect(response.status).toBe(401);
    expect(processSepayWebhookMock).not.toHaveBeenCalled();
  });

  it('trả 200 {received:true} khi API key đúng, bất kể khớp hay không', async () => {
    createServiceClientMock.mockReturnValue({});
    processSepayWebhookMock.mockResolvedValue({ matched: false, reason: 'amount_mismatch' });

    const response = await POST(makeRequest({ transferType: 'in', content: 'SDL2345ABCD', transferAmount: 1, id: 1 }, 'Apikey real-key'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ received: true });
  });

  it('trả 500 khi service client không tạo được (thiếu env)', async () => {
    createServiceClientMock.mockReturnValue(null);

    const response = await POST(makeRequest({ transferType: 'in' }, 'Apikey real-key'));

    expect(response.status).toBe(500);
  });
});
```

- [ ] **Step 6: Run test, confirm it fails**

Run: `npm test -- webhook/sepay`
Expected: FAIL with "Cannot find module '../route'".

- [ ] **Step 7: Create `app/api/payments/payments/webhook/sepay/callback/route.js`**

```js
import { NextResponse } from 'next/server';
import { createServiceClient } from '../../../../../../lib/supabase/serviceClient';
import { processSepayWebhook } from '../../../../../../lib/paymentsWebhook';

export async function POST(request) {
  const authHeader = request.headers.get('authorization') || '';
  const expectedKey = process.env.SEPAY_API_KEY;
  if (!expectedKey || authHeader !== `Apikey ${expectedKey}`) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  const serviceClient = createServiceClient();
  if (!serviceClient) {
    return NextResponse.json({ message: 'Máy chủ chưa cấu hình Supabase.' }, { status: 500 });
  }

  const payload = await request.json();
  await processSepayWebhook(serviceClient, payload);
  return NextResponse.json({ received: true });
}
```

- [ ] **Step 8: Run test, confirm it passes**

Run: `npm test -- webhook/sepay`
Expected: PASS (3 tests).

- [ ] **Step 9: Write the failing test for `POST /api/payments/payments/webhook/[provider]`**

Create `app/api/payments/payments/webhook/[provider]/__tests__/route.test.js`:

```js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const createServiceClientMock = vi.fn();
const simulatePaymentWebhookMock = vi.fn();

vi.mock('../../../../../../lib/supabase/serviceClient', () => ({
  createServiceClient: (...args) => createServiceClientMock(...args),
}));
vi.mock('../../../../../../lib/paymentsWebhook', () => ({
  simulatePaymentWebhook: (...args) => simulatePaymentWebhookMock(...args),
}));

import { POST } from '../route';

function makeRequest(body) {
  return { json: () => Promise.resolve(body) };
}

describe('POST /api/payments/payments/webhook/[provider] (dev simulator)', () => {
  const originalEnv = process.env.NODE_ENV;

  beforeEach(() => {
    createServiceClientMock.mockReset();
    simulatePaymentWebhookMock.mockReset();
  });

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  it('trả 404 khi NODE_ENV=production', async () => {
    process.env.NODE_ENV = 'production';

    const response = await POST(makeRequest({ orderId: 1, amount: 1, transactionRef: 'x' }), { params: Promise.resolve({ provider: 'sepay' }) });

    expect(response.status).toBe(404);
    expect(createServiceClientMock).not.toHaveBeenCalled();
  });

  it('trả processed=true khi không phải production và khớp order', async () => {
    process.env.NODE_ENV = 'test';
    createServiceClientMock.mockReturnValue({});
    simulatePaymentWebhookMock.mockResolvedValue({ matched: true });

    const response = await POST(makeRequest({ orderId: 1, amount: 178000, transactionRef: 'SIM-1' }), { params: Promise.resolve({ provider: 'sepay' }) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ processed: true, duplicate: false });
  });
});
```

- [ ] **Step 10: Run test, confirm it fails**

Run: `npm test -- "webhook/\[provider\]"`
Expected: FAIL with "Cannot find module '../route'".

- [ ] **Step 11: Create `app/api/payments/payments/webhook/[provider]/route.js`**

```js
import { NextResponse } from 'next/server';
import { createServiceClient } from '../../../../../../lib/supabase/serviceClient';
import { simulatePaymentWebhook } from '../../../../../../lib/paymentsWebhook';

export async function POST(request) {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ message: 'Không tìm thấy.' }, { status: 404 });
  }

  const serviceClient = createServiceClient();
  if (!serviceClient) {
    return NextResponse.json({ message: 'Máy chủ chưa cấu hình Supabase.' }, { status: 500 });
  }

  const { orderId, amount, transactionRef } = await request.json();
  const result = await simulatePaymentWebhook(serviceClient, { orderId, amount, transactionRef });
  return NextResponse.json({ processed: result.matched, duplicate: !!result.duplicate });
}
```

- [ ] **Step 12: Run test, confirm it passes**

Run: `npm test -- "webhook/\[provider\]"`
Expected: PASS (2 tests).

- [ ] **Step 13: Add the new environment variable to `.env.example`**

Add this line to `.env.example` (keep existing lines unchanged):

```
SEPAY_API_KEY=
```

- [ ] **Step 14: Run the full suite, then commit**

Run: `npm test`
Expected: PASS.

```bash
git add lib/paymentsWebhook.js lib/__tests__/paymentsWebhook.test.js app/api/payments/payments/webhook .env.example
git commit -m "feat: add SePay webhook and dev-only webhook simulator"
```

---

### Task 7: Admin payment listing, log listing, manual payment confirmation

**Files:**
- Create: `lib/adminPayments.js`
- Create: `lib/__tests__/adminPayments.test.js`
- Create: `app/api/payments/admin/payments/route.js`
- Create: `app/api/payments/admin/payments/__tests__/route.test.js`
- Create: `app/api/payments/admin/api-logs/route.js`
- Create: `app/api/payments/admin/api-logs/__tests__/route.test.js`
- Create: `app/api/payments/admin/payments/confirm/route.js`
- Create: `app/api/payments/admin/payments/confirm/__tests__/route.test.js`

**Interfaces:**
- Consumes: `mapOrderSummary` from `lib/adminOrders.js` (Task 4); `authenticate`,
  `authErrorResponse`, `requireRole` from `lib/apiAuth.js`.
- Produces: `listPaymentsAdmin(supabase, {page, size, orderId})`, `listApiLogsAdmin(supabase,
  {page, size, orderId})`, `confirmPaymentAdmin(supabase, orderCode)` → `{data:
  OrderSummaryResponse|null, error}` in `lib/adminPayments.js`.

- [ ] **Step 1: Write the failing test for `lib/adminPayments.js`**

Create `lib/__tests__/adminPayments.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';

function createQueryBuilderMock(result) {
  const builder = {
    select: vi.fn(() => builder),
    update: vi.fn(() => builder),
    insert: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    order: vi.fn(() => builder),
    range: vi.fn(() => builder),
    maybeSingle: vi.fn(() => builder),
    then: (resolve) => resolve(result),
  };
  return builder;
}

const fromMock = vi.fn();
const supabaseMock = { from: fromMock };

import { listPaymentsAdmin, listApiLogsAdmin, confirmPaymentAdmin } from '../adminPayments';

describe('lib/adminPayments', () => {
  beforeEach(() => {
    fromMock.mockReset();
  });

  describe('listPaymentsAdmin', () => {
    it('lọc theo orderId khi có', async () => {
      const query = createQueryBuilderMock({ data: [], count: 0, error: null });
      fromMock.mockReturnValue(query);

      await listPaymentsAdmin(supabaseMock, { orderId: 5 });

      expect(query.eq).toHaveBeenCalledWith('order_id', 5);
    });

    it('không lọc gì khi orderId không có', async () => {
      const query = createQueryBuilderMock({ data: [], count: 0, error: null });
      fromMock.mockReturnValue(query);

      await listPaymentsAdmin(supabaseMock, {});

      expect(query.eq).not.toHaveBeenCalled();
    });
  });

  describe('listApiLogsAdmin', () => {
    it('lọc theo orderId khi có', async () => {
      const query = createQueryBuilderMock({ data: [], count: 0, error: null });
      fromMock.mockReturnValue(query);

      await listApiLogsAdmin(supabaseMock, { orderId: 5 });

      expect(query.eq).toHaveBeenCalledWith('order_id', 5);
    });
  });

  describe('confirmPaymentAdmin', () => {
    it('đánh dấu paid và ghi transaction khi đơn đang pending', async () => {
      const orderQuery = createQueryBuilderMock({
        data: { id: 1, order_code: 'SDL2345ABCD', user_id: null, cust_name: 'A', cust_email: 'a@x.vn', total_amount: 178000, payment_method: 'sepay', payment_status: 'pending', shipping_method: 'email', shipping_status: 'none', carrier_name: null, tracking_code: null, created_at: '2026-09-10T00:00:00Z' },
        error: null,
      });
      const updateQuery = createQueryBuilderMock({ data: null, error: null });
      const insertQuery = createQueryBuilderMock({ data: null, error: null });
      let orderCallCount = 0;
      fromMock.mockImplementation((table) => {
        if (table === 'orders') { orderCallCount += 1; return orderCallCount === 1 ? orderQuery : updateQuery; }
        return insertQuery;
      });

      const result = await confirmPaymentAdmin(supabaseMock, 'SDL2345ABCD');

      expect(updateQuery.update).toHaveBeenCalledWith({ payment_status: 'paid' });
      expect(insertQuery.insert).toHaveBeenCalledWith(expect.objectContaining({ order_id: 1, amount: 178000 }));
      expect(result.data.paymentStatus).toBe('paid');
    });

    it('không tạo transaction trùng khi đơn đã paid sẵn', async () => {
      const orderQuery = createQueryBuilderMock({
        data: { id: 1, order_code: 'SDL2345ABCD', user_id: null, cust_name: 'A', cust_email: 'a@x.vn', total_amount: 178000, payment_method: 'sepay', payment_status: 'paid', shipping_method: 'email', shipping_status: 'none', carrier_name: null, tracking_code: null, created_at: '2026-09-10T00:00:00Z' },
        error: null,
      });
      fromMock.mockReturnValue(orderQuery);

      const result = await confirmPaymentAdmin(supabaseMock, 'SDL2345ABCD');

      expect(fromMock).toHaveBeenCalledTimes(1);
      expect(result.data.paymentStatus).toBe('paid');
    });

    it('trả data null khi không tìm thấy orderCode', async () => {
      fromMock.mockReturnValue(createQueryBuilderMock({ data: null, error: null }));

      const result = await confirmPaymentAdmin(supabaseMock, 'KHONGTONTAI');

      expect(result).toEqual({ data: null, error: null });
    });
  });
});
```

- [ ] **Step 2: Run test, confirm it fails**

Run: `npm test -- adminPayments.test.js`
Expected: FAIL with "Cannot find module '../adminPayments'".

- [ ] **Step 3: Create `lib/adminPayments.js`**

```js
import { mapOrderSummary } from './adminOrders';

function mapPayment(row) {
  return {
    id: row.id,
    orderId: row.order_id,
    transactionRef: row.transaction_ref,
    amount: Number(row.amount),
    rawResponse: row.raw_response,
    createdAt: row.created_at,
  };
}

function mapApiLog(row) {
  return {
    id: row.id,
    orderId: row.order_id,
    apiType: row.api_type,
    endpoint: row.endpoint,
    requestBody: row.request_body,
    responseBody: row.response_body,
    httpStatus: row.http_status,
    createdAt: row.created_at,
  };
}

function paginationBounds(page, size) {
  const safePage = Number.isFinite(page) && page >= 0 ? Math.trunc(page) : 0;
  const safeSize = Number.isFinite(size) && size > 0 ? Math.trunc(size) : 20;
  const from = safePage * safeSize;
  const to = from + safeSize - 1;
  return { safePage, safeSize, from, to };
}

export async function listPaymentsAdmin(supabase, { page, size, orderId } = {}) {
  const { safePage, safeSize, from, to } = paginationBounds(page, size);
  let query = supabase.from('payment_transactions').select('*', { count: 'exact' });
  if (orderId != null) {
    query = query.eq('order_id', orderId);
  }
  query = query.order('created_at', { ascending: false }).range(from, to);

  const { data, count, error } = await query;
  if (error) return { data: null, error };
  const totalElements = count || 0;
  return {
    data: { content: (data || []).map(mapPayment), number: safePage, size: safeSize, totalElements, totalPages: Math.ceil(totalElements / safeSize) },
    error: null,
  };
}

export async function listApiLogsAdmin(supabase, { page, size, orderId } = {}) {
  const { safePage, safeSize, from, to } = paginationBounds(page, size);
  let query = supabase.from('api_logs').select('*', { count: 'exact' });
  if (orderId != null) {
    query = query.eq('order_id', orderId);
  }
  query = query.order('created_at', { ascending: false }).range(from, to);

  const { data, count, error } = await query;
  if (error) return { data: null, error };
  const totalElements = count || 0;
  return {
    data: { content: (data || []).map(mapApiLog), number: safePage, size: safeSize, totalElements, totalPages: Math.ceil(totalElements / safeSize) },
    error: null,
  };
}

export async function confirmPaymentAdmin(supabase, orderCode) {
  const { data: order, error } = await supabase
    .from('orders')
    .select('*')
    .eq('order_code', orderCode)
    .maybeSingle();
  if (error) return { data: null, error };
  if (!order) return { data: null, error: null };

  if (order.payment_status !== 'paid') {
    const { error: updateError } = await supabase
      .from('orders')
      .update({ payment_status: 'paid' })
      .eq('id', order.id);
    if (updateError) return { data: null, error: updateError };

    await supabase.from('payment_transactions').insert({
      order_id: order.id,
      transaction_ref: `MANUAL-${Date.now()}`,
      amount: order.total_amount,
      raw_response: 'Xác nhận thủ công bởi admin.',
    });
    order.payment_status = 'paid';
  }

  return { data: mapOrderSummary(order), error: null };
}
```

- [ ] **Step 4: Run test, confirm it passes**

Run: `npm test -- adminPayments.test.js`
Expected: PASS (6 tests).

- [ ] **Step 5: Write the failing test for `GET /api/payments/admin/payments`**

Create `app/api/payments/admin/payments/__tests__/route.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';

const authenticateMock = vi.fn();
const listPaymentsAdminMock = vi.fn();

vi.mock('../../../../../../lib/apiAuth', async () => {
  const actual = await vi.importActual('../../../../../../lib/apiAuth');
  return { ...actual, authenticate: (...args) => authenticateMock(...args) };
});
vi.mock('../../../../../../lib/adminPayments', () => ({
  listPaymentsAdmin: (...args) => listPaymentsAdminMock(...args),
}));

import { GET } from '../route';

function makeRequest(url) {
  return { url, headers: { get: () => 'Bearer good-token' } };
}

describe('GET /api/payments/admin/payments', () => {
  beforeEach(() => {
    authenticateMock.mockReset();
    listPaymentsAdminMock.mockReset();
  });

  it('đọc page/size/orderId từ query string', async () => {
    authenticateMock.mockResolvedValue({ user: { role: 'admin' }, supabase: {} });
    listPaymentsAdminMock.mockResolvedValue({ data: { content: [], number: 0, size: 20, totalElements: 0, totalPages: 0 }, error: null });

    await GET(makeRequest('http://localhost:3000/api/payments/admin/payments?orderId=5&page=0&size=20'));

    expect(listPaymentsAdminMock).toHaveBeenCalledWith({}, { page: 0, size: 20, orderId: '5' });
  });
});
```

- [ ] **Step 6: Run test, confirm it fails**

Run: `npm test -- app/api/payments/admin/payments/__tests__/route.test.js`
Expected: FAIL with "Cannot find module '../route'".

- [ ] **Step 7: Create `app/api/payments/admin/payments/route.js`**

```js
import { NextResponse } from 'next/server';
import { authenticate, authErrorResponse, requireRole } from '../../../../../lib/apiAuth';
import { listPaymentsAdmin } from '../../../../../lib/adminPayments';

export async function GET(request) {
  try {
    const { user, supabase } = await authenticate(request);
    requireRole(user, ['admin', 'staff']);

    const { searchParams } = new URL(request.url);
    const { data, error } = await listPaymentsAdmin(supabase, {
      page: searchParams.get('page') != null ? Number(searchParams.get('page')) : undefined,
      size: searchParams.get('size') != null ? Number(searchParams.get('size')) : undefined,
      orderId: searchParams.get('orderId') || undefined,
    });
    if (error) {
      return NextResponse.json({ message: 'Không tải được danh sách giao dịch.' }, { status: 500 });
    }
    return NextResponse.json(data);
  } catch (error) {
    return authErrorResponse(error);
  }
}
```

- [ ] **Step 8: Run test, confirm it passes**

Run: `npm test -- app/api/payments/admin/payments/__tests__/route.test.js`
Expected: PASS (1 test).

- [ ] **Step 9: Write the failing test for `GET /api/payments/admin/api-logs`**

Create `app/api/payments/admin/api-logs/__tests__/route.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';

const authenticateMock = vi.fn();
const listApiLogsAdminMock = vi.fn();

vi.mock('../../../../../../lib/apiAuth', async () => {
  const actual = await vi.importActual('../../../../../../lib/apiAuth');
  return { ...actual, authenticate: (...args) => authenticateMock(...args) };
});
vi.mock('../../../../../../lib/adminPayments', () => ({
  listApiLogsAdmin: (...args) => listApiLogsAdminMock(...args),
}));

import { GET } from '../route';

function makeRequest(url) {
  return { url, headers: { get: () => 'Bearer good-token' } };
}

describe('GET /api/payments/admin/api-logs', () => {
  beforeEach(() => {
    authenticateMock.mockReset();
    listApiLogsAdminMock.mockReset();
  });

  it('đọc orderId từ query string', async () => {
    authenticateMock.mockResolvedValue({ user: { role: 'staff' }, supabase: {} });
    listApiLogsAdminMock.mockResolvedValue({ data: { content: [], number: 0, size: 20, totalElements: 0, totalPages: 0 }, error: null });

    await GET(makeRequest('http://localhost:3000/api/payments/admin/api-logs?orderId=5'));

    expect(listApiLogsAdminMock).toHaveBeenCalledWith({}, { page: undefined, size: undefined, orderId: '5' });
  });
});
```

- [ ] **Step 10: Run test, confirm it fails**

Run: `npm test -- app/api/payments/admin/api-logs`
Expected: FAIL with "Cannot find module '../route'".

- [ ] **Step 11: Create `app/api/payments/admin/api-logs/route.js`**

```js
import { NextResponse } from 'next/server';
import { authenticate, authErrorResponse, requireRole } from '../../../../../lib/apiAuth';
import { listApiLogsAdmin } from '../../../../../lib/adminPayments';

export async function GET(request) {
  try {
    const { user, supabase } = await authenticate(request);
    requireRole(user, ['admin', 'staff']);

    const { searchParams } = new URL(request.url);
    const { data, error } = await listApiLogsAdmin(supabase, {
      page: searchParams.get('page') != null ? Number(searchParams.get('page')) : undefined,
      size: searchParams.get('size') != null ? Number(searchParams.get('size')) : undefined,
      orderId: searchParams.get('orderId') || undefined,
    });
    if (error) {
      return NextResponse.json({ message: 'Không tải được nhật ký API.' }, { status: 500 });
    }
    return NextResponse.json(data);
  } catch (error) {
    return authErrorResponse(error);
  }
}
```

- [ ] **Step 12: Run test, confirm it passes**

Run: `npm test -- app/api/payments/admin/api-logs`
Expected: PASS (1 test).

- [ ] **Step 13: Write the failing test for `POST /api/payments/admin/payments/confirm`**

Create `app/api/payments/admin/payments/confirm/__tests__/route.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';

const authenticateMock = vi.fn();
const confirmPaymentAdminMock = vi.fn();

vi.mock('../../../../../../../lib/apiAuth', async () => {
  const actual = await vi.importActual('../../../../../../../lib/apiAuth');
  return { ...actual, authenticate: (...args) => authenticateMock(...args) };
});
vi.mock('../../../../../../../lib/adminPayments', () => ({
  confirmPaymentAdmin: (...args) => confirmPaymentAdminMock(...args),
}));

import { POST } from '../route';

function makeRequest(body) {
  return { headers: { get: () => 'Bearer good-token' }, json: () => Promise.resolve(body) };
}

describe('POST /api/payments/admin/payments/confirm', () => {
  beforeEach(() => {
    authenticateMock.mockReset();
    confirmPaymentAdminMock.mockReset();
  });

  it('xác nhận thanh toán thành công', async () => {
    authenticateMock.mockResolvedValue({ user: { role: 'admin' }, supabase: {} });
    confirmPaymentAdminMock.mockResolvedValue({ data: { orderCode: 'SDL2345ABCD', paymentStatus: 'paid' }, error: null });

    const response = await POST(makeRequest({ orderCode: 'SDL2345ABCD' }));
    const body = await response.json();

    expect(body.paymentStatus).toBe('paid');
  });

  it('trả 404 khi không tìm thấy orderCode', async () => {
    authenticateMock.mockResolvedValue({ user: { role: 'admin' }, supabase: {} });
    confirmPaymentAdminMock.mockResolvedValue({ data: null, error: null });

    const response = await POST(makeRequest({ orderCode: 'KHONGTONTAI' }));

    expect(response.status).toBe(404);
  });

  it('trả 403 khi caller không phải admin/staff', async () => {
    authenticateMock.mockResolvedValue({ user: { role: 'customer' }, supabase: {} });

    const response = await POST(makeRequest({ orderCode: 'SDL2345ABCD' }));

    expect(response.status).toBe(403);
    expect(confirmPaymentAdminMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 14: Run test, confirm it fails**

Run: `npm test -- payments/confirm`
Expected: FAIL with "Cannot find module '../route'".

- [ ] **Step 15: Create `app/api/payments/admin/payments/confirm/route.js`**

```js
import { NextResponse } from 'next/server';
import { authenticate, authErrorResponse, requireRole } from '../../../../../../lib/apiAuth';
import { confirmPaymentAdmin } from '../../../../../../lib/adminPayments';

export async function POST(request) {
  try {
    const { user, supabase } = await authenticate(request);
    requireRole(user, ['admin', 'staff']);

    const { orderCode } = await request.json();
    const { data, error } = await confirmPaymentAdmin(supabase, orderCode);
    if (error) {
      return NextResponse.json({ message: 'Không xác nhận được thanh toán.' }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ message: 'Không tìm thấy đơn hàng.' }, { status: 404 });
    }
    return NextResponse.json(data);
  } catch (error) {
    return authErrorResponse(error);
  }
}
```

- [ ] **Step 16: Run test, confirm it passes**

Run: `npm test -- payments/confirm`
Expected: PASS (3 tests).

- [ ] **Step 17: Run the full suite, then commit**

Run: `npm test`
Expected: PASS — every suite in the repo green.

```bash
git add lib/adminPayments.js lib/__tests__/adminPayments.test.js app/api/payments/admin
git commit -m "feat: add admin payment/log listing and manual payment confirmation"
```

---

### Task 8: Manual verification against the old Vite frontend

**Files:** none (verification only).

**Interfaces:**
- Consumes: the running `simDulichNew` dev server and `Simdulich`'s checkout/payment/admin pages.
- Produces: nothing.

- [ ] **Step 1: Apply the new migrations to the real Supabase project**

In the Supabase Dashboard SQL Editor, run `supabase/migrations/0007_orders_payments.sql`, then run
`supabase/migrations/0008_create_order_rpc.sql` (added during final review to fix a Critical bug —
`orders`/`order_items` grant INSERT-only to anon/authenticated, so `createOrder`'s
`.insert().select()` cannot work without this RPC; see `lib/orders.js`'s `createOrder`, which calls
`create_order` via `supabase.rpc(...)`). If `POST /api/orders/orders` 404s on the RPC after applying
0008, PostgREST's schema cache may need a nudge — run `notify pgrst, 'reload schema';` in the SQL
Editor and retry.

- [ ] **Step 2: Set the new environment variables**

In `simDulichNew`'s `.env.local`, add real values for `SUPABASE_SERVICE_ROLE_KEY` (from Supabase
project settings → API → `service_role` secret), `SEPAY_ACCOUNT_NUMBER`, `SEPAY_BANK_NAME`,
`SEPAY_ACCOUNT_HOLDER` (real or placeholder bank details — only used to render the QR image URL),
`SEPAY_API_KEY` (any secret string — no real SePay account is required to test the dev-mock
webhook flow in this step).

- [ ] **Step 3: Start both dev servers**

```bash
npm run dev
```

(and, in the `Simdulich` directory, `npm run dev` for the frontend.)

- [ ] **Step 4: Verify the checkout → payment flow**

1. Add a product to cart on the storefront, go to checkout, fill in customer info, submit.
2. Confirm you land on the payment page with a QR code image and bank details rendered.
3. Click "🧪 Giả lập đã thanh toán (dev)" (only visible in the frontend's dev build) — confirm the
   page detects `paymentStatus === 'paid'` within ~3 seconds (the poll interval) and navigates to
   the success page.

- [ ] **Step 5: Verify admin order/payment views**

Logged in as an admin/staff account:
1. Go to the Orders admin page — confirm the order just created appears with the right customer
   name/total/status, and clicking it shows the order detail with the correct `productName` on
   each line item.
2. Go to the Payments admin page — confirm the transaction from Step 4 appears with the right
   amount and gateway label.
3. Create a second order without paying it. On its detail page, click "Xác nhận thanh toán" — confirm
   it flips to `paid` immediately and a `MANUAL-...` transaction appears in its payment history.

- [ ] **Step 6: Report results**

Summarize pass/fail for each of Steps 4–5 back to the user. Fix any failing step by reading the
relevant route/lib file and re-running its automated test before re-verifying manually.

---

## Self-Review

**Spec coverage:**
- Order creation with server-computed total, physical/email shipping validation, `productName`
  snapshot fix — Task 3. ✓
- Public order lookup via `get_order_by_code` RPC — Task 3. ✓
- Admin order list (0-indexed `number`) + detail — Task 4. ✓
- SePay `initiate` (local VietQR URL construction) — Task 5. ✓
- SePay webhook (API-key auth, order-code regex, amount reconciliation, idempotent via
  `transaction_ref` unique constraint, always-200, unmatched → `api_logs`) — Task 6. ✓
- Dev-only webhook simulator, gated by `NODE_ENV` — Task 6. ✓
- Admin manual payment confirmation (`productName` fix's sibling gaps: `confirm` endpoint,
  `orderId` filter) — Task 7. ✓
- Schema + RLS + RPC — Task 1. ✓
- Manual verification — Task 8. ✓

**Placeholder scan:** No TBD/TODO markers; every step has runnable code or an exact command with
expected output.

**Type consistency:** `lib/orders.js`'s `createOrder`/`getOrderByCode`/`OrderError` (Task 3) are
consumed identically by Task 3's own routes and by Task 5's `initiatePayment` (which imports
`getOrderByCode` directly). `lib/adminOrders.js`'s `mapOrderSummary` (Task 4) is exported
specifically so Task 7's `confirmPaymentAdmin` can reuse it without duplicating the row-mapping
logic — both produce the exact same `OrderSummaryResponse` shape. `lib/supabase/serviceClient.js`'s
`createServiceClient()` (Task 2) is consumed identically by both of Task 6's routes. Every route's
error path returns `{message}` + status, matching the global constraint, across all 7 code tasks.
