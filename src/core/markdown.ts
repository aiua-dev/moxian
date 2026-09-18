import YAML from 'yaml';
import { MoxianError } from './errors.js';

export interface FrontmatterFile {
  data: Record<string, unknown>;
  body: string;
}

/**
 * 正文文件的格式是 frontmatter + Markdown 正文。
 * 连续性数据全部落在 frontmatter 里，正文区一个字符都不加，
 * 所以复制正文去发布时不存在「忘了删标记」这种事。
 */
export function splitFrontmatter(text: string, where: string): FrontmatterFile | null {
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const openMatch = /^---[ \t]*\n/.exec(normalized);
  if (!openMatch) return null;

  const rest = normalized.slice(openMatch[0].length);
  const endMatch = /^---[ \t]*$/m.exec(rest);
  if (!endMatch) {
    throw new MoxianError(`${where} 的 frontmatter 缺结束分隔符 ---。`, 2);
  }

  const yamlText = rest.slice(0, endMatch.index);
  const body = rest.slice(endMatch.index + endMatch[0].length).replace(/^\n+/, '');

  let raw: unknown;
  try {
    raw = YAML.parse(yamlText);
  } catch (error) {
    throw new MoxianError(`${where} 的 frontmatter 不是合法 YAML：${(error as Error).message}`, 2);
  }
  if (raw === null || raw === undefined) raw = {};
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new MoxianError(`${where} 的 frontmatter 应该是键值对。`, 2);
  }
  return { data: raw as Record<string, unknown>, body };
}

/** 剔除 undefined 与空容器，避免磁盘上出现 埋: [] 或空对象这种噪音。 */
export function deepClean(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(deepClean).filter((item) => item !== undefined);
  }
  if (value !== null && typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      const cleaned = deepClean(item);
      if (cleaned === undefined) continue;
      if (Array.isArray(cleaned) && cleaned.length === 0) continue;
      output[key] = cleaned;
    }
    return Object.keys(output).length === 0 ? undefined : output;
  }
  return value;
}

export function joinFrontmatter(data: unknown, body: string): string {
  const cleaned = deepClean(data) ?? {};
  const yamlText = YAML.stringify(cleaned, { lineWidth: 0 }).trimEnd();
  const cleanBody = body.replace(/^\n+/, '').replace(/\s+$/, '');
  if (cleanBody.length === 0) return `---\n${yamlText}\n---\n`;
  return `---\n${yamlText}\n---\n\n${cleanBody}\n`;
}

/** 条目文件是纯 YAML，没有正文区，所以不走 frontmatter 那一套。 */
export function stringifyEntries(entries: readonly unknown[]): string {
  if (entries.length === 0) return '';
  const cleaned = deepClean(entries);
  if (!Array.isArray(cleaned) || cleaned.length === 0) return '';
  return YAML.stringify(cleaned, { lineWidth: 0 });
}
