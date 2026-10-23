import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import express from "express";
import { prisma } from "../src/utils/db";
import posRoutes from "../src/pos/routes";
import adminRoutes from "../src/routes/adminRoutes";
import { signAccessToken } from "../src/utils/jwt";

async function run() {
  console.log("=== RUNNING POS STORE AUTH VERIFICATION ===");
  const key = randomUUID().slice(0, 8);

  // 1. Create two test stores
  const storeA = await prisma.store.create({
    data: { name: `Store Alpha ${key}`, code: `STA_${key}`, isActive: true },
  });
  const storeB = await prisma.store.create({
    data: { name: `Store Beta ${key}`, code: `STB_${key}`, isActive: true },
  });

  // 2. Create Super Admin user
  const superAdmin = await prisma.user.create({
    data: { email: `superadmin-${key}@pos.test`, password: "dummy", role: "SUPER_ADMIN" },
  });
  const adminToken = signAccessToken({ id: superAdmin.id, role: superAdmin.role });

  // Setup Express server with lightweight cookie parser and routes
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => {
    req.cookies = {};
    if (req.headers.cookie) {
      for (const pair of req.headers.cookie.split(";")) {
        const [k, v] = pair.split("=").map((s: string) => s.trim());
        if (k && v) req.cookies[k] = decodeURIComponent(v);
      }
    }
    next();
  });
  app.use("/api/admin", adminRoutes);
  app.use("/api/v1/pos", posRoutes);

  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const port = (server.address() as { port: number }).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  async function api(path: string, options: { method?: string; body?: unknown; token?: string; cookie?: string } = {}) {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (options.token) headers["Authorization"] = `Bearer ${options.token}`;
    if (options.cookie) headers["Cookie"] = options.cookie;

    const res = await fetch(`${baseUrl}${path}`, {
      method: options.method || (options.body ? "POST" : "GET"),
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    const setCookie = res.headers.get("set-cookie") || "";
    let data;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    return { status: res.status, data, setCookie };
  }

  try {
    // TEST 1: Super Admin sets POS password for Store A
    console.log("Checking TEST 1: Super Admin sets POS credentials for Store A...");
    const setCreds = await api(`/api/admin/stores/${storeA.id}/pos-credentials`, {
      method: "POST",
      token: adminToken,
      body: { password: "StorePassword123!", posEnabled: true },
    });
    assert.equal(setCreds.status, 200);
    assert.equal(setCreds.data.success, true);
    assert.equal(setCreds.data.data.posEnabled, true);
    console.log("PASS: POS credentials successfully configured for Store A");

    // TEST 2: Super Admin fetches stores and verifies POS status without exposing password
    console.log("Checking TEST 2: fetchStores returns POS configuration status without password...");
    const storesList = await api(`/api/admin/stores`, { token: adminToken });
    assert.equal(storesList.status, 200);
    const foundStoreA = storesList.data.data.find((s: any) => s.id === storeA.id);
    assert(foundStoreA, "Store A should be present in stores list");
    assert.equal(foundStoreA.posCredential?.posEnabled, true);
    assert.equal(foundStoreA.posCredential?.passwordHash, undefined, "passwordHash must never be exposed");
    console.log("PASS: Store list includes POS configuration metadata without password hashes");

    // TEST 3: Public endpoint /api/v1/pos/auth/stores returns active stores with POS enabled
    console.log("Checking TEST 3: Public /api/v1/pos/auth/stores returns configured active stores...");
    const publicStores = await api(`/api/v1/pos/auth/stores`);
    assert.equal(publicStores.status, 200);
    const pubA = publicStores.data.data.find((s: any) => s.id === storeA.id);
    const pubB = publicStores.data.data.find((s: any) => s.id === storeB.id);
    assert(pubA, "Store A has POS configured so it must appear in public POS stores");
    assert(!pubB, "Store B does NOT have POS configured so it must NOT appear in public POS stores");
    console.log("PASS: Public POS stores endpoint correctly filters only POS-configured stores");

    // TEST 4: POS login with wrong password
    console.log("Checking TEST 4: POS login rejects incorrect password...");
    const wrongLogin = await api(`/api/v1/pos/auth/login`, {
      body: { storeId: storeA.id, password: "WrongPassword!" },
    });
    assert.equal(wrongLogin.status, 401);
    console.log("PASS: Rejected invalid store password with 401");

    // TEST 5: POS login with correct password
    console.log("Checking TEST 5: POS login with correct password by store code...");
    const validLogin = await api(`/api/v1/pos/auth/login`, {
      body: { storeCode: storeA.code, password: "StorePassword123!" },
    });
    assert.equal(validLogin.status, 200);
    assert.equal(validLogin.data.success, true);
    assert(validLogin.data.token, "Must return signed POS session token");
    assert.equal(validLogin.data.store.id, storeA.id);
    assert(validLogin.setCookie.includes("pos_store_token"), "Must set pos_store_token cookie");
    const posToken = validLogin.data.token;
    console.log("PASS: POS login successful and returned store-scoped session");

    // TEST 6: /api/v1/pos/auth/me with POS token
    console.log("Checking TEST 6: Verify /api/v1/pos/auth/me with POS token...");
    const meRes = await api(`/api/v1/pos/auth/me`, { token: posToken });
    assert.equal(meRes.status, 200);
    assert.equal(meRes.data.data.store.id, storeA.id);
    assert.equal(meRes.data.data.isPosStoreSession, true);
    console.log("PASS: /auth/me returns authenticated store session context");

    // TEST 7: Store isolation enforcement — prevent cross-store access
    console.log("Checking TEST 7: Store isolation enforcement (Store A session accessing Store B)...");
    const crossStoreLookup = await api(
      `/api/v1/pos/products/lookup?storeId=${storeB.id}&code=ANY_CODE`,
      { token: posToken }
    );
    assert.equal(crossStoreLookup.status, 403, "Must reject cross-store access attempts");
    console.log("PASS: Cross-store access strictly forbidden for store-scoped sessions");

    // TEST 8: Super Admin disables POS access for Store A
    console.log("Checking TEST 8: Super Admin disables POS access for Store A...");
    const disableRes = await api(`/api/admin/stores/${storeA.id}/pos-access`, {
      method: "PATCH",
      token: adminToken,
      body: { posEnabled: false },
    });
    assert.equal(disableRes.status, 200);
    assert.equal(disableRes.data.data.posEnabled, false);

    // Try login again — must be rejected with 403
    const disabledLogin = await api(`/api/v1/pos/auth/login`, {
      body: { storeId: storeA.id, password: "StorePassword123!" },
    });
    assert.equal(disabledLogin.status, 403);

    // Existing session requests should also be rejected
    const disabledMe = await api(`/api/v1/pos/auth/me`, { token: posToken });
    assert.equal(disabledMe.status, 403);
    console.log("PASS: Disabling POS access immediately blocks login and revokes active sessions");

    // TEST 9: POS logout
    console.log("Checking TEST 9: POS logout...");
    const logoutRes = await api(`/api/v1/pos/auth/logout`, { method: "POST" });
    assert.equal(logoutRes.status, 200);
    assert.equal(logoutRes.data.success, true);
    console.log("PASS: POS logout cleared session");

    console.log("\nALL POS STORE AUTH CHECKS PASSED SUCCESSFULLY!");
  } finally {
    // Cleanup
    await prisma.pOSStoreCredential.deleteMany({
      where: { storeId: { in: [storeA.id, storeB.id] } },
    });
    await prisma.activityLog.deleteMany({
      where: { entityId: { in: [String(storeA.id), String(storeB.id)] } },
    });
    await prisma.user.deleteMany({
      where: {
        OR: [
          { id: superAdmin.id },
          { email: `pos-store-${storeA.id}@hopkid.local` },
          { email: `pos-store-${storeB.id}@hopkid.local` },
        ],
      },
    });
    await prisma.store.deleteMany({
      where: { id: { in: [storeA.id, storeB.id] } },
    });

    await new Promise<void>((r) => server.close(() => r()));
    await prisma.$disconnect();
  }
}

run().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
