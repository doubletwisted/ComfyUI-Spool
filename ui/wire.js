// Exact integers stay tagged decimal strings through browser JSON transport.
export const isExactInt = value =>
  !!value &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.keys(value).length === 1 &&
  Object.hasOwn(value, '__spool_int__') &&
  typeof value.__spool_int__ === 'string' &&
  /^-?[0-9]+(?![\s\S])/.test(value.__spool_int__);
export const exactDecimal = value => (isExactInt(value) ? value.__spool_int__ : String(value));
export const isIntegerValue = value => isExactInt(value) || (typeof value === 'number' && Number.isInteger(value));
export function containsExactInt(value) {
  return isExactInt(value) || (!!value && typeof value === 'object' && Object.values(value).some(containsExactInt));
}
