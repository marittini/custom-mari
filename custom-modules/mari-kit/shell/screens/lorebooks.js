// 설정 › 로어북 (#/settings/lorebooks): the Engine's lorebook library (LorebooksPanel) in the shell's look —
// category tabs, search, its library folders as folding groups, a switch on each book, 새 로어북. Read a page at a
// time from the Engine's paged list (GET /lorebooks?limit=…), searched and filtered on the Engine's side.

import { h, setChildren } from "../lib/h.js";
import { api } from "../lib/api.js";
import { toast, errorBox, openEngine } from "../lib/ui.js";
import { groupsOf, splitByGroup, sectioned } from "../lib/groups.js";
import { CATEGORIES } from "../lib/lorebooks.js";

const PAGE = 50;
const sw = (on) => h("span", { class: on ? "sw on" : "sw" }, h("span"));
const flag = (v, def) => (v === undefined || v === null ? def : v === true || v === "true");
const catName = Object.fromEntries(CATEGORIES);

export function lorebooksPage(body, go) {
  let category = "";
  let query = "";
  let items = [];
  let more = false;
  let folders = [];
  let seq = 0;
  const listBox = h("div", null, h("div", { class: "empty" }, "불러오는 중…"));

  async function load(reset = true) {
    const mine = ++seq;
    const offset = reset ? 0 : items.length;
    const q = new URLSearchParams({ limit: String(PAGE), offset: String(offset), sort: "name-asc" });
    if (query.trim()) q.set("search", query.trim());
    if (category) q.set("category", category);
    try {
      const [page, groups] = await Promise.all([api.get(`/lorebooks?${q}`), groupsOf("lorebooks")]);
      if (mine !== seq) return;
      folders = groups;
      const got = Array.isArray(page) ? page : page?.items || [];
      items = reset ? got : [...items, ...got];
      more = !Array.isArray(page) && page?.hasMore === true;
      drawList();
    } catch (error) {
      if (mine === seq) setChildren(listBox, errorBox(error));
    }
  }

  async function setEnabled(b, on) {
    try {
      await api.patch(`/lorebooks/${encodeURIComponent(b.id)}`, { enabled: on });
      b.enabled = on;
      drawList();
    } catch (error) {
      toast(error.message);
    }
  }
  function bookRow(b) {
    const on = flag(b.enabled, true);
    const sub = [catName[b.category] || "분류 없음", flag(b.isGlobal, false) ? "전역" : ""].filter(Boolean).join(" · ");
    return h(
      "div",
      { class: "r lore-row" },
      h(
        "button",
        { type: "button", class: "lore-open", onClick: () => go(`edit/lorebook/${encodeURIComponent(b.id)}`) },
        h("span", { class: on ? "lore-name" : "lore-name off" }, b.name || "이름 없음"),
        h("small", null, sub),
      ),
      h(
        "button",
        {
          type: "button",
          class: "lore-sw",
          role: "switch",
          "aria-checked": on ? "true" : "false",
          "aria-label": `${b.name || "로어북"} 사용`,
          onClick: () => setEnabled(b, !on),
        },
        sw(on),
      ),
    );
  }
  function drawList() {
    setChildren(
      listBox,
      items.length
        ? sectioned(h, splitByGroup(items, folders), bookRow, "lorebooks")
        : h("div", { class: "empty" }, query || category ? "찾는 로어북이 없어요" : "아직 로어북이 없어요"),
      more ? h("button", { type: "button", class: "pill lore-more", onClick: () => load(false) }, "더 보기") : null,
    );
  }

  async function create() {
    try {
      const made = await api.post("/lorebooks", { name: "새 로어북", category: category || "uncategorized" });
      go(`edit/lorebook/${encodeURIComponent(made.id)}`);
    } catch (error) {
      toast(error.message);
    }
  }

  let timer = null;
  const tabs = h("div", { class: "ed-chiprow lore-cats", role: "radiogroup", "aria-label": "분류" });
  const drawTabs = () =>
    setChildren(
      tabs,
      [["", "전체"], ...CATEGORIES].map(([v, t]) =>
        h(
          "button",
          {
            type: "button",
            class: category === v ? "chip on" : "chip",
            role: "radio",
            "aria-checked": category === v ? "true" : "false",
            onClick: () => {
              category = v;
              drawTabs();
              load();
            },
          },
          t,
        ),
      ),
    );
  drawTabs();
  setChildren(
    body,
    h(
      "div",
      { class: "lore-tools" },
      h("input", {
        class: "inp",
        type: "search",
        placeholder: "이름·설명·태그",
        "aria-label": "로어북 검색",
        onInput: (e) => {
          query = e.target.value;
          clearTimeout(timer);
          timer = setTimeout(() => load(), 300);
        },
      }),
      tabs,
    ),
    listBox,
    h(
      "div",
      { class: "lore-acts" },
      h("button", { type: "button", class: "pill main", onClick: create }, "새 로어북"),
      h("button", { type: "button", class: "pill", onClick: () => go("folders/lorebooks") }, "폴더 관리"),
      h(
        "button",
        { type: "button", class: "pill", onClick: () => openEngine(null, { panel: "lorebooks" }) },
        "가져오기 · 엔진",
      ),
    ),
  );
  load();
}
