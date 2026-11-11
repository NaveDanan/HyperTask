import { NumberFilterConditionPB as Condition } from '@shared/protobuf/flowy-database2/number_filter_pb';

const minimum = -(1n << 63n), maximum = (1n << 63n) - 1n;

/** Native Time values and predicates are signed whole minutes, not timestamps. */
export function hyperDatabaseTimeFilterMinutes(content: string): bigint {
  if (!/^[+-]?\d{1,64}$/u.test(content)) throw Error('invalidTime');
  const minutes = BigInt(content);
  if (minutes < minimum || minutes > maximum) throw Error('invalidTime');
  return minutes;
}

export function hyperDatabaseTimeFilterValidate(condition: number, content: string): void {
  if (condition === Condition.NumberIsEmpty || condition === Condition.NumberIsNotEmpty) return;
  if (!Number.isInteger(condition) || condition < Condition.Equal || condition > Condition.LessThanOrEqualTo) throw Error('unsupported');
  const minutes = hyperDatabaseTimeFilterMinutes(content);
  // Native row prefill adds/subtracts one minute for exclusive predicates.
  // Keep existing boundary criteria inspectable, but never author an overflow.
  if (condition === Condition.GreaterThan && minutes === maximum || condition === Condition.LessThan && minutes === minimum) throw Error('invalidTime');
}

export function hyperDatabaseTimeFilterEditable(condition: number, content: string): boolean {
  try {
    if ((condition === Condition.NumberIsEmpty || condition === Condition.NumberIsNotEmpty) && content !== '') return false;
    hyperDatabaseTimeFilterValidate(condition, content);
    return true;
  } catch { return false; }
}
