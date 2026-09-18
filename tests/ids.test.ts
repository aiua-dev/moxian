import { describe, expect, it } from 'vitest';
import {
  allocateEntryId,
  chapterFileName,
  chapterFromFileName,
  compareChapter,
  kindOfEntryId,
  normalizeChapter,
  normalizeEntryId,
  titleFromFileName,
} from '../src/core/ids.js';
import { deepClean, joinFrontmatter, splitFrontmatter } from '../src/core/markdown.js';

describe('章号', () => {
  it('补零到两位', () => {
    expect(normalizeChapter('1-3')).toBe('1-03');
    expect(normalizeChapter('12-7')).toBe('12-07');
  });

  it('容忍全角连字符与空白', () => {
    expect(normalizeChapter(' 1－3 ')).toBe('1-03');
  });

  it('拒绝别的形状', () => {
    expect(() => normalizeChapter('第一章')).toThrow();
    expect(() => normalizeChapter('1')).toThrow();
  });

  it('卷和章都必须大于 0', () => {
    expect(() => normalizeChapter('0-1')).toThrow();
    expect(() => normalizeChapter('1-0')).toThrow();
  });

  it('写作序先比卷再比章', () => {
    expect(compareChapter('1-10', '2-01')).toBeLessThan(0);
    expect(compareChapter('1-02', '1-10')).toBeLessThan(0);
    expect(compareChapter('1-03', '1-03')).toBe(0);
  });
});

describe('条目编号', () => {
  it('规范化大小写与位数', () => {
    expect(normalizeEntryId('f-1', '伏笔')).toBe('F-001');
    expect(normalizeEntryId('P7', '人物')).toBe('P-007');
  });

  it('前缀和类型不匹配时报错', () => {
    expect(() => normalizeEntryId('F-001', '人物')).toThrow(/不属于人物类/);
  });

  it('按前缀反推类型', () => {
    expect(kindOfEntryId('S-004')).toBe('设定');
    expect(kindOfEntryId('X-001')).toBeNull();
  });

  it('分配编号时取最大值加一，不复用空洞', () => {
    expect(allocateEntryId('伏笔', ['F-001', 'F-003'])).toBe('F-004');
    expect(allocateEntryId('人物', [])).toBe('P-001');
  });

  it('忽略其它类型占用的序号', () => {
    expect(allocateEntryId('伏笔', ['P-009', 'F-002'])).toBe('F-003');
  });
});

describe('正文文件名', () => {
  it('拼成 章号-标题', () => {
    expect(chapterFileName('1-3', '雪夜归人')).toBe('1-03-雪夜归人.md');
  });

  it('标题里的连字符不破坏还原', () => {
    const name = chapterFileName('1-03', '雪夜-归人');
    expect(chapterFromFileName(name)).toBe('1-03');
    expect(titleFromFileName(name)).toBe('雪夜-归人');
  });

  it('非正文文件返回 null', () => {
    expect(chapterFromFileName('大纲.md')).toBeNull();
    expect(chapterFromFileName('1-01.md')).toBeNull();
  });
});

describe('frontmatter', () => {
  it('拆出数据与正文', () => {
    const text = '---\n章: 1-03\n标题: 雪夜归人\n---\n\n正文第一行\n正文第二行\n';
    const parsed = splitFrontmatter(text, 'test');
    expect(parsed?.data['章']).toBe('1-03');
    expect(parsed?.body).toBe('正文第一行\n正文第二行\n');
  });

  it('没有 frontmatter 时返回 null', () => {
    expect(splitFrontmatter('正文\n', 'test')).toBeNull();
  });

  it('缺结束分隔符时报错', () => {
    expect(() => splitFrontmatter('---\n章: 1-03\n', 'test')).toThrow(/结束分隔符/);
  });

  it('写出时不带空数组噪音', () => {
    const text = joinFrontmatter({ 章: '1-03', 标题: '雪夜归人', 埋: [], 收: [] }, '正文\n');
    expect(text).not.toContain('埋');
    expect(text).toContain('---\n章: 1-03\n');
  });

  it('正文为空时不留下多余空行', () => {
    expect(joinFrontmatter({ 章: '1-03' }, '')).toBe('---\n章: 1-03\n---\n');
  });

  it('清除 undefined 与空数组', () => {
    expect(deepClean({ a: undefined, b: [], c: {}, d: [1] })).toEqual({ d: [1] });
  });

  it('往返一次内容不变', () => {
    const meta = { 章: '1-03', 标题: '雪夜归人', 埋: ['F-001'], 认知: [{ 人物: 'P-001', 设定: 'S-001', 变为: '已知' }] };
    const text = joinFrontmatter(meta, '正文\n');
    const back = splitFrontmatter(text, 'test');
    expect(back?.data).toEqual(meta);
    expect(back?.body).toBe('正文\n');
  });
});
