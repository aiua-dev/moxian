import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const CLI = path.resolve(import.meta.dirname, '../dist/cli.js');

let root: string;

function run(...args: string[]): string {
  return execFileSync(process.execPath, [CLI, ...args], { cwd: root, encoding: 'utf8' });
}

function runFail(...args: string[]): { status: number; stderr: string } {
  try {
    execFileSync(process.execPath, [CLI, ...args], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    const failure = error as { status?: number; stderr?: string };
    return { status: failure.status ?? -1, stderr: failure.stderr ?? '' };
  }
  throw new Error(`命令本该失败却成功了：${args.join(' ')}`);
}

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'moxian-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('初始化', () => {
  it('建出三个目录和四类清单', () => {
    run('初始化', '.', '--书名', '雪夜断玉');
    expect(readFileSync(path.join(root, '作品.yaml'), 'utf8')).toContain('雪夜断玉');
    for (const name of ['正文', '大纲', '连续性']) {
      expect(() => readdirSync(path.join(root, name))).not.toThrow();
    }
    expect(readFileSync(path.join(root, '大纲', '总纲.md'), 'utf8')).toContain('总纲');
    for (const kind of ['伏笔', '人物', '时间线', '设定']) {
      expect(readFileSync(path.join(root, '连续性', `${kind}.yaml`), 'utf8')).toContain(kind);
    }
  });

  it('拒绝在非空目录里初始化', () => {
    writeFileSync(path.join(root, '已有文件.txt'), 'x', 'utf8');
    const result = runFail('初始化', '.', '--书名', '雪夜断玉');
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('不是空目录');
  });

  it('重复初始化会被挡住', () => {
    run('初始化', '.', '--书名', '雪夜断玉');
    expect(runFail('初始化', '.', '--书名', '再来一次').status).toBe(2);
  });
});

describe('一整轮创作', () => {
  beforeEach(() => {
    run('初始化', '.', '--书名', '雪夜断玉', '--作者', 'YG');
    run('章', '新建', '--卷', '1', '--标题', '雪夜归人');
    run('章', '新建', '--卷', '1', '--标题', '断玉现世');
    run('人物', '新建', '--名', '沈砚', '--身份', '断玉阁少东家', '--别名', '沈三郎');
    run('人物', '新建', '--名', '裴照');
    run('设定', '新建', '--描述', '断玉能辨血脉', '--类型', '真相', '--揭示', '1-02');
    run('时间线', '新建', '--描述', '沈砚在雪夜拿到断玉');
    run('伏笔', '新建', '--描述', '断玉的来历', '--埋', '1-01', '--预期回收', '1-02');
  });

  it('章号自动往下排', () => {
    expect(readFileSync(path.join(root, '正文', '1-01-雪夜归人.md'), 'utf8')).toContain('章: 1-01');
    expect(readFileSync(path.join(root, '正文', '1-02-断玉现世.md'), 'utf8')).toContain('章: 1-02');
  });

  it('可以用名字代替编号来登记', () => {
    const output = run('章', '登记', '1-01', '--事件', 'E-001', '--认知', '沈砚:S-001:已知');
    expect(output).toContain('认知 P-001 已知 S-001');
  });

  it('收伏笔会同时更新条目和那一章', () => {
    run('章', '登记', '1-02', '--收', 'F-001');
    expect(readFileSync(path.join(root, '连续性', '伏笔.yaml'), 'utf8')).toContain('状态: 已收');
    expect(readFileSync(path.join(root, '正文', '1-02-断玉现世.md'), 'utf8')).toContain('- F-001');
  });

  it('正文区一个标记都不加', () => {
    run('章', '登记', '1-01', '--埋', 'F-001');
    const text = readFileSync(path.join(root, '正文', '1-01-雪夜归人.md'), 'utf8');
    const body = text.split(/^---$/m).slice(2).join('---');
    expect(body.trim()).toBe('');
    expect(body).not.toMatch(/F-\d{3}/);
  });

  it('打包给出写这一章需要的料', () => {
    run('章', '登记', '1-01', '--事件', 'E-001', '--认知', '沈砚:S-001:已知');
    run('大纲', '设置', '--卷', '1', '--名', '第一卷 雪夜', '--规划', '1-01,1-02');
    const output = run('打包', '1-03');
    expect(output).toContain('# 写第 1-03 章所需的上下文');
    expect(output).toContain('本卷大纲');
    expect(output).toContain('沈砚（P-001） 已知「断玉能辨血脉」');
    expect(output).toContain('未回收伏笔');
    expect(output).toContain('E-001（第 1-01 章）');
  });

  it('校验把认知早于揭示当提醒，不当硬错', () => {
    run('章', '登记', '1-01', '--认知', '沈砚:S-001:已知');
    const output = run('校验');
    expect(output).toContain('W003');
    expect(output).toContain('硬错 0 条');
  });

  it('大纲规划了没写的章会提醒', () => {
    run('大纲', '设置', '--卷', '1', '--名', '第一卷', '--规划', '1-01,1-02,1-09');
    expect(run('校验')).toContain('W004');
  });
});

describe('写入拦截', () => {
  beforeEach(() => {
    run('初始化', '.', '--书名', '雪夜断玉');
    run('章', '新建', '--卷', '1', '--标题', '雪夜归人');
  });

  it('引用不存在的编号时拦下不写', () => {
    const before = readFileSync(path.join(root, '正文', '1-01-雪夜归人.md'), 'utf8');
    const result = runFail('章', '登记', '1-01', '--埋', 'F-999');
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('E001');
    expect(readFileSync(path.join(root, '正文', '1-01-雪夜归人.md'), 'utf8')).toBe(before);
  });

  it('章号形状不对直接报错', () => {
    expect(runFail('章', '登记', '第一章', '--埋', 'F-001').stderr).toContain('章号格式不对');
  });

  it('章号重复时报错', () => {
    expect(runFail('章', '新建', '--卷', '1', '--标题', '撞车', '--章', '1-01').stderr).toContain(
      '已经存在',
    );
  });

  it('找不存在的章时报错', () => {
    expect(runFail('章', '显示', '1-09').stderr).toContain('找不到第 1-09 章');
  });

  it('卷没登记时不让建章', () => {
    expect(runFail('章', '新建', '--卷', '5', '--标题', '越界').stderr).toContain('没有第 5 卷');
  });

  it('重名的人物被挡住', () => {
    run('人物', '新建', '--名', '沈砚');
    expect(runFail('人物', '新建', '--名', '沈砚').stderr).toContain('撞名');
  });
});

describe('在作品目录之外', () => {
  it('没有 作品.yaml 时给出明确提示', () => {
    expect(runFail('校验').stderr).toContain('不是作品目录');
  });

  it('子目录里也能找到作品根', () => {
    run('初始化', '.', '--书名', '雪夜断玉');
    run('章', '新建', '--卷', '1', '--标题', '雪夜归人');
    const nested = path.join(root, '正文', 'deep');
    mkdirSync(nested, { recursive: true });
    const output = execFileSync(process.execPath, [CLI, '章', '列表'], {
      cwd: nested,
      encoding: 'utf8',
    });
    expect(output).toContain('1-01');
  });
});
