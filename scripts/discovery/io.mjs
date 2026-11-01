import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import path from 'node:path';
export async function readJson(file, fallback) {
  try { return JSON.parse(await readFile(file, 'utf8')); } catch (e) { if (e.code === 'ENOENT' && fallback !== undefined) return structuredClone(fallback); throw e; }
}
export async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporary, file);
}
export const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export const args = (argv = process.argv.slice(2)) => Object.fromEntries(argv.filter((x) => x.startsWith('--')).map((x) => { const i = argv.indexOf(x); return [x.slice(2), argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true]; }));
export function publicError(error) {
  // Never forward third-party exception bodies, headers or URLs with login material.
  if (error?.publicMessage) return error.publicMessage;
  return '请求失败或平台要求登录，请查看采集验证报告并更新登录状态。';
}
export function failure(message) { const e = new Error(message); e.publicMessage = message; return e; }
