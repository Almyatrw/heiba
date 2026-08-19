import { Router, type IRouter, type Request, type Response } from "express";
import { asc, eq } from "drizzle-orm";
import { categoriesTable, db, type Category } from "@workspace/db";
import {
  CreateCategoryBody,
  CreateCategoryResponse,
  DeleteCategoryParams,
  ListCategoriesResponse,
  UpdateCategoryBody,
  UpdateCategoryParams,
  UpdateCategoryResponse,
} from "@workspace/api-zod";
import { conflict, notFound } from "../lib/errors";
import { toCategory } from "../lib/serializers";
import { requireAuth, requireRole } from "../middlewares/auth";

export const categoriesRouter: IRouter = Router();
export const adminCategoriesRouter: IRouter = Router();

async function getCategoryOr404(id: number): Promise<Category> {
  const [category] = await db
    .select()
    .from(categoriesTable)
    .where(eq(categoriesTable.id, id))
    .limit(1);
  if (!category) throw notFound("Category not found");
  return category;
}

async function assertNameAvailable(name: string, excludeId?: number) {
  const rows = await db
    .select({ id: categoriesTable.id })
    .from(categoriesTable)
    .where(eq(categoriesTable.name, name))
    .limit(1);
  if (rows[0] && rows[0].id !== excludeId) {
    throw conflict("A category with this name already exists");
  }
}

categoriesRouter.get("/", requireAuth, async (_req: Request, res: Response) => {
  const rows = await db
    .select()
    .from(categoriesTable)
    .orderBy(asc(categoriesTable.name));
  res.json(
    ListCategoriesResponse.parse({ categories: rows.map(toCategory) }),
  );
});

adminCategoriesRouter.post(
  "/",
  requireAuth,
  requireRole("OWNER", "ADMIN"),
  async (req: Request, res: Response) => {
    const body = CreateCategoryBody.parse(req.body);
    await assertNameAvailable(body.name);
    const [category] = await db
      .insert(categoriesTable)
      .values({ name: body.name, description: body.description ?? null })
      .returning();
    res.status(201).json(CreateCategoryResponse.parse(toCategory(category)));
  },
);

adminCategoriesRouter.patch(
  "/:id",
  requireAuth,
  requireRole("OWNER", "ADMIN"),
  async (req: Request, res: Response) => {
    const { id } = UpdateCategoryParams.parse(req.params);
    const body = UpdateCategoryBody.parse(req.body);
    await getCategoryOr404(id);
    if (body.name !== undefined) await assertNameAvailable(body.name, id);

    const [category] = await db
      .update(categoriesTable)
      .set({
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.description !== undefined
          ? { description: body.description }
          : {}),
        updated_at: new Date(),
      })
      .where(eq(categoriesTable.id, id))
      .returning();
    res.json(UpdateCategoryResponse.parse(toCategory(category)));
  },
);

adminCategoriesRouter.delete(
  "/:id",
  requireAuth,
  requireRole("OWNER", "ADMIN"),
  async (req: Request, res: Response) => {
    const { id } = DeleteCategoryParams.parse(req.params);
    await getCategoryOr404(id);
    await db.delete(categoriesTable).where(eq(categoriesTable.id, id));
    res.status(204).end();
  },
);
