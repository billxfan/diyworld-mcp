import nodemailer from "nodemailer";

type ApplicationNotification = {
  id: number;
  name: string;
  email: string;
  worldType: string;
  selectedWorld?: string;
  submittedAt: Date;
  created: boolean;
};

const worldTypeNames: Record<string, string> = {
  social: "生活与社交",
  growth: "成长与探索",
  story: "故事与冒险",
  building: "经营与建设",
  reasoning: "推理与决策",
  creative: "创作与表达",
  create: "创造一个新世界",
};

let transporter: ReturnType<typeof nodemailer.createTransport> | undefined;

function getTransporter() {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;

  if (!user || !pass) {
    throw new Error("Gmail notification credentials are not configured.");
  }

  transporter ??= nodemailer.createTransport({
    service: "gmail",
    auth: { user, pass },
  });

  return { transporter, user };
}

export async function sendApplicationNotification(input: ApplicationNotification) {
  const { transporter: mailer, user } = getTransporter();
  const recipient = process.env.NOTIFICATION_EMAIL || user;
  const submittedAt = new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "long",
    timeStyle: "medium",
    timeZone: "Asia/Shanghai",
  }).format(input.submittedAt);
  const direction = worldTypeNames[input.worldType] ?? input.worldType;
  const status = input.created ? "新预约" : "预约信息更新";

  await mailer.sendMail({
    from: `diyworld 预约通知 <${user}>`,
    to: recipient,
    replyTo: input.email,
    subject: `【diyworld】${status}：${input.name}`,
    text: [
      `收到一条${status}。`,
      "",
      `称呼：${input.name}`,
      `邮箱：${input.email}`,
      `参与方向：${direction}`,
      `选择世界：${input.selectedWorld ?? "未指定"}`,
      `提交时间：${submittedAt}`,
      `预约编号：${input.id}`,
      "",
      "直接回复这封邮件即可联系申请人。",
    ].join("\n"),
  });
}
