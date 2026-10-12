/**
 * IMEI helpers. Operators record the same handset as a 15-digit IMEI
 * (14 digits + Luhn check digit), a 16-digit IMEISV (14 digits + 2-digit
 * software version) or occasionally with the check digit replaced by 0, so
 * devices are compared on the first 14 digits (TAC 8 + serial 6).
 */

export function imeiCore(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  const d = String(raw).replace(/\D/g, '');
  if (d.length < 14) return undefined;
  if (/^0+$/.test(d)) return undefined;
  return d.slice(0, 14);
}

export function luhnCheckDigit(core14: string): number {
  let sum = 0;
  for (let i = 0; i < core14.length; i++) {
    let n = Number(core14[core14.length - 1 - i]);
    // Double every second digit counting from the right of the payload.
    if (i % 2 === 0) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
  }
  return (10 - (sum % 10)) % 10;
}

/** Canonical 15-digit IMEI with a correct check digit. */
export function imei15(core14: string): string {
  return core14 + String(luhnCheckDigit(core14));
}

/** Type Allocation Code: identifies the handset model (first 8 digits). */
export function tacOf(core14: string): string {
  return core14.slice(0, 8);
}

/**
 * Dual-SIM phones expose one IMEI per slot; manufacturers usually allocate
 * them consecutively, so two cores with the same TAC whose serials differ by
 * a small amount are a "possibly the same handset" candidate.
 */
export function likelySameHandset(coreA: string, coreB: string): boolean {
  if (coreA === coreB) return false;
  if (tacOf(coreA) !== tacOf(coreB)) return false;
  const serialA = Number(coreA.slice(8));
  const serialB = Number(coreB.slice(8));
  return Math.abs(serialA - serialB) <= 10;
}
