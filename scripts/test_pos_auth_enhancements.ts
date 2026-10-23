import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import express from "express";
import cors from "cors";
import { prisma } from "../src/utils/db";
import routes from "../src/pos/routes";
import { signAccessToken } from "../src/utils/jwt";

async function run() {
  console.log("=== STARTING POS AUTH ENHANCEMENTS TEST ===");
  const key = randomUUID().slice(0, 8);

  const store = await prisma.store.create({
    data: { name: `AUTH TEST STORE ${key}`, code: `ATS_${key}`, isActive: true },
  });

  const admin = await prisma.user.create({
    data: { email: `admin-${key}@auth.test`, password: "dummy", role: "ADMIN" },
  });
  await prisma.employee.create({
    data: {
      userId: admin.id,
      storeId: store.id,
      firstName: "Auth",
      lastName: "Admin",
      employeeCode: `EMP_${key}`,
      status: "ACTIVE",
    },
  });

  const token = signAccessToken({ id: admin.id, role: admin.role });

  const app = express();
  app.use(
    cors({
      origin: (_origin, callback) => callback(null, true),
      credentials: true,
    })
  );
  // Cookie parsing middleware matching index.ts
  app.use((req, _res, next) => {
    if (!(req as any).cookies && req.headers.cookie) {
      const list: Record<string, string> = {};
      req.headers.cookie.split(";").forEach((cookie) => {
        const parts = cookie.split("=");
        const k = parts.shift()?.trim();
        if (k) {
          const val = parts.join("=").trim();
          try {
            list[k] = decodeURIComponent(val);
          } catch {
            list[k] = val;
          }
        }
      });
      (req as any).cookies = list;
    } else if (!(req as any).cookies) {
      (req as any).cookies = {};
    }
    next();
  });
  app.use(express.json());
  app.use("/api/v1/pos", routes);

  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const port = (server.address() as { port: number }).port;
  const baseUrl = `http://127.0.0.1:${port}/api/v1/pos`;

  const makeSalePayload = () => ({
    storeId: store.id,
    customerName: "Walk-in Guest",
    customerPhone: "9876543210",
    idempotencyKey: randomUUID(),
    orderDiscount: "0.00",
    items: [
      {
        manual: true,
        name: "Manual Product",
        barcode: `TEST-BC-${randomUUID().slice(0, 6)}`,
        quantity: 1,
        unitPrice: "100.00",
        discountPerUnit: "0.00",
        taxRate: "5.00",
      },
    ],
    payments: [
      {
        method: "CASH",
        amount: "105.00",
      },
    ],
  });

  try {
    // 1. Unauthenticated request -> must return 401 with "Sign in required"
    console.log("1. Testing unauthenticated POST /sales...");
    const resNoAuth = await fetch(`${baseUrl}/sales`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(makeSalePayload()),
    });
    assert.equal(resNoAuth.status, 401);
    const bodyNoAuth = await resNoAuth.json();
    assert.equal(bodyNoAuth.success, false);
    assert.equal(bodyNoAuth.message, "Sign in required");
    console.log("   ✓ Unauthenticated request rejected with 'Sign in required'");

    // 2. Invalid/expired token -> must return 401 with "Invalid or expired signed session"
    console.log("2. Testing invalid token POST /sales...");
    const resInvalid = await fetch(`${baseUrl}/sales`, {
      method: "POST",
      headers: {
        Authorization: "Bearer invalid.token.payload",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(makeSalePayload()),
    });
    assert.equal(resInvalid.status, 401);
    const bodyInvalid = await resInvalid.json();
    assert.equal(bodyInvalid.message, "Invalid or expired signed session");
    console.log("   ✓ Invalid token rejected with 'Invalid or expired signed session'");

    // 3. Standard Authorization: Bearer <token>
    console.log("3. Testing standard Authorization: Bearer <token>...");
    const resBearer = await fetch(`${baseUrl}/sales`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(makeSalePayload()),
    });
    assert.equal(resBearer.status, 200);
    const bodyBearer = await resBearer.json();
    assert.equal(bodyBearer.success, true);
    assert(bodyBearer.data?.invoiceNo);
    console.log(`   ✓ Sale created successfully: ${bodyBearer.data.invoiceNo}`);

    // 4. Lowercase Authorization: bearer <token>
    console.log("4. Testing lowercase Authorization: bearer <token>...");
    const resLowerBearer = await fetch(`${baseUrl}/sales`, {
      method: "POST",
      headers: {
        Authorization: `bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(makeSalePayload()),
    });
    assert.equal(resLowerBearer.status, 200);
    const bodyLower = await resLowerBearer.json();
    assert.equal(bodyLower.success, true);
    console.log(`   ✓ Sale created with lowercase bearer prefix: ${bodyLower.data.invoiceNo}`);

    // 5. Authorization with multiple spaces: Bearer   <token>
    console.log("5. Testing Authorization: Bearer   <token> (multiple spaces)...");
    const resSpaces = await fetch(`${baseUrl}/sales`, {
      method: "POST",
      headers: {
        Authorization: `Bearer   ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(makeSalePayload()),
    });
    assert.equal(resSpaces.status, 200);
    const bodySpaces = await resSpaces.json();
    assert.equal(bodySpaces.success, true);
    console.log(`   ✓ Sale created with irregular whitespace: ${bodySpaces.data.invoiceNo}`);

    // 6. Header x-access-token
    console.log("6. Testing x-access-token header...");
    const resXToken = await fetch(`${baseUrl}/sales`, {
      method: "POST",
      headers: {
        "x-access-token": token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(makeSalePayload()),
    });
    assert.equal(resXToken.status, 200);
    const bodyXToken = await resXToken.json();
    assert.equal(bodyXToken.success, true);
    console.log(`   ✓ Sale created via x-access-token header: ${bodyXToken.data.invoiceNo}`);

    // 7. Cookie pos_store_token
    console.log("7. Testing Cookie: pos_store_token=...");
    const resCookiePos = await fetch(`${baseUrl}/sales`, {
      method: "POST",
      headers: {
        Cookie: `pos_store_token=${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(makeSalePayload()),
    });
    assert.equal(resCookiePos.status, 200);
    const bodyCookiePos = await resCookiePos.json();
    assert.equal(bodyCookiePos.success, true);
    console.log(`   ✓ Sale created via pos_store_token cookie: ${bodyCookiePos.data.invoiceNo}`);

    // 8. Cookie super_hrm_token
    console.log("8. Testing Cookie: super_hrm_token=...");
    const resCookieSuper = await fetch(`${baseUrl}/sales`, {
      method: "POST",
      headers: {
        Cookie: `super_hrm_token=${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(makeSalePayload()),
    });
    assert.equal(resCookieSuper.status, 200);
    const bodyCookieSuper = await resCookieSuper.json();
    assert.equal(bodyCookieSuper.success, true);
    console.log(`   ✓ Sale created via super_hrm_token cookie: ${bodyCookieSuper.data.invoiceNo}`);

    // 9. Cookie token (standard HRM session cookie)
    console.log("9. Testing Cookie: token=...");
    const resCookieToken = await fetch(`${baseUrl}/sales`, {
      method: "POST",
      headers: {
        Cookie: `token=${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(makeSalePayload()),
    });
    assert.equal(resCookieToken.status, 200);
    const bodyCookieToken = await resCookieToken.json();
    assert.equal(bodyCookieToken.success, true);
    console.log(`   ✓ Sale created via standard token cookie: ${bodyCookieToken.data.invoiceNo}`);

    console.log("\n=== ALL POS AUTH ENHANCEMENT TESTS PASSED! ===");
  } finally {
    server.close();
    await prisma.$disconnect();
  }
}

run().catch((e) => {
  console.error("Test failed:", e);
  process.exit(1);
});
