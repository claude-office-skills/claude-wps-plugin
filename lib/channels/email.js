/**
 * Email 渠道 — nodemailer SMTP
 * 配置：
 *   { smtp: { host, port, secure? }, user, passwordEnvVar, from? }
 *   或 { mailApp: true } 使用 macOS Mail.app（osascript，无需密码）
 */

export async function sendEmail(config, payload) {
  const { to, subject, body: textBody, html, attachments } = payload;

  if (!to) throw new Error('email.to is required');

  if (config.mailApp) {
    return sendViaMailApp({ to, subject, body: textBody, attachments });
  }

  const { createTransport } = await import('nodemailer');

  const password = config.passwordEnvVar
    ? process.env[config.passwordEnvVar]
    : config.password;

  if (!password) {
    throw new Error(
      `Email password not found. Set env var: ${config.passwordEnvVar || 'CLAUDE_WPS_EMAIL_PASS'}`
    );
  }

  const transporter = createTransport({
    host: config.smtp?.host || 'smtp.gmail.com',
    port: config.smtp?.port || 587,
    secure: config.smtp?.secure ?? false,
    auth: { user: config.user, pass: password },
  });

  const info = await transporter.sendMail({
    from: config.from || config.user,
    to,
    subject: subject || 'Claude for WPS 通知',
    text: textBody,
    html,
    attachments: attachments?.map(a => ({
      filename: a.filename,
      path: a.path,
      contentType: a.contentType,
    })),
  });

  return { ok: true, channel: 'email', messageId: info.messageId };
}

async function sendViaMailApp({ to, subject, body, attachments }) {
  const { execSync } = await import('child_process');
  const safeSubject = (subject || '').replace(/"/g, '\\"');
  const safeBody = (body || '').replace(/"/g, '\\"').replace(/\n/g, '\\n');
  const safeTo = (to || '').replace(/"/g, '\\"');

  let attachScript = '';
  if (attachments?.length) {
    attachScript = attachments
      .map(a => `make new attachment with properties {file name: POSIX file "${a.path}"}`)
      .join('\n');
  }

  const script = `
    tell application "Mail"
      set newMsg to make new outgoing message with properties {
        subject: "${safeSubject}",
        content: "${safeBody}"
      }
      tell newMsg
        make new to recipient with properties {address: "${safeTo}"}
        ${attachScript}
        send
      end tell
    end tell
  `;

  execSync(`osascript -e '${script.replace(/'/g, "\\'")}'`);
  return { ok: true, channel: 'email', via: 'mailApp' };
}
