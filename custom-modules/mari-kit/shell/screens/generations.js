// 생성 중인 요청: a reply that keeps being written on the server after a reload or leaving the screen; check a chat and
// stop it. The page head, rows and a picker like the other settings screens (the chat list is long).
import { h, setChildren } from "../lib/h.js";
import { data, byLastActivity } from "../lib/data.js";
import { pageHead, toast, errorBox } from "../lib/ui.js";
import { pickPerson } from "../lib/picker.js";
import { watchGeneration, stopGeneration } from "../lib/generation.js";

export function generationsScreen({ mount, args, back }) {
  let alive = true;
  let watcher = null;
  let selected = args[0] || "";
  let stopping = false;
  let active = false;
  let chats = [];
  const chatName = h("span", { class: "val" }, "고르기 ›");
  const chooser = h(
    "button",
    {
      type: "button",
      class: "r two",
      onClick: () =>
        pickPerson({
          title: "채팅",
          key: "pick-gen-chat",
          faces: false,
          items: chats.map((c) => ({ id: c.id, name: c.name || "이름 없음" })),
          selected: selected || null,
          none: null,
          onPick: (v) => v && ((selected = v), choose()),
        }),
    },
    h("span", null, "채팅"),
    chatName,
  );
  const dot = h("span", { class: "sdot offline" });
  const status = h("span", { role: "status", "aria-live": "polite" }, "확인 중…");
  const stop = h(
    "button",
    { type: "button", class: "pill main", disabled: true, style: { minHeight: "44px" }, onClick: cancel },
    "멈추기",
  );
  const refresh = h(
    "button",
    { type: "button", class: "pill", style: { minHeight: "44px" }, onClick: () => watcher?.check() },
    "다시 확인",
  );
  const body = h(
    "div",
    { class: "scroll", style: { padding: "8px 20px 28px", display: "flex", flexDirection: "column", gap: "16px" } },
    h(
      "p",
      { class: "hint", style: { margin: "0" } },
      "새로 고침하거나 화면을 나간 뒤에도 서버에서 계속 쓰고 있는 답장을 확인하고 멈춰요.",
    ),
    h("div", { class: "list" }, chooser, h("div", { class: "r static" }, h("span", { class: "ic" }, dot), status)),
    h("div", { style: { display: "flex", flexWrap: "wrap", gap: "8px" } }, stop, refresh),
  );
  mount.append(pageHead("생성 중인 요청", { label: "설정", back: () => back("settings") }), body);

  function choose() {
    watcher?.dispose();
    chatName.textContent = `${chats.find((c) => c.id === selected)?.name || "고르기"} ›`;
    stopping = false;
    active = false;
    stop.disabled = true;
    status.textContent = selected ? "확인 중…" : "채팅이 없어요.";
    if (!selected) return;
    watcher = watchGeneration(selected, {
      onState: (state) => {
        active = state?.active === true;
        status.textContent = active
          ? stopping
            ? "멈추는 중…"
            : "서버에서 답장을 쓰고 있어요"
          : "쓰고 있는 답장이 없어요";
        dot.className = `sdot ${active ? "online" : "offline"}`;
        stop.disabled = !active || stopping;
        if (!active) stopping = false;
      },
      onError: (error) => {
        status.textContent = `상태를 확인하지 못했어요: ${error.message}`;
      },
    });
  }

  async function cancel() {
    if (!selected || stopping) return;
    const chatId = selected;
    stopping = true;
    stop.disabled = true;
    status.textContent = "멈추는 중…";
    try {
      await stopGeneration(chatId);
      if (alive && selected === chatId) await watcher.check();
    } catch (error) {
      if (alive) toast(`멈추지 못했어요: ${error.message}`);
    } finally {
      if (alive && selected === chatId) {
        stopping = false;
        stop.disabled = !active;
      }
    }
  }

  data
    .chats(true)
    .then((list) => {
      if (!alive) return;
      chats = [...list].sort(byLastActivity);
      if (!chats.some((chat) => chat.id === selected)) selected = chats[0]?.id || "";
      choose();
    })
    .catch((error) => alive && setChildren(body, errorBox(error)));
  return {
    dispose() {
      alive = false;
      watcher?.dispose();
    },
  };
}
