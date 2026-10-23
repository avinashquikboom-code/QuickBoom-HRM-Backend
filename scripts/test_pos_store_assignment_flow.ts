import { prisma } from "../src/utils/db";
import { signToken } from "../src/utils/jwt";
import express from "express";
import http from "http";
import adminRoutes from "../src/routes/adminRoutes";
import posRouter from "../src/pos/routes";

async function main() {
  console.log("=================================================");
  console.log("STARTING POS STORE ASSIGNMENT E2E VERIFICATION");
  console.log("=================================================");

  const app = express();
  app.use(express.json());
  app.use("/api/admin", adminRoutes);
  app.use("/api/v1/pos", posRouter);

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as any).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 1. Setup Test Stores
    let activeStore = await prisma.store.findFirst({ where: { isActive: true } });
    if (!activeStore) {
      activeStore = await prisma.store.create({
        data: { name: "Active Store Alpha", code: "ACT_STR_A", isActive: true },
      });
    }

    let inactiveStore = await prisma.store.findFirst({ where: { isActive: false } });
    if (!inactiveStore) {
      inactiveStore = await prisma.store.create({
        data: { name: "Inactive Store Omega", code: "INACT_STR_Z", isActive: false },
      });
    }

    let secondStore = await prisma.store.findFirst({
      where: { isActive: true, id: { not: activeStore.id } },
    });
    if (!secondStore) {
      secondStore = await prisma.store.create({
        data: { name: "Active Store Beta", code: "ACT_STR_B", isActive: true },
      });
    }

    // 2. Setup Test Admin User
    let adminUser = await prisma.user.findFirst({
      where: { role: "ADMIN", isActive: true },
    });
    if (!adminUser) {
      adminUser = await prisma.user.create({
        data: {
          email: "test.admin.flow@hopkid.test",
          password: "hashedpassword123",
          role: "ADMIN",
          isActive: true,
        },
      });
    }
    const adminToken = signToken({ id: adminUser.id, role: adminUser.role });

    // 3. Setup Test Employee User (start with storeId = null)
    let employeeUser = await prisma.user.findFirst({
      where: { email: "test.salesperson.flow@hopkid.test" },
      include: { employee: true },
    });

    if (!employeeUser) {
      employeeUser = await prisma.user.create({
        data: {
          email: "test.salesperson.flow@hopkid.test",
          password: "hashedpassword123",
          role: "EMPLOYEE",
          isActive: true,
          employee: {
            create: {
              employeeCode: "FLOW_EMP_01",
              firstName: "Rajesh",
              lastName: "Kumar",
              status: "active",
              storeId: null,
            },
          },
        },
        include: { employee: true },
      });
    } else {
      // Reset storeId to null for fresh test run
      if (employeeUser.employee) {
        await prisma.employee.update({
          where: { id: employeeUser.employee.id },
          data: { storeId: null },
        });
      }
    }

    const employeeToken = signToken({ id: employeeUser.id, role: employeeUser.role });
    const empId = employeeUser.employee!.id;

    console.log(`\nActive Store: ID ${activeStore.id} (${activeStore.name})`);
    console.log(`Inactive Store: ID ${inactiveStore.id} (${inactiveStore.name})`);
    console.log(`Second Store: ID ${secondStore.id} (${secondStore.name})`);
    console.log(`Test Employee: ID ${empId} (${employeeUser.email})`);

    // STEP 1: Unassigned employee calls POS /context -> must return 422
    console.log("\n[TEST 1] Employee with storeId = null opens POS (/api/v1/pos/context)");
    const res1 = await fetch(`${baseUrl}/api/v1/pos/context`, {
      headers: { Authorization: `Bearer ${employeeToken}` },
    });
    const body1 = await res1.json() as any;
    console.log(`Status: ${res1.status}, Message: ${body1?.message || body1?.error}`);
    if (res1.status !== 422 || !body1.message?.includes("No store location is assigned")) {
      throw new Error(`Expected 422 unassigned error, got ${res1.status}: ${JSON.stringify(body1)}`);
    }
    console.log("PASS: Received actionable 422 error prompt with retry guidance.");

    // STEP 2: Admin attempts to assign INACTIVE store -> must return 400 validation error
    console.log("\n[TEST 2] Admin attempts to assign INACTIVE store via PUT /api/admin/employees/:id");
    const res2 = await fetch(`${baseUrl}/api/admin/employees/${empId}`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${adminToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ storeId: inactiveStore.id }),
    });
    const body2 = await res2.json() as any;
    console.log(`Status: ${res2.status}, Message: ${body2?.message}`);
    if (res2.status !== 400 || !body2.message?.includes("inactive or does not exist")) {
      throw new Error(`Expected 400 validation error for inactive store, got ${res2.status}: ${JSON.stringify(body2)}`);
    }
    console.log("PASS: Inactive store correctly rejected with 400 error.");

    // STEP 3: Admin assigns ACTIVE store via PUT /api/admin/employees/:id -> must succeed (200)
    console.log("\n[TEST 3] Admin assigns ACTIVE store via PUT /api/admin/employees/:id");
    const res3 = await fetch(`${baseUrl}/api/admin/employees/${empId}`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${adminToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ storeId: activeStore.id }),
    });
    const body3 = await res3.json() as any;
    console.log(`Status: ${res3.status}, Message: ${body3?.message}`);
    if (res3.status !== 200) {
      throw new Error(`Failed to assign store: ${res3.status} ${JSON.stringify(body3)}`);
    }

    // Verify in DB directly
    const updatedEmpInDb = await prisma.employee.findUnique({
      where: { id: empId },
      select: { id: true, storeId: true },
    });
    if (updatedEmpInDb?.storeId !== activeStore.id) {
      throw new Error(`DB storeId mismatch: expected ${activeStore.id}, found ${updatedEmpInDb?.storeId}`);
    }
    console.log(`PASS: Store ${activeStore.id} assigned and saved in DB successfully.`);

    // STEP 4: Employee opens POS (/api/v1/pos/context) -> must return 200 with active store
    console.log("\n[TEST 4] Employee opens POS (/api/v1/pos/context) after store assignment");
    const res4 = await fetch(`${baseUrl}/api/v1/pos/context`, {
      headers: { Authorization: `Bearer ${employeeToken}` },
    });
    const body4 = await res4.json() as any;
    console.log(`Status: ${res4.status}`);
    if (res4.status !== 200) {
      throw new Error(`Expected 200, got ${res4.status}: ${JSON.stringify(body4)}`);
    }
    const data4 = body4.data;
    console.log("Returned activeStore:", data4.activeStore?.name, "ID:", data4.activeStore?.id);
    console.log("Returned stores count:", data4.stores?.length);
    console.log("Returned salesperson:", data4.salesperson?.name);

    if (data4.activeStore?.id !== activeStore.id) {
      throw new Error(`Expected activeStore ${activeStore.id}, got ${data4.activeStore?.id}`);
    }
    if (!data4.stores.some((s: any) => s.id === activeStore!.id)) {
      throw new Error("Assigned store missing from stores list");
    }
    console.log("PASS: POS context loaded with active store and salesperson profile.");

    // STEP 5: Employee attempts to scope to unauthorized second store -> 403 Forbidden
    console.log(`\n[TEST 5] Employee attempts to access unauthorized Store Beta (?storeId=${secondStore.id})`);
    const res5 = await fetch(`${baseUrl}/api/v1/pos/context?storeId=${secondStore.id}`, {
      headers: { Authorization: `Bearer ${employeeToken}` },
    });
    const body5 = await res5.json() as any;
    console.log(`Status: ${res5.status}, Error: ${body5?.error || body5?.message}`);
    if (res5.status !== 403) {
      throw new Error(`Expected 403 Forbidden, got ${res5.status}`);
    }
    console.log("PASS: Branch isolation enforced (403 Forbidden).");

    // STEP 6: Admin accesses POS -> has multi-store access
    console.log("\n[TEST 6] Admin accesses POS with multi-store access");
    const res6 = await fetch(`${baseUrl}/api/v1/pos/context`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const body6 = await res6.json() as any;
    console.log(`Status: ${res6.status}, Stores count: ${body6.data?.stores?.length}`);
    if (res6.status !== 200 || (body6.data?.stores?.length ?? 0) < 2) {
      throw new Error(`Admin should see all active stores, got ${body6.data?.stores?.length}`);
    }
    console.log("PASS: Admin legitimately sees all active stores for store selection.");

    // STEP 7: Admin unassigns store (storeId = null) -> Employee again gets 422 (no bypass/hardcoding)
    console.log("\n[TEST 7] Admin unassigns store (storeId = null)");
    const res7 = await fetch(`${baseUrl}/api/admin/employees/${empId}`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${adminToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ storeId: null }),
    });
    console.log(`Status: ${res7.status}`);

    const res7Context = await fetch(`${baseUrl}/api/v1/pos/context`, {
      headers: { Authorization: `Bearer ${employeeToken}` },
    });
    const body7Context = await res7Context.json() as any;
    console.log(`Status: ${res7Context.status}, Message: ${body7Context?.message}`);
    if (res7Context.status !== 422) {
      throw new Error(`Expected 422 when store is unassigned, got ${res7Context.status}`);
    }
    console.log("PASS: Unassigning store correctly restores actionable 422 configuration state.");

    console.log("\n=================================================");
    console.log("ALL 7 END-TO-END FLOW TESTS PASSED SUCCESSFULLY!");
    console.log("=================================================");
  } finally {
    server.close();
  }
}

main()
  .then(() => {
    prisma.$disconnect().then(() => process.exit(0));
  })
  .catch((e) => {
    console.error("TEST FAILED:", e);
    prisma.$disconnect().then(() => process.exit(1));
  });
