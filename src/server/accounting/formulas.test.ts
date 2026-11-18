import { describe, expect, it } from 'vitest';
import {
  calculateCustomerBalance,
  calculateGrossProfit,
  calculateIngredientRowsCost,
  calculateLegacyProductionCost,
  calculateNetProfit,
  calculateRunningLedgerBalance,
  calculateSupplierBalance,
  calculateWeightedAverageCost,
  round2,
  round3,
} from './formulas.ts';

describe('Accounting Pure Formulas (Baseline & Edge Cases)', () => {
  describe('round2 & round3', () => {
    it('rounds standard decimals and floating-point sums to 2 decimal places', () => {
      expect(round2(0.1 + 0.2)).toBe(0.3);
      expect(round2(12.345)).toBe(12.35);
      expect(round2(-150.556)).toBe(-150.56);
      expect(round3(1.2346)).toBe(1.235);
    });

    it('handles zero, NaN, and Infinity safely', () => {
      expect(round2(0)).toBe(0);
      expect(round2(Number.NaN)).toBe(0);
      expect(round2(Number.POSITIVE_INFINITY)).toBe(0);
      expect(round3(Number.NEGATIVE_INFINITY)).toBe(0);
    });
  });

  describe('Customer & Supplier Balance Formulas', () => {
    it('computes customer outstanding balance with decimal fractions and adjustments', () => {
      expect(calculateCustomerBalance(1500.75, 400.25, -50.1)).toBe(1050.4);
      expect(calculateCustomerBalance(0, 0, 0)).toBe(0);
    });

    it('supports large bakery credit volumes accurately', () => {
      expect(calculateCustomerBalance(250_000_000.45, 125_000_000.15, 50_000.2)).toBe(
        125_050_000.5
      );
      expect(calculateSupplierBalance(980_000_000.8, 480_000_000.3, -100_000.5)).toBe(
        499_900_000
      );
    });

    it('restores exact balance after entry reversal (payment reversal & expense/ledger reversal)', () => {
      const initialBalance = calculateCustomerBalance(5000, 1200, 0);
      expect(initialBalance).toBe(3800);

      // Payment recorded (+800 paid), then reversed (-800 paid)
      const afterPayment = calculateCustomerBalance(5000, 1200 + 800, 0);
      expect(afterPayment).toBe(3000);

      const afterReversal = calculateCustomerBalance(5000, 1200 + 800 - 800, 0);
      expect(afterReversal).toBe(initialBalance);

      // Running ledger balance across debit -> credit -> reversal debit
      let running = 0;
      running = calculateRunningLedgerBalance(running, 5000, 0);
      running = calculateRunningLedgerBalance(running, 0, 800);
      running = calculateRunningLedgerBalance(running, 800, 0);
      expect(running).toBe(5000);
    });
  });

  describe('Weighted Average Cost (Inventory Valuation)', () => {
    it('computes weighted average across existing stock and incoming purchase', () => {
      const result = calculateWeightedAverageCost({
        previousQty: 10,
        previousAverageCost: 60000,
        addedQty: 15,
        lineTotal: 975000,
        fallbackUnitPrice: 65000,
      });
      expect(result.nextQuantity).toBe(25);
      expect(result.nextAverageCost).toBe(63000);
    });

    it('handles fractional stock quantities and decimals cleanly', () => {
      const result = calculateWeightedAverageCost({
        previousQty: 2.5,
        previousAverageCost: 100.33,
        addedQty: 1.25,
        lineTotal: 150.75,
        fallbackUnitPrice: 120.6,
      });
      expect(result.nextQuantity).toBe(3.75);
      expect(result.nextAverageCost).toBe(107.09);
    });

    it('falls back to unit price when resulting quantity is zero', () => {
      const result = calculateWeightedAverageCost({
        previousQty: 0,
        previousAverageCost: 0,
        addedQty: 0,
        lineTotal: 0,
        fallbackUnitPrice: 4500.5,
      });
      expect(result.nextQuantity).toBe(0);
      expect(result.nextAverageCost).toBe(4500.5);
    });
  });

  describe('COGS & Net Profit', () => {
    it('calculates COGS from production ingredient rows', () => {
      const cogs = calculateIngredientRowsCost([
        { quantityUsed: 8.5, averageCost: 64500 },
        { quantityUsed: 3.25, averageCost: 6500.5 },
        { quantityUsed: 400, averageCost: 30 },
      ]);
      expect(cogs).toBe(581376.63);
    });

    it('calculates legacy production COGS converting salt and sugar grams to kilograms', () => {
      const cogs = calculateLegacyProductionCost({
        flourConsumedBags: 8,
        flourUnitCost: 64500,
        oilConsumedLiters: 4,
        oilUnitCost: 6500,
        yeastConsumedGrams: 500,
        yeastUnitCost: 30,
        saltConsumedGrams: 1500,
        saltUnitCost: 1200,
        sugarConsumedGrams: 500,
        sugarUnitCost: 3400,
      });
      // 516000 + 26000 + 15000 + 1800 + 1700 = 560500
      expect(cogs).toBe(560500);
    });

    it('computes gross profit, net profit, and handles zero/loss and reversed expenses', () => {
      expect(calculateGrossProfit(0, 0)).toBe(0);
      expect(calculateNetProfit(0, 0, 0)).toBe(0);

      expect(calculateGrossProfit(1_000_000.5, 620_000.25)).toBe(380_000.25);
      expect(calculateNetProfit(1_000_000.5, 620_000.25, 130_000.15)).toBe(250_000.1);

      // Reversed expense nets to 0 -> restores net profit
      const reversedExpensesNet = round2(50_000 - 50_000);
      expect(calculateNetProfit(200_000, 120_000, reversedExpensesNet)).toBe(80_000);
    });

    it('accepts PostgreSQL NUMERIC strings without IEEE-754 accumulation drift', () => {
      expect(calculateCustomerBalance('1000.10', '0.20', '0.30')).toBe(1000.2);
      expect(calculateNetProfit('500000.55', '300000.22', '50000.11')).toBe(150000.22);
    });
  });
});
