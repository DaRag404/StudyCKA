// The browser entry of just-bash imports these synchronous zlib operations.
import { Gunzip, gzipSync as compress } from 'fflate';
export const constants = { Z_BEST_COMPRESSION: 9, Z_BEST_SPEED: 1, Z_DEFAULT_COMPRESSION: 6 };
export function gzipSync(bytes, { level = 6, maxOutputLength = Infinity } = {}) {
  const result = compress(bytes, { level });
  if (result.length > maxOutputLength) throw Error('gzip output limit exceeded');
  return result;
}
export function gunzipSync(bytes, { maxOutputLength = Infinity } = {}) {
  const chunks = [];
  let length = 0;
  const decoder = new Gunzip((chunk) => {
    length += chunk.length;
    if (length > maxOutputLength) throw Error('gunzip output limit exceeded');
    chunks.push(chunk);
  });
  for (let i = 0; i < bytes.length; i += 1024)
    decoder.push(bytes.subarray(i, i + 1024), i + 1024 >= bytes.length);
  const out = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}
