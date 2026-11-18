import Decimal from 'decimal.js';

export type NumericInput = number | string | null | undefined;

export function toDecimal(value: NumericInput): Decimal {
  if (value === null || value === undefined || value === '') {
    return new Decimal(0);
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? new Decimal(value) : new Decimal(0);
  }
  try {
    const parsed = new Decimal(value);
    return parsed.isFinite() ? parsed : new Decimal(0);
  } catch {
    return new Decimal(0);
  }
}

export function round2(n: NumericInput): number {
  return toDecimal(n).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();
}

export function round3(n: NumericInput): number {
  return toDecimal(n).toDecimalPlaces(3, Decimal.ROUND_HALF_UP).toNumber();
}

export function add2(a: NumericInput, b: NumericInput): number {
  return toDecimal(a).plus(toDecimal(b)).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();
}

export function sub2(a: NumericInput, b: NumericInput): number {
  return toDecimal(a).minus(toDecimal(b)).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();
}

export function mul2(a: NumericInput, b: NumericInput): number {
  return toDecimal(a).times(toDecimal(b)).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();
}

export function sumDecimal2(values: Iterable<NumericInput>): number {
  let total = new Decimal(0);
  for (const val of values) {
    total = total.plus(toDecimal(val));
  }
  return total.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();
}

export function sumDecimal3(values: Iterable<NumericInput>): number {
  let total = new Decimal(0);
  for (const val of values) {
    total = total.plus(toDecimal(val));
  }
  return total.toDecimalPlaces(3, Decimal.ROUND_HALF_UP).toNumber();
}

export function calculateCustomerBalance(
  totalCreditSales: NumericInput,
  totalPayments: NumericInput,
  adjustments: NumericInput
): number {
  return toDecimal(totalCreditSales)
    .minus(toDecimal(totalPayments))
    .plus(toDecimal(adjustments))
    .toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
    .toNumber();
}

export function calculateSupplierBalance(
  totalPurchases: NumericInput,
  totalPayments: NumericInput,
  adjustments: NumericInput
): number {
  return toDecimal(totalPurchases)
    .minus(toDecimal(totalPayments))
    .plus(toDecimal(adjustments))
    .toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
    .toNumber();
}

export function calculateRunningLedgerBalance(
  previousBalance: NumericInput,
  debit: NumericInput,
  credit: NumericInput
): number {
  return toDecimal(previousBalance)
    .plus(toDecimal(debit))
    .minus(toDecimal(credit))
    .toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
    .toNumber();
}

export function calculateWeightedAverageCost(params: {
  previousQty: NumericInput;
  previousAverageCost: NumericInput;
  addedQty: NumericInput;
  lineTotal: NumericInput;
  fallbackUnitPrice: NumericInput;
}): { nextQuantity: number; nextAverageCost: number } {
  const prevQty = toDecimal(params.previousQty);
  const prevAvg = toDecimal(params.previousAverageCost);
  const added = toDecimal(params.addedQty);
  const lineTotal = toDecimal(params.lineTotal);
  const nextQtyDec = prevQty.plus(added);

  const nextQuantity = nextQtyDec.toDecimalPlaces(3, Decimal.ROUND_HALF_UP).toNumber();
  const nextAverageCost = nextQtyDec.greaterThan(0)
    ? prevQty
        .times(prevAvg)
        .plus(lineTotal)
        .dividedBy(nextQtyDec)
        .toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
        .toNumber()
    : round2(params.fallbackUnitPrice);

  return { nextQuantity, nextAverageCost };
}

export interface ProductionIngredientCostInput {
  quantityUsed: NumericInput;
  averageCost: NumericInput;
}

export function calculateIngredientRowsCost(rows: ProductionIngredientCostInput[]): number {
  let total = new Decimal(0);
  for (const row of rows) {
    total = total.plus(toDecimal(row.quantityUsed).times(toDecimal(row.averageCost)));
  }
  return total.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();
}

export interface LegacyProductionCostInput {
  flourConsumedBags: NumericInput;
  flourUnitCost: NumericInput;
  oilConsumedLiters: NumericInput;
  oilUnitCost: NumericInput;
  yeastConsumedGrams: NumericInput;
  yeastUnitCost: NumericInput;
  saltConsumedGrams: NumericInput;
  saltUnitCost: NumericInput;
  sugarConsumedGrams: NumericInput;
  sugarUnitCost: NumericInput;
}

export function calculateLegacyProductionCost(input: LegacyProductionCostInput): number {
  const flour = toDecimal(input.flourConsumedBags).times(toDecimal(input.flourUnitCost));
  const oil = toDecimal(input.oilConsumedLiters).times(toDecimal(input.oilUnitCost));
  const yeast = toDecimal(input.yeastConsumedGrams).times(toDecimal(input.yeastUnitCost));
  const salt = toDecimal(input.saltConsumedGrams).dividedBy(1000).times(toDecimal(input.saltUnitCost));
  const sugar = toDecimal(input.sugarConsumedGrams)
    .dividedBy(1000)
    .times(toDecimal(input.sugarUnitCost));

  return flour
    .plus(oil)
    .plus(yeast)
    .plus(salt)
    .plus(sugar)
    .toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
    .toNumber();
}

export function calculateGrossProfit(
  salesRevenue: NumericInput,
  costOfGoodsConsumed: NumericInput
): number {
  return toDecimal(salesRevenue)
    .minus(toDecimal(costOfGoodsConsumed))
    .toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
    .toNumber();
}

export function calculateNetProfit(
  salesRevenue: NumericInput,
  costOfGoodsConsumed: NumericInput,
  operatingExpenses: NumericInput
): number {
  return toDecimal(salesRevenue)
    .minus(toDecimal(costOfGoodsConsumed))
    .minus(toDecimal(operatingExpenses))
    .toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
    .toNumber();
}
