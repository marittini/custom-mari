import { h, setChildren } from "../lib/h.js";
import { data, byLastActivity } from "../lib/data.js";
import { topBar, toast, errorBox } from "../lib/ui.js";
import { watchGeneration, stopGeneration } from "../lib/generation.js";

export function generationsScreen({ mount, args, back }) {
  let alive = true;
  let watcher = null;
  let selected = args[0] || "";
  let stopping = false;
  let active = false;
  const select = h("select", { class: "inp", "aria-label": "요청을 확인할 채팅", onChange: choose });
  const status = h("div", { role: "status", "aria-live": "polite" }, "확인 중…");
  const stop = h("button", { type: "button", class: "pill main", disabled: true, onClick: cancel }, "요청 중단");
  const refresh = h("button", { type: "button", class: "pill", onClick: () => watcher?.check() }, "상태 새로고침");
  const body = h(
    "div",
    { class: "scroll", style: { padding: "20px", display: "flex", flexDirection: "column", gap: "16px" } },
    h("p", { class: "hint" }, "새로고침하거나 화면을 나간 뒤에도 계속되는 생성 요청을 확인하고 중단합니다."),
    h("label", { class: "fld" }, "채팅", select),
    status,
    h("div", { style: { display: "flex", flexWrap: "wrap", gap: "8px" } }, refresh, stop),
  );
  mount.append(topBar({ title: "생성 요청 관리", back: () => back("settings") }), body);

  function choose() {
    watcher?.dispose();
    selected = select.value;
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
            ? "중단 처리 중…"
            : "서버에서 생성 작업이 진행 중입니다."
          : "진행 중인 생성 요청이 없습니다.";
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
    status.textContent = "중단 요청 중…";
    try {
      await stopGeneration(chatId);
      if (alive && selected === chatId) await watcher.check();
    } catch (error) {
      if (alive) toast(`중단하지 못했어요: ${error.message}`);
    } finally {
      if (alive && selected === chatId) {
        stopping = false;
        stop.disabled = !active;
      }
    }
  }

  data
    .chats(true)
    .then((chats) => {
      if (!alive) return;
      const rows = [...chats].sort(byLastActivity);
      setChildren(
        select,
        rows.map((chat) => h("option", { value: chat.id }, chat.name || chat.id)),
      );
      select.value = rows.some((chat) => chat.id === selected) ? selected : rows[0]?.id || "";
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
