import { PaymentMethod } from '../../types/sbms';

export const EXPENSE_CATEGORIES = [
  'كهرباء',
  'مياه',
  'ترحيل ومواصلات',
  'وقود وغاز',
  'صيانة',
  'إيجار',
  'رواتب وأجور',
  'مصروفات تشغيلية أخرى',
] as const;

export const PAYMENT_METHODS: PaymentMethod[] = ['نقداً', 'تحويل بنكي (بنكك)', 'شيك'];
