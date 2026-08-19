import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import adminRouter from "./admin";
import groupsRouter from "./groups";
import { adminCategoriesRouter, categoriesRouter } from "./categories";
import videosRouter from "./videos";
import { reviewsRouter, videoReviewsRouter } from "./reviews";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/auth", authRouter);
router.use("/admin", adminRouter);
router.use("/admin/categories", adminCategoriesRouter);
router.use("/categories", categoriesRouter);
router.use("/groups", groupsRouter);
router.use("/videos", videosRouter);
router.use("/videos", videoReviewsRouter);
router.use("/reviews", reviewsRouter);

export default router;
