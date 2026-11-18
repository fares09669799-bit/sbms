import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.ts';
import workspaceBootstrapRoute from './operations/workspaceBootstrapRoute.ts';
import recipesRoutes from './operations/recipesRoutes.ts';
import productionSalesRoutes from './operations/productionSalesRoutes.ts';
import shiftsRoutes from './operations/shiftsRoutes.ts';
import adminOperationsRoutes from './operations/adminOperationsRoutes.ts';

const router = Router();
router.use(requireAuth);

router.use(workspaceBootstrapRoute);
router.use(recipesRoutes);
router.use(productionSalesRoutes);
router.use(shiftsRoutes);
router.use(adminOperationsRoutes);

export default router;
