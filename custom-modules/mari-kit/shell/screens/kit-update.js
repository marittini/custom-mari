// 설정 › Mari Kit 업데이트: check the catalog, install the new version, restart the Engine, reload — all in Mari.
// The Engine's own routes (/capability-packages): installing needs the Engine's admin access (on the same phone
// it is allowed; from another device the Engine may ask for its admin secret), and Mari Kit changes take effect
// only after the Engine restarts (restartRequired).

import { h, setChildren } from "../lib/h.js";
import { api } from "../lib/api.js";
import { toast, ask } from "../lib/ui.js";

const ID = "mari-kit";

/** { running, installed, latest, pending, restartNeeded } — what the settings row and page show. */
export async function kitStatus() {
  const [installed, pending] = await Promise.all([
    api.get("/capability-packages/installed").catch(() => []),
    api.get("/capability-packages/updates/pending").catch(() => null),
  ]);
  const me = (Array.isArray(installed) ? installed : []).find((p) => p.id === ID) || null;
  const update = (Array.isArray(pending) ? pending : []).find((p) => p.id === ID) || null;
  const restartNeeded = me?.status === "restart-required";
  return {
    running: restartNeeded ? me?.previousVersion || "" : me?.version || "",
    installed: me?.version || "",
    update,
    restartNeeded,
    checked: pending !== null,
  };
}

export function kitUpdatePage(body) {
  const box = h("div", { style: { display: "flex", flexDirection: "column", gap: "20px", padding: "8px 20px 28px" } });
  setChildren(body, box);
  const line = (label, value) =>
    h(
      "div",
      { class: "r two static", style: { minHeight: "52px" } },
      h("span", null, label),
      h("span", { class: "val", style: { fontVariantNumeric: "tabular-nums" } }, value),
    );
  const note = (text) => h("p", { class: "hint", style: { margin: "0", fontSize: "14px", lineHeight: "1.6" } }, text);
  const big = (text, onClick, main = true) =>
    h(
      "button",
      { type: "button", class: main ? "pill main" : "pill", style: { minHeight: "48px", width: "100%" }, onClick },
      text,
    );

  async function draw(message) {
    setChildren(box, note("확인하는 중…"));
    const s = await kitStatus();
    setChildren(
      box,
      h(
        "div",
        { class: "list" },
        line("지금 쓰는 버전", s.running || "알 수 없음"),
        s.restartNeeded ? line("설치됨 · 다시 시작 후 적용", s.installed) : null,
        line("새 버전", s.update ? s.update.version : s.checked ? "없음 · 최신이에요" : "확인하지 못했어요"),
      ),
      message ? note(message) : null,
      s.update?.releaseHighlight ? note(`바뀐 점: ${s.update.releaseHighlight}`) : null,
      s.update
        ? big(`${s.update.version}(으)로 업데이트`, () => install(s.update))
        : s.restartNeeded
          ? [note("새 버전이 설치됐어요. 엔진을 다시 시작하면 적용돼요."), big("엔진 다시 시작", restart)]
          : null,
      big("다시 확인", () => draw(), false),
      note("새 버전은 올린 뒤 몇 분(최대 약 5분) 지나야 보여요."),
    );
  }

  async function install(update) {
    if (
      !(await ask(`Mari Kit ${update.version}을 설치할까요? 설치한 뒤 엔진을 다시 시작해야 적용돼요.`, { ok: "설치" }))
    )
      return;
    setChildren(box, note("설치하는 중…"));
    try {
      const res = await api.post(`/capability-packages/${ID}/install`, {
        expectedVersion: update.version,
        expectedArtifactSha256: update.artifactSha256,
      });
      if (res?.status === "restart-required") {
        if (await ask("설치했어요. 지금 엔진을 다시 시작할까요? 진행 중인 답장이 있으면 끊겨요.", { ok: "다시 시작" }))
          return restart();
        return draw("설치했어요. 엔진을 다시 시작하면 적용돼요.");
      }
      toast("업데이트했어요");
      location.reload();
    } catch (error) {
      if (error.status === 409) return draw("목록이 그새 바뀌었어요. 다시 확인한 뒤 눌러 주세요.");
      if (error.status === 403 || error.status === 421)
        return draw(
          "이 기기에서는 엔진이 설치를 허락하지 않았어요(엔진 관리자 비밀번호가 필요해요). 엔진 화면 › 에이전트에서 업데이트해 주세요.",
        );
      draw(`설치하지 못했어요: ${error.message}`);
    }
  }

  async function restart() {
    setChildren(box, note("엔진을 다시 시작하는 중…"));
    try {
      await api.post("/admin/restart", { confirm: true });
    } catch (error) {
      if (error.status === 409)
        return draw(
          "이 엔진은 Mari에서 다시 시작할 수 없게 켜져 있어요. Termux에서 엔진을 끄고(Ctrl+C) 다시 켠 뒤 이 화면을 새로 고침해 주세요.",
        );
      if (error.status === 403 || error.status === 421)
        return draw("엔진이 다시 시작을 허락하지 않았어요. 엔진을 직접 껐다 켜 주세요.");
      return draw(`다시 시작하지 못했어요: ${error.message}`);
    }
    // Wait for the Engine to come back, then load the new Mari.
    const started = Date.now();
    await new Promise((r) => setTimeout(r, 3000));
    while (Date.now() - started < 120000) {
      try {
        await api.get("/health");
        return location.reload();
      } catch {}
      await new Promise((r) => setTimeout(r, 2000));
    }
    draw("엔진이 아직 켜지지 않았어요. 잠시 뒤 이 화면을 새로 고침해 주세요.");
  }

  draw();
}
