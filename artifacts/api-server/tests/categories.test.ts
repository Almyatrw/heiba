import { beforeEach, describe, expect, it } from "vitest";
import {
  api,
  authAs,
  createUser,
  loginUser,
  resetDatabase,
} from "./helpers";

beforeEach(async () => {
  await resetDatabase();
});

async function loginAs(role: "OWNER" | "ADMIN" | "GROUP_MANAGER" | "MEMBER") {
  const { user, password } = await createUser({ role });
  const { token } = await loginUser(user.email, password);
  return { user, token };
}

describe("categories", () => {
  it("OWNER/ADMIN manage categories; members can only list", async () => {
    const owner = await loginAs("OWNER");
    const member = await loginAs("MEMBER");
    const manager = await loginAs("GROUP_MANAGER");

    const created = await api()
      .post("/api/admin/categories")
      .set(authAs(owner.token))
      .send({ name: "Training", description: "Training videos" });
    expect(created.status).toBe(201);
    expect(created.body.name).toBe("Training");
    const id = created.body.id;

    for (const { token } of [member, manager]) {
      expect(
        (
          await api()
            .post("/api/admin/categories")
            .set(authAs(token))
            .send({ name: "Nope" })
        ).status,
      ).toBe(403);
      expect(
        (await api().delete(`/api/admin/categories/${id}`).set(authAs(token)))
          .status,
      ).toBe(403);
    }

    // Every authenticated user can list
    const list = await api().get("/api/categories").set(authAs(member.token));
    expect(list.status).toBe(200);
    expect(list.body.categories.map((c: { name: string }) => c.name)).toEqual([
      "Training",
    ]);

    const updated = await api()
      .patch(`/api/admin/categories/${id}`)
      .set(authAs(owner.token))
      .send({ description: "Updated" });
    expect(updated.status).toBe(200);
    expect(updated.body.description).toBe("Updated");

    const dup = await api()
      .post("/api/admin/categories")
      .set(authAs(owner.token))
      .send({ name: "Training" });
    expect(dup.status).toBe(409);

    const del = await api()
      .delete(`/api/admin/categories/${id}`)
      .set(authAs(owner.token));
    expect(del.status).toBe(204);

    const after = await api()
      .patch(`/api/admin/categories/${id}`)
      .set(authAs(owner.token))
      .send({ name: "Gone" });
    expect(after.status).toBe(404);
  });

  it("rejects invalid bodies and unknown ids", async () => {
    const owner = await loginAs("OWNER");
    const bad = await api()
      .post("/api/admin/categories")
      .set(authAs(owner.token))
      .send({ name: "" });
    expect(bad.status).toBe(400);
    const missing = await api()
      .delete("/api/admin/categories/4242")
      .set(authAs(owner.token));
    expect(missing.status).toBe(404);
  });
});
