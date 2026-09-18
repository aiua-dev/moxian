import { describe, expect, it } from 'vitest';
import { FORMAT_VERSION } from '../src/constants.js';
import type { Project } from '../src/core/project.js';
import type { Chapter, Outline } from '../src/core/store.js';
import { validateDataset, type Dataset } from '../src/core/validate.js';
import type { ChapterMeta, Foreshadow, Person, Setting, TimelineEvent } from '../src/domain/schema.js';

function chapter(no: string, partial: Partial<ChapterMeta> = {}): Chapter {
  return {
    chapter: no,
    title: '标题',
    file: `/作品/正文/${no}-标题.md`,
    meta: {
      章: no,
      标题: '标题',
      埋: [],
      收: [],
      事件: [],
      认知: [],
      关系: [],
      ...partial,
    },
    body: '正文',
  };
}

function outline(volume: number, planned: string[]): Outline {
  return {
    volume,
    name: `第 ${volume} 卷`,
    meta: { 卷: volume, 名: `第 ${volume} 卷`, 规划: planned },
    body: '',
    file: `/作品/大纲/${volume}-第${volume}卷.md`,
  };
}

function make(overrides: Partial<Dataset> = {}): Dataset {
  const project: Project = {
    root: '/作品',
    work: { 格式版本: FORMAT_VERSION, 书名: '测试', 卷: [{ 序号: 1, 名: '第一卷' }] },
  };
  return {
    project,
    chapters: [],
    entries: { 伏笔: [], 人物: [], 时间线: [], 设定: [] },
    outlines: [],
    ...overrides,
  };
}

function foreshadow(partial: Partial<Foreshadow> & { 编号: string }): Foreshadow {
  return {
    描述: '一条伏笔',
    状态: '悬空',
    关联: [],
    ...partial,
  };
}

function person(id: string): Person {
  return { 编号: id, 名: `人物${id}`, 别名: [] };
}

function setting(partial: Partial<Setting> & { 编号: string }): Setting {
  return { 描述: '一条真相', 类型: '真相', ...partial };
}

function timeline(partial: Partial<TimelineEvent> & { 编号: string }): TimelineEvent {
  return { 描述: '一个事件', 前置: [], ...partial };
}

const rules = (data: Dataset): string[] => validateDataset(data).map((item) => item.rule);

describe('引用完整性', () => {
  it('引用不存在的伏笔报 E001', () => {
    const data = make({ chapters: [chapter('1-01', { 埋: ['F-001'] })] });
    expect(rules(data)).toContain('E001');
  });

  it('引用存在但类型不对也报 E001', () => {
    const data = make({
      chapters: [chapter('1-01', { 埋: ['P-001'] })],
      entries: { 伏笔: [], 人物: [person('P-001')], 时间线: [], 设定: [] },
    });
    expect(rules(data)).toContain('E001');
  });

  it('引用的章号不存在报 E001', () => {
    const data = make({
      chapters: [chapter('1-01')],
      entries: {
        伏笔: [foreshadow({ 编号: 'F-001', 埋: '1-05' })],
        人物: [],
        时间线: [],
        设定: [],
      },
    });
    expect(rules(data)).toContain('E001');
  });

  it('引用齐全时没有硬错', () => {
    const data = make({
      chapters: [chapter('1-01', { 埋: ['F-001'], 事件: ['E-001'] })],
      entries: {
        伏笔: [foreshadow({ 编号: 'F-001', 埋: '1-01' })],
        人物: [],
        时间线: [timeline({ 编号: 'E-001' })],
        设定: [],
      },
    });
    expect(validateDataset(data).filter((item) => item.severity === '硬错')).toEqual([]);
  });
});

describe('唯一性', () => {
  it('同一编号登记两次报 E002', () => {
    const data = make({
      entries: {
        伏笔: [foreshadow({ 编号: 'F-001' }), foreshadow({ 编号: 'F-001' })],
        人物: [],
        时间线: [],
        设定: [],
      },
    });
    expect(rules(data)).toContain('E002');
  });

  it('一章两个文件报 E004', () => {
    const data = make({ chapters: [chapter('1-01'), chapter('1-01')] });
    expect(rules(data)).toContain('E004');
  });

  it('一个事件被两章声明报 E002', () => {
    const data = make({
      chapters: [chapter('1-01', { 事件: ['E-001'] }), chapter('1-02', { 事件: ['E-001'] })],
      entries: { 伏笔: [], 人物: [], 时间线: [timeline({ 编号: 'E-001' })], 设定: [] },
    });
    expect(rules(data)).toContain('E002');
  });

  it('条目编号前缀和文件类型不符报 E007', () => {
    const data = make({
      entries: { 伏笔: [], 人物: [person('F-001')], 时间线: [], 设定: [] },
    });
    expect(rules(data)).toContain('E007');
  });
});

describe('时序与状态', () => {
  it('回收章早于埋设章报 E005', () => {
    const data = make({
      chapters: [chapter('1-01'), chapter('1-02')],
      entries: {
        伏笔: [foreshadow({ 编号: 'F-001', 埋: '1-03', 回收: '1-01', 状态: '已收' })],
        人物: [],
        时间线: [],
        设定: [],
      },
    });
    expect(rules(data)).toContain('E005');
  });

  it('前置事件排在后面报 E005', () => {
    const data = make({
      chapters: [chapter('1-01', { 事件: ['E-001'] }), chapter('1-02', { 事件: ['E-002'] })],
      entries: {
        伏笔: [],
        人物: [],
        时间线: [timeline({ 编号: 'E-001', 前置: ['E-002'] }), timeline({ 编号: 'E-002' })],
        设定: [],
      },
    });
    expect(rules(data)).toContain('E005');
  });

  it('标为已收却没有回收章报 E008', () => {
    const data = make({
      entries: {
        伏笔: [foreshadow({ 编号: 'F-001', 状态: '已收' })],
        人物: [],
        时间线: [],
        设定: [],
      },
    });
    expect(rules(data)).toContain('E008');
  });

  it('有回收章却还是悬空报 E008', () => {
    const data = make({
      chapters: [chapter('1-01', { 收: ['F-001'] })],
      entries: {
        伏笔: [foreshadow({ 编号: 'F-001', 埋: '1-01', 回收: '1-01', 状态: '悬空' })],
        人物: [],
        时间线: [],
        设定: [],
      },
    });
    expect(rules(data)).toContain('E008');
  });
});

describe('两侧同步', () => {
  it('条目与章节写的埋设章对不上报 E009', () => {
    const data = make({
      chapters: [chapter('1-01'), chapter('1-02', { 埋: ['F-001'] })],
      entries: {
        伏笔: [foreshadow({ 编号: 'F-001', 埋: '1-01' })],
        人物: [],
        时间线: [],
        设定: [],
      },
    });
    expect(rules(data)).toContain('E009');
  });

  it('只写了一边只是提醒 W006', () => {
    const data = make({
      chapters: [chapter('1-01')],
      entries: {
        伏笔: [foreshadow({ 编号: 'F-001', 埋: '1-01' })],
        人物: [],
        时间线: [],
        设定: [],
      },
    });
    const found = validateDataset(data);
    expect(found.map((item) => item.rule)).toContain('W006');
    expect(found.filter((item) => item.severity === '硬错')).toEqual([]);
  });

  it('一条伏笔在两章都登记埋设报 E002', () => {
    const data = make({
      chapters: [chapter('1-01', { 埋: ['F-001'] }), chapter('1-02', { 埋: ['F-001'] })],
      entries: {
        伏笔: [foreshadow({ 编号: 'F-001', 埋: '1-01' })],
        人物: [],
        时间线: [],
        设定: [],
      },
    });
    expect(rules(data)).toContain('E002');
  });
});

describe('提醒', () => {
  it('埋了 30 章还没收也没规划回收，报 W001', () => {
    const chapters = Array.from({ length: 32 }, (_, index) =>
      chapter(`1-${String(index + 1).padStart(2, '0')}`),
    );
    const data = make({
      chapters: [
        chapter('1-01', { 埋: ['F-001'] }),
        ...chapters.slice(1),
      ],
      entries: {
        伏笔: [foreshadow({ 编号: 'F-001', 埋: '1-01' })],
        人物: [],
        时间线: [],
        设定: [],
      },
    });
    expect(rules(data)).toContain('W001');
  });

  it('没到阈值就不报 W001', () => {
    const data = make({
      chapters: [chapter('1-01', { 埋: ['F-001'] }), chapter('1-02')],
      entries: {
        伏笔: [foreshadow({ 编号: 'F-001', 埋: '1-01' })],
        人物: [],
        时间线: [],
        设定: [],
      },
    });
    expect(rules(data)).not.toContain('W001');
  });

  it('过了预期回收章还没收，报 W002', () => {
    const data = make({
      chapters: [chapter('1-01', { 埋: ['F-001'] }), chapter('1-02')],
      entries: {
        伏笔: [foreshadow({ 编号: 'F-001', 埋: '1-01', 预期回收: '1-02' })],
        人物: [],
        时间线: [],
        设定: [],
      },
    });
    expect(rules(data)).toContain('W002');
  });

  it('角色在真相对读者揭示之前就知道了，报 W003', () => {
    const data = make({
      chapters: [
        chapter('1-01', {
          认知: [{ 人物: 'P-001', 设定: 'S-001', 变为: '已知' }],
        }),
        chapter('1-02'),
      ],
      entries: {
        伏笔: [],
        人物: [person('P-001')],
        时间线: [],
        设定: [setting({ 编号: 'S-001', 揭示: '1-02' })],
      },
    });
    expect(rules(data)).toContain('W003');
  });

  it('大纲规划了没写的章报 W004，没规划就写了正文报 W005', () => {
    const data = make({
      chapters: [chapter('1-02')],
      outlines: [outline(1, ['1-01', '1-02'])],
    });
    const found = rules(data);
    expect(found).toContain('W004');
    expect(found).not.toContain('W005');

    const withoutPlan = make({ chapters: [chapter('1-02')], outlines: [] });
    expect(rules(withoutPlan)).not.toContain('W005');
  });

  it('大纲没规划到的正文本报 W005', () => {
    const data = make({
      chapters: [chapter('1-01'), chapter('1-05')],
      outlines: [outline(1, ['1-01'])],
    });
    expect(rules(data)).toContain('W005');
  });
});

describe('卷册', () => {
  it('章节落在没登记的卷上报 E006', () => {
    const data = make({ chapters: [chapter('3-01')] });
    expect(rules(data)).toContain('E006');
  });

  it('卷大纲的卷不在册也报 E006', () => {
    const data = make({ outlines: [outline(2, [])] });
    expect(rules(data)).toContain('E006');
  });
});

describe('排序', () => {
  it('硬错排在提醒前面', () => {
    const data = make({
      chapters: [chapter('1-01', { 埋: ['F-404'] })],
      entries: {
        伏笔: [foreshadow({ 编号: 'F-001', 埋: '1-01', 预期回收: '1-01' })],
        人物: [],
        时间线: [],
        设定: [],
      },
    });
    const found = validateDataset(data);
    const firstSoft = found.findIndex((item) => item.severity === '提醒');
    const lastHard = found.map((item) => item.severity).lastIndexOf('硬错');
    expect(lastHard).toBeLessThan(firstSoft);
  });
});
