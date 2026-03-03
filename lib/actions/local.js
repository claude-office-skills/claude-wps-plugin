/**
 * local.* — 本地计算机操作 Actions
 *
 * 通过 macOS osascript (AppleScript / JXA) 操作本地系统应用：
 *   - 日历（Calendar.app）
 *   - 通讯录（Contacts.app）
 *   - 邮件（Mail.app）
 *   - Finder
 *   - 提醒事项（Reminders.app）
 *   - 备忘录（Notes.app）
 *   - 系统信息
 *   - 剪贴板
 *   - 浏览器（Safari / Chrome）
 *   - 通用 AppleScript 执行
 *
 * 安全模型：
 *   - 所有操作通过 osascript 执行，受 macOS 沙盒权限控制
 *   - 首次访问时 macOS 会弹出权限请求（日历、通讯录等）
 *   - local-permissions.js 负责预检 + 引导用户授权
 */

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const TIMEOUT = 15000;

function escapeAppleScript(str) {
  return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

async function runOsascript(script, timeout = TIMEOUT) {
  const escaped = script.replace(/'/g, "'\"'\"'");
  const { stdout, stderr } = await execAsync(
    `osascript -e '${escaped}'`,
    { timeout },
  );
  if (stderr && !stdout) throw new Error(`AppleScript error: ${stderr}`);
  return stdout.trim();
}

async function runJxa(code, timeout = TIMEOUT) {
  const escaped = code.replace(/'/g, "'\"'\"'");
  const { stdout, stderr } = await execAsync(
    `osascript -l JavaScript -e '${escaped}'`,
    { timeout },
  );
  if (stderr && stderr.includes('error')) throw new Error(`JXA error: ${stderr}`);
  return stdout.trim();
}

export const localActions = {
  // ── 日历 ──────────────────────────────────────────────

  /**
   * local.calendar.list — 列出日历中的事件
   * params:
   *   days:   查询未来多少天（默认 7）
   *   calendar: 指定日历名（可选）
   */
  'local.calendar.list': async ({ days = 7, calendar, onProgress }) => {
    if (onProgress) onProgress({ phase: 'reading', message: '读取日历事件...' });

    const calFilter = calendar
      ? `of calendar "${escapeAppleScript(calendar)}"`
      : '';

    const script = `
      set today to current date
      set endDate to today + ${days} * days
      set output to ""
      tell application "Calendar"
        set allCalendars to every calendar
        repeat with cal in allCalendars
          set calName to name of cal
          set evts to (every event ${calFilter || 'of cal'} whose start date >= today and start date <= endDate)
          repeat with e in evts
            set output to output & calName & " | " & summary of e & " | " & (start date of e as string) & " | " & (end date of e as string) & linefeed
          end repeat
        end repeat
      end tell
      return output
    `;

    const raw = await runOsascript(script);
    const events = raw
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [cal, summary, start, end] = line.split(' | ');
        return { calendar: cal?.trim(), summary: summary?.trim(), start: start?.trim(), end: end?.trim() };
      });

    return { ok: true, count: events.length, days, events };
  },

  /**
   * local.calendar.create — 创建日历事件
   * params:
   *   title:    事件标题
   *   start:    开始时间 (自然语言，如 "2026-03-03 10:00")
   *   end:      结束时间
   *   calendar: 日历名（默认第一个）
   *   notes:    备注
   *   location: 地点
   */
  'local.calendar.create': async ({ title, start, end, calendar, notes = '', location = '', onProgress }) => {
    if (!title) throw new Error('title is required');
    if (!start) throw new Error('start time is required');

    if (onProgress) onProgress({ phase: 'creating', message: `创建事件: ${title}` });

    const endTime = end || start;
    const calClause = calendar
      ? `of calendar "${escapeAppleScript(calendar)}"`
      : 'of first calendar';

    const script = `
      tell application "Calendar"
        set startDate to date "${escapeAppleScript(start)}"
        set endDate to date "${escapeAppleScript(endTime)}"
        tell ${calClause.startsWith('of') ? calClause.slice(3) : calClause}
          set newEvent to make new event with properties {summary:"${escapeAppleScript(title)}", start date:startDate, end date:endDate, description:"${escapeAppleScript(notes)}", location:"${escapeAppleScript(location)}"}
        end tell
      end tell
      return "OK"
    `;

    await runOsascript(script);
    return { ok: true, title, start, end: endTime };
  },

  // ── 通讯录 ──────────────────────────────────────────────

  /**
   * local.contacts.search — 搜索通讯录
   * params:
   *   query: 搜索关键词（名字/邮箱/电话）
   */
  'local.contacts.search': async ({ query, onProgress }) => {
    if (!query) throw new Error('query is required');

    if (onProgress) onProgress({ phase: 'searching', message: `搜索联系人: ${query}` });

    const script = `
      tell application "Contacts"
        set matches to (every person whose name contains "${escapeAppleScript(query)}")
        set output to ""
        repeat with p in matches
          set pName to name of p
          set pEmails to ""
          repeat with e in (emails of p)
            set pEmails to pEmails & value of e & ", "
          end repeat
          set pPhones to ""
          repeat with ph in (phones of p)
            set pPhones to pPhones & value of ph & ", "
          end repeat
          set output to output & pName & " | " & pEmails & " | " & pPhones & linefeed
        end repeat
        return output
      end tell
    `;

    const raw = await runOsascript(script, 20000);
    const contacts = raw
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [name, emails, phones] = line.split(' | ');
        return {
          name: name?.trim(),
          emails: emails?.trim().replace(/, $/, ''),
          phones: phones?.trim().replace(/, $/, ''),
        };
      });

    return { ok: true, count: contacts.length, query, contacts };
  },

  // ── 邮件 ──────────────────────────────────────────────

  /**
   * local.mail.send — 通过 Mail.app 发送邮件
   * params:
   *   to:       收件人邮箱
   *   subject:  主题
   *   body:     正文
   *   cc:       抄送（可选）
   */
  'local.mail.send': async ({ to, subject, body, cc, onProgress }) => {
    if (!to) throw new Error('to is required');
    if (!subject) throw new Error('subject is required');

    if (onProgress) onProgress({ phase: 'composing', message: `发送邮件给 ${to}` });

    const ccClause = cc ? `set cc of msg to "${escapeAppleScript(cc)}"` : '';

    const script = `
      tell application "Mail"
        set msg to make new outgoing message with properties {subject:"${escapeAppleScript(subject)}", content:"${escapeAppleScript(body || '')}"}
        tell msg
          make new to recipient at end of to recipients with properties {address:"${escapeAppleScript(to)}"}
          ${ccClause}
        end tell
        send msg
      end tell
      return "sent"
    `;

    await runOsascript(script, 30000);
    return { ok: true, to, subject };
  },

  /**
   * local.mail.unread — 获取未读邮件
   * params:
   *   count: 获取数量（默认 10）
   *   account: 邮箱账户名（可选）
   */
  'local.mail.unread': async ({ count = 10, account, onProgress }) => {
    if (onProgress) onProgress({ phase: 'reading', message: '读取未读邮件...' });

    const acctFilter = account
      ? `of account "${escapeAppleScript(account)}"`
      : '';

    const script = `
      tell application "Mail"
        set msgs to (messages of inbox ${acctFilter} whose read status is false)
        set output to ""
        set limit to ${count}
        set idx to 0
        repeat with m in msgs
          if idx >= limit then exit repeat
          set output to output & (sender of m) & " | " & (subject of m) & " | " & (date received of m as string) & linefeed
          set idx to idx + 1
        end repeat
        return output
      end tell
    `;

    const raw = await runOsascript(script, 20000);
    const emails = raw
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [sender, subject, date] = line.split(' | ');
        return { sender: sender?.trim(), subject: subject?.trim(), date: date?.trim() };
      });

    return { ok: true, count: emails.length, emails };
  },

  // ── Finder / 文件系统 ──────────────────────────────────

  /**
   * local.finder.open — 在 Finder 中打开路径
   */
  'local.finder.open': async ({ path: dirPath }) => {
    if (!dirPath) throw new Error('path is required');
    await execAsync(`open "${dirPath.replace(/"/g, '\\"')}"`);
    return { ok: true, path: dirPath };
  },

  /**
   * local.finder.selection — 获取 Finder 当前选中的文件
   */
  'local.finder.selection': async () => {
    const script = `
      tell application "Finder"
        set sel to selection
        set output to ""
        repeat with f in sel
          set output to output & (POSIX path of (f as alias)) & linefeed
        end repeat
        return output
      end tell
    `;
    const raw = await runOsascript(script);
    const files = raw.split('\n').filter(Boolean);
    return { ok: true, count: files.length, files };
  },

  // ── 提醒事项 ──────────────────────────────────────────

  /**
   * local.reminders.list — 列出提醒事项
   */
  'local.reminders.list': async ({ list = 'Reminders', completed = false }) => {
    const completedFilter = completed ? '' : 'whose completed is false';
    const script = `
      tell application "Reminders"
        set output to ""
        set rems to (every reminder of list "${escapeAppleScript(list)}" ${completedFilter})
        repeat with r in rems
          set output to output & name of r & " | " & (due date of r as string) & linefeed
        end repeat
        return output
      end tell
    `;
    const raw = await runOsascript(script);
    const items = raw
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [name, dueDate] = line.split(' | ');
        return { name: name?.trim(), dueDate: dueDate?.trim() };
      });
    return { ok: true, count: items.length, items };
  },

  /**
   * local.reminders.create — 创建提醒
   */
  'local.reminders.create': async ({ title, dueDate, list = 'Reminders', notes = '' }) => {
    if (!title) throw new Error('title is required');
    const duePart = dueDate
      ? `, due date:date "${escapeAppleScript(dueDate)}"`
      : '';
    const script = `
      tell application "Reminders"
        tell list "${escapeAppleScript(list)}"
          make new reminder with properties {name:"${escapeAppleScript(title)}", body:"${escapeAppleScript(notes)}"${duePart}}
        end tell
      end tell
      return "OK"
    `;
    await runOsascript(script);
    return { ok: true, title };
  },

  // ── 系统信息 & 剪贴板 ────────────────────────────────

  /**
   * local.system.info — 获取系统信息
   */
  'local.system.info': async () => {
    const [hostname, user, uptime, battery, volume] = await Promise.all([
      execAsync('hostname').then(r => r.stdout.trim()).catch(() => 'unknown'),
      execAsync('whoami').then(r => r.stdout.trim()).catch(() => 'unknown'),
      execAsync('uptime').then(r => r.stdout.trim()).catch(() => 'unknown'),
      execAsync('pmset -g batt').then(r => r.stdout.trim()).catch(() => 'N/A'),
      execAsync('df -h /').then(r => r.stdout.trim()).catch(() => 'N/A'),
    ]);

    return { ok: true, hostname, user, uptime, battery, volume };
  },

  /**
   * local.clipboard.get — 读取剪贴板内容
   */
  'local.clipboard.get': async () => {
    const { stdout } = await execAsync('pbpaste', { timeout: 3000 });
    return { ok: true, content: stdout };
  },

  /**
   * local.clipboard.set — 写入剪贴板
   */
  'local.clipboard.set': async ({ content }) => {
    if (content === undefined) throw new Error('content is required');
    const escaped = content.replace(/'/g, "'\"'\"'");
    await execAsync(`echo '${escaped}' | pbcopy`, { timeout: 3000 });
    return { ok: true };
  },

  // ── 浏览器 ──────────────────────────────────────────

  /**
   * local.browser.tabs — 获取 Chrome/Safari 当前标签页
   */
  'local.browser.tabs': async ({ browser = 'Google Chrome' }) => {
    const script = browser.includes('Safari')
      ? `tell application "Safari" to return URL of current tab of every window`
      : `
        tell application "Google Chrome"
          set output to ""
          repeat with w in every window
            repeat with t in every tab of w
              set output to output & (title of t) & " | " & (URL of t) & linefeed
            end repeat
          end repeat
          return output
        end tell
      `;
    const raw = await runOsascript(script);
    const tabs = raw.split('\n').filter(Boolean).map((line) => {
      const [title, url] = line.split(' | ');
      return { title: title?.trim(), url: url?.trim() };
    });
    return { ok: true, browser, count: tabs.length, tabs };
  },

  /**
   * local.browser.open — 用浏览器打开 URL
   */
  'local.browser.open': async ({ url, browser = 'default' }) => {
    const effectiveUrl = (!url || url === 'about:blank') ? 'https://www.google.com' : url;
    const safeBrowser = (browser && browser !== 'default') ? browser : 'Google Chrome';
    const cmd = `open -a "${safeBrowser.replace(/"/g, '\\"')}" "${effectiveUrl.replace(/"/g, '\\"')}"`;
    await execAsync(cmd);
    return { ok: true, url: effectiveUrl, browser: safeBrowser };
  },

  // ── 应用控制 ──────────────────────────────────────────

  /**
   * local.apps.list — 列出当前运行的应用
   */
  'local.apps.list': async () => {
    const script = `
      tell application "System Events"
        set output to ""
        repeat with proc in (every process whose background only is false)
          set output to output & name of proc & linefeed
        end repeat
        return output
      end tell
    `;
    const raw = await runOsascript(script);
    const apps = raw.split('\n').filter(Boolean);
    return { ok: true, count: apps.length, apps };
  },

  /**
   * local.apps.launch — 启动应用
   */
  'local.apps.launch': async ({ name }) => {
    if (!name) throw new Error('app name is required');
    await execAsync(`open -a "${name.replace(/"/g, '\\"')}"`);
    return { ok: true, app: name };
  },

  /**
   * local.apps.quit — 退出应用
   */
  'local.apps.quit': async ({ name }) => {
    if (!name) throw new Error('app name is required');
    await runOsascript(`tell application "${escapeAppleScript(name)}" to quit`);
    return { ok: true, app: name };
  },

  // ── 通用 AppleScript 执行 ────────────────────────────

  /**
   * local.applescript — 执行自定义 AppleScript
   *
   * 安全说明：此 action 允许执行任意 AppleScript，
   * 但受 macOS 沙盒权限限制。建议在 Workflow 中配合 user.approve 使用。
   */
  'local.applescript': async ({ script, language = 'AppleScript', timeout = 15000 }) => {
    if (!script) throw new Error('script is required');
    const result = language === 'JXA'
      ? await runJxa(script, timeout)
      : await runOsascript(script, timeout);
    return { ok: true, output: result };
  },
};
