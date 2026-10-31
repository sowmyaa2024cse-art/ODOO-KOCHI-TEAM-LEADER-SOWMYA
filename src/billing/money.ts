export function decimalToMinorUnits(value: string, scale: number): bigint {
  const [whole, fraction = ""] = value.split(".");
  if (fraction.length > scale) {
    throw new Error(`Decimal precision exceeds ${scale} places.`);
  }
  return (
    BigInt(whole) * 10n ** BigInt(scale) + BigInt(fraction.padEnd(scale, "0"))
  );
}

export function minorUnitsToDecimal(value: bigint, scale: number): string {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const base = 10n ** BigInt(scale);
  const fraction = String(absolute % base).padStart(scale, "0");
  return `${negative ? "-" : ""}${absolute / base}.${fraction}`;
}

export function multiplyQuantityAndMoney(
  quantity: string,
  unitPrice: string,
): bigint {
  const quantityMilli = decimalToMinorUnits(quantity, 3);
  const unitCents = decimalToMinorUnits(unitPrice, 2);
  return roundDivide(quantityMilli * unitCents, 1000n);
}

export function roundDivide(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) {
    throw new Error("Denominator must be positive.");
  }
  if (numerator < 0n) {
    return -roundDivide(-numerator, denominator);
  }
  return (numerator + denominator / 2n) / denominator;
}

export function decimalRateToBasisPoints(rate: string): bigint {
  return decimalToMinorUnits(rate, 2);
}

export function multiplyByRate(
  amountCents: bigint,
  rateBasisPoints: bigint,
): bigint {
  return roundDivide(amountCents * rateBasisPoints, 10_000n);
}

export function inclusiveTaxComponent(
  grossCents: bigint,
  rateBasisPoints: bigint,
): bigint {
  return roundDivide(grossCents * rateBasisPoints, 10_000n + rateBasisPoints);
}

export function formatMoney(cents: bigint): string {
  return minorUnitsToDecimal(cents, 2);
}
