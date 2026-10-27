// Exact integers stay tagged decimal strings through browser JSON transport.
export const isExactInt=value=>!!value&&typeof value==='object'&&typeof value.__spool_int__==='string';
export const exactDecimal=value=>isExactInt(value)?value.__spool_int__:String(value);
export const isIntegerValue=value=>isExactInt(value)||typeof value==='number'&&Number.isInteger(value);
export function containsExactInt(value){return isExactInt(value)||!!value&&typeof value==='object'&&Object.values(value).some(containsExactInt);}
