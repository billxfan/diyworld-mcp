import { saveApplication } from "@/lib/applications";
import { sendApplicationNotification } from "@/lib/email";
import { getWorlds, worldTypes, type WorldLocale } from "@/lib/worlds";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const responseCopy = {
  zh: {
    email: "请填写有效的邮箱地址。",
    name: "请填写 2–80 个字符的称呼。",
    direction: "请选择一个想探索的方向。",
    world: "所选世界不存在。",
    created: "已收到，我们会通过邮箱与你联系。",
    updated: "信息已更新，我们会通过邮箱与你联系。",
    unavailable: "暂时无法提交，请稍后再试。",
    visitor: "访客",
  },
  en: {
    email: "Please enter a valid email address.",
    name: "Please enter a name between 2 and 80 characters.",
    direction: "Please choose a world direction.",
    world: "The selected world does not exist.",
    created: "You're on the list. We'll reach out by email.",
    updated: "Your preferences have been updated. We'll reach out by email.",
    unavailable: "We couldn't submit this right now. Please try again.",
    visitor: "visitor",
  },
} satisfies Record<WorldLocale, Record<string, string>>;

export async function POST(request: Request) {
  let locale: WorldLocale = "zh";
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const worldType = typeof body.worldType === "string" ? body.worldType.trim() : "";
    locale = body.locale === "en" ? "en" : "zh";
    const copy = responseCopy[locale];
    const officialWorlds = new Map(getWorlds(locale).map((world) => [world.id, world]));
    const selectedWorldId = typeof body.selectedWorldId === "string" ? body.selectedWorldId : undefined;
    const selectedWorld = selectedWorldId ? officialWorlds.get(selectedWorldId) : undefined;

    if (!emailPattern.test(email) || email.length > 160) {
      return Response.json({ error: copy.email }, { status: 400 });
    }
    // 称呼可选：首屏只收邮箱时，回退为邮箱前缀
    if (name && (name.length < 2 || name.length > 80)) {
      return Response.json({ error: copy.name }, { status: 400 });
    }
    if (worldType && worldType !== "undecided" && !worldTypes.has(worldType as never)) {
      return Response.json({ error: copy.direction }, { status: 400 });
    }
    if (selectedWorldId && !selectedWorld) {
      return Response.json({ error: copy.world }, { status: 400 });
    }

    const result = await saveApplication({
      name: name || email.split("@")[0] || copy.visitor,
      email,
      worldType: worldType || "undecided",
      selectedWorldId,
      selectedWorld: selectedWorld?.name,
      locale,
    });

    try {
      await sendApplicationNotification({
        id: result.id!,
        name: name || email.split("@")[0] || copy.visitor,
        email,
        worldType: worldType || "undecided",
        selectedWorld: selectedWorld?.name,
        submittedAt: result.updatedAt,
        created: result.created,
      });
    } catch (error) {
      // The application is already safely stored, so an email outage must not
      // make the visitor believe their submission failed.
      console.error("Failed to send application notification", error);
    }

    return Response.json(
      { ok: true, id: result.id, message: result.created ? copy.created : copy.updated },
      { status: result.created ? 201 : 200 },
    );
  } catch (error) {
    console.error("Failed to save application", error);
    return Response.json({ error: responseCopy[locale].unavailable }, { status: 500 });
  }
}
