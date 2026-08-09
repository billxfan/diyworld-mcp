import { saveApplication } from "@/lib/applications";
import { sendApplicationNotification } from "@/lib/email";
import { worldTypes, worlds } from "@/lib/worlds";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const officialWorlds = new Map(worlds.map((world) => [world.id, world]));

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const worldType = typeof body.worldType === "string" ? body.worldType.trim() : "";
    const selectedWorldId = typeof body.selectedWorldId === "string" ? body.selectedWorldId : undefined;
    const selectedWorld = selectedWorldId ? officialWorlds.get(selectedWorldId) : undefined;

    if (!emailPattern.test(email) || email.length > 160) {
      return Response.json({ error: "请填写有效的邮箱地址。" }, { status: 400 });
    }
    // 称呼可选：首屏只收邮箱时，回退为邮箱前缀
    if (name && (name.length < 2 || name.length > 80)) {
      return Response.json({ error: "请填写 2–80 个字符的称呼。" }, { status: 400 });
    }
    if (worldType && worldType !== "undecided" && !worldTypes.has(worldType as never)) {
      return Response.json({ error: "请选择一个想探索的方向。" }, { status: 400 });
    }
    if (selectedWorldId && !selectedWorld) {
      return Response.json({ error: "所选世界不存在。" }, { status: 400 });
    }

    const result = await saveApplication({
      name: name || email.split("@")[0] || "访客",
      email,
      worldType: worldType || "undecided",
      selectedWorldId,
      selectedWorld: selectedWorld?.name,
      locale: body.locale === "en" ? "en" : "zh",
    });

    try {
      await sendApplicationNotification({
        id: result.id,
        name: name || email.split("@")[0] || "访客",
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
      { ok: true, id: result.id, message: result.created ? "已收到，我们会通过邮箱与你联系。" : "信息已更新，我们会通过邮箱与你联系。" },
      { status: result.created ? 201 : 200 },
    );
  } catch (error) {
    console.error("Failed to save application", error);
    return Response.json({ error: "暂时无法提交，请稍后再试。" }, { status: 500 });
  }
}
