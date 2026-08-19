import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import adminRouter from "./admin";
import groupsRouter from "./groups";
import { adminCategoriesRouter, categoriesRouter } from "./categories";
import videosRouter from "./videos";
import { reviewsRouter, videoReviewsRouter } from "./reviews";
import libraryRouter from "./library";
import streamRouter from "./stream";

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
router.use("/library", libraryRouter);
router.use("/stream", streamRouter);

export default router;
