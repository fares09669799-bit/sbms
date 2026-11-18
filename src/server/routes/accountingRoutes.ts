import { Router } from 'express';
import { requireAuth, requireRole } from '../../middleware/auth.ts';
import cashExpensesRoutes from './accounting/cashExpensesRoutes.ts';
import customersRoutes from './accounting/customersRoutes.ts';
import employeesRoutes from './accounting/employeesRoutes.ts';
import reportsRoutes from './accounting/reportsRoutes.ts';

const router = Router();
router.use(requireAuth, requireRole('OWNER'));

router.use(cashExpensesRoutes);
router.use(customersRoutes);
router.use(employeesRoutes);
router.use(reportsRoutes);

export default router;
