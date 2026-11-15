// The Convo media panel (the Engine's ConversationMediaPickerPanel): one ☺ button opens it where the keyboard was,
// with tabs for emoji (search, recents, the Engine's categories, ★ the chat's custom emojis), kaomoji and stickers.
// Emoji and kaomoji go in at the caret and the panel stays open for more; a sticker asks "메시지에 넣기 / 바로
// 보내기" like the Engine. Recents are shared with the Engine (lib/media.js). Loaded the first time ☺ is tapped.

import { h, setChildren } from "./h.js";
import { sheet } from "./ui.js";
import { emojiData, readRecents, rememberRecent } from "./media.js";

const TABS = [
  ["emoji", "이모지"],
  ["kaomoji", "카오모지"],
  ["sticker", "스티커"],
];
const KAOMOJI_KO = {
  happy: "기쁨",
  love: "사랑",
  sad: "슬픔",
  angry: "화남",
  surprised: "놀람",
  shrug: "으쓱",
  cute: "귀여움",
};
const CATEGORY_KO = {
  "Smileys & Emotion": "표정",
  "People & Body": "사람",
  "Animals & Nature": "동물·자연",
  "Food & Drink": "음식",
  "Travel & Places": "여행·장소",
  Activities: "활동",
  Objects: "물건",
  Symbols: "기호",
  Flags: "깃발",
};
let lastTab = "emoji";
let lastCategory = null;
let lastKaomoji = null;

/**
 * media({ refresh }) → { stickers: {list, map}, emojis: {list, map} } for this chat (refresh reads them again).
 * onInsert(text): put text at the caret. onSticker(name, how): how = "insert" | "send". manage(kind): open the
 * sticker or emoji manager (resolves when it closes).
 */
export function mediaPanel({ media, onInsert, onSticker, manage, games = null, onGame = null, tabs: only = null }) {
  const el = h("div", { class: "mpanel", role: "dialog", "aria-label": "이모지와 스티커", hidden: true });
  const tabsEl = h("div", { class: "mp-tabs", role: "tablist" });
  const body = h("div", { class: "mp-body" });
  el.append(tabsEl, body);
  let data = null;
  let failed = "";
  let custom = { stickers: { list: [] }, emojis: { list: [] } };
  let query = "";
  let search;
  let gameList = [];

  const loadAll = async (fresh = false) => {
    try {
      const [d, m, g] = await Promise.all([
        data ? data : emojiData(),
        media({ refresh: fresh }),
        games ? games().catch(() => []) : [],
      ]);
      data = d;
      custom = m || custom;
      gameList = g || [];
      failed = "";
    } catch (error) {
      failed = error.message || "불러오지 못했어요";
    }
    if (!el.hidden) draw();
  };

  const pick = (kind, item, text) => {
    rememberRecent(kind, item);
    onInsert(text);
  };
  const emojiBtn = (e) =>
    h("button", { type: "button", class: "mp-e", "aria-label": e, onClick: () => pick("emoji", { value: e }, e) }, e);
  const customBtn = (c) =>
    h(
      "button",
      {
        type: "button",
        class: "mp-e",
        "aria-label": `:${c.name}:`,
        title: `:${c.name}: · ${c.source || ""}`,
        onClick: () => pick("emoji", { value: `:${c.name}:`, label: `:${c.name}:`, previewUrl: c.url }, `:${c.name}:`),
      },
      h("img", { src: c.url, alt: c.name, loading: "lazy" }),
    );
  const recentEmoji = (r) =>
    r.previewUrl && /^:[a-z0-9_]+:$/i.test(r.value)
      ? customBtn({ name: r.value.slice(1, -1), url: r.previewUrl })
      : emojiBtn(r.value);
  const searchBox = (placeholder) => {
    search = h("input", {
      class: "inp mp-search",
      type: "search",
      placeholder,
      "aria-label": placeholder,
      value: query,
      onInput: (e) => {
        query = e.target.value;
        draw();
        search.focus();
      },
    });
    return search;
  };
  const label = (t) => h("span", { class: "mp-cap" }, t);
  const manageBtn = (kind, text) =>
    h(
      "button",
      {
        type: "button",
        class: "pill mp-manage",
        onClick: async () => {
          await manage(kind);
          loadAll(true);
        },
      },
      text,
    );

  function emojiTab() {
    const q = query.trim();
    const mine = custom.emojis?.list || [];
    if (q) {
      const ql = q.toLowerCase();
      const hits = [];
      for (const c of data.EMOJI_CATEGORIES)
        for (const e of c.emojis) if (hits.length < 160 && data.matchesEmojiQuery(q, e)) hits.push(e);
      const own = mine.filter((c) => c.name.toLowerCase().includes(ql));
      return [
        searchBox("이모지 찾기 (영어)"),
        own.length || hits.length
          ? h("div", { class: "mp-grid" }, own.map(customBtn), hits.map(emojiBtn))
          : h("div", { class: "empty" }, "찾은 이모지가 없어요"),
      ];
    }
    const recent = readRecents().emoji;
    const cats = [
      ...(mine.length ? [{ id: "★", label: "내 이모지", icon: "★" }] : []),
      ...data.EMOJI_CATEGORIES.map((c) => ({ id: c.label, label: CATEGORY_KO[c.label] || c.label, icon: c.icon })),
    ];
    if (!cats.some((c) => c.id === lastCategory)) lastCategory = data.EMOJI_CATEGORIES[0]?.label;
    const current = data.EMOJI_CATEGORIES.find((c) => c.label === lastCategory);
    return [
      searchBox("이모지 찾기 (영어)"),
      recent.length ? [label("최근"), h("div", { class: "mp-grid" }, recent.map(recentEmoji))] : null,
      h(
        "div",
        { class: "mp-cats", role: "tablist", "aria-label": "이모지 분류" },
        cats.map((c) =>
          h(
            "button",
            {
              type: "button",
              role: "tab",
              class: c.id === lastCategory ? "on" : null,
              "aria-selected": c.id === lastCategory ? "true" : "false",
              "aria-label": c.label,
              title: c.label,
              onClick: () => ((lastCategory = c.id), draw()),
            },
            c.icon,
          ),
        ),
      ),
      lastCategory === "★"
        ? [
            h("div", { class: "mp-grid" }, mine.map(customBtn)),
            h(
              "div",
              { class: "mp-foot" },
              manageBtn("selection", "캐릭터 고르는 방식"),
              manageBtn("emoji", "내 이모지 관리 ›"),
            ),
          ]
        : [
            label(CATEGORY_KO[current?.label] || current?.label || ""),
            h("div", { class: "mp-grid" }, (current?.emojis || []).map(emojiBtn)),
            mine.length ? null : h("div", { class: "mp-foot" }, manageBtn("emoji", "내 이모지 올리기 ›")),
          ],
    ];
  }

  function kaomojiTab() {
    const q = query.trim();
    const btn = (k) =>
      h(
        "button",
        { type: "button", class: "mp-k", onClick: () => pick("kaomoji", { value: k.value }, k.value) },
        k.value,
      );
    if (q) {
      const hits = data.searchKaomoji(q);
      return [
        searchBox("카오모지 찾기 (영어)"),
        hits.length ? h("div", { class: "mp-kgrid" }, hits.map(btn)) : h("div", { class: "empty" }, "찾은 게 없어요"),
      ];
    }
    const recent = readRecents().kaomoji;
    if (!data.KAOMOJI_CATEGORIES.some((c) => c.id === lastKaomoji)) lastKaomoji = data.KAOMOJI_CATEGORIES[0]?.id;
    const current = data.KAOMOJI_CATEGORIES.find((c) => c.id === lastKaomoji);
    return [
      searchBox("카오모지 찾기 (영어)"),
      recent.length
        ? [
            label("최근"),
            h(
              "div",
              { class: "mp-kgrid" },
              recent.map((r) => btn({ value: r.value })),
            ),
          ]
        : null,
      h(
        "div",
        { class: "chips mp-kcats", role: "tablist", "aria-label": "카오모지 분류" },
        data.KAOMOJI_CATEGORIES.map((c) =>
          h(
            "button",
            {
              type: "button",
              role: "tab",
              class: c.id === lastKaomoji ? "chip on" : "chip",
              "aria-selected": c.id === lastKaomoji ? "true" : "false",
              onClick: () => ((lastKaomoji = c.id), draw()),
            },
            KAOMOJI_KO[c.id] || c.label,
          ),
        ),
      ),
      h("div", { class: "mp-kgrid" }, (current?.items || []).map(btn)),
    ];
  }

  function stickerTab() {
    const q = query.trim().toLowerCase();
    const list = (custom.stickers?.list || []).filter((s) => !q || s.name.includes(q));
    const choose = (s) => {
      const box = h("div", { class: "psheet pad" });
      const sh = sheet(box, { label: "스티커" });
      const go = (how) => {
        sh.close();
        rememberRecent("sticker", { value: s.name, label: s.name, previewUrl: s.url });
        onSticker(s.name, how);
      };
      setChildren(
        box,
        h("div", { class: "mp-stk-pre" }, h("img", { src: s.url, alt: s.name }), h("b", null, s.name)),
        h(
          "div",
          { class: "scn-acts" },
          h("button", { type: "button", class: "pill", onClick: () => go("insert") }, "메시지에 넣기"),
          h("button", { type: "button", class: "pill main", onClick: () => go("send") }, "바로 보내기"),
        ),
        h("p", { class: "hint", style: { margin: "0" } }, "바로 보내면 캐릭터가 이 스티커에 답해요."),
      );
    };
    const tile = (s) =>
      h(
        "button",
        { type: "button", class: "mp-s", "aria-label": s.name, title: s.name, onClick: () => choose(s) },
        h("img", { src: s.url, alt: s.name, loading: "lazy" }),
      );
    const byName = new Map((custom.stickers?.list || []).map((s) => [s.name, s]));
    const recent = q
      ? []
      : readRecents()
          .sticker.map((r) => byName.get(r.value))
          .filter(Boolean);
    return [
      searchBox("스티커 찾기"),
      recent.length ? [label("최근"), h("div", { class: "mp-sgrid" }, recent.map(tile))] : null,
      list.length
        ? h("div", { class: "mp-sgrid" }, list.map(tile))
        : h("div", { class: "empty" }, q ? "찾은 스티커가 없어요" : "스티커가 아직 없어요"),
      h(
        "div",
        { class: "mp-foot" },
        manageBtn("selection", "캐릭터 고르는 방식"),
        manageBtn("sticker", "스티커 관리 ›"),
      ),
    ];
  }

  // 게임: only when a turn-game package is installed; a pick goes to the Engine (its board lives there).
  function gameTab() {
    return [
      h("p", { class: "hint", style: { margin: "0" } }, "게임판은 엔진 화면에서 열려요. 처음 열 때 몇 MB를 받아요."),
      h(
        "div",
        { class: "list" },
        gameList.map((g) =>
          h(
            "button",
            { type: "button", class: "r", onClick: () => onGame?.(g) },
            h("span", null, g.name, h("small", { class: "hint", style: { display: "block" } }, g.command)),
            h("span", { class: "val" }, "엔진에서 ›"),
          ),
        ),
      ),
    ];
  }

  function draw() {
    // only: the tabs a host wants (a call takes emoji and kaomoji; its lines are spoken, not pictures).
    const base = only ? TABS.filter(([id]) => only.includes(id)) : TABS;
    const tabs = gameList.length && !only ? [...base, ["game", "게임"]] : base;
    if (!tabs.some(([id]) => id === lastTab)) lastTab = "emoji";
    tabsEl.style.gridTemplateColumns = `repeat(${tabs.length}, minmax(0, 1fr))`;
    tabsEl.hidden = tabs.length < 2; // one tab (the reaction picker) needs no tab row
    setChildren(
      tabsEl,
      tabs.map(([id, text]) =>
        h(
          "button",
          {
            type: "button",
            role: "tab",
            class: id === lastTab ? "on" : null,
            "aria-selected": id === lastTab ? "true" : "false",
            onClick: () => ((lastTab = id), (query = ""), draw(), (body.scrollTop = 0)),
          },
          text,
        ),
      ),
    );
    if (failed)
      return setChildren(
        body,
        h(
          "div",
          { class: "empty" },
          `불러오지 못했어요: ${failed}`,
          h("button", { type: "button", class: "pill", onClick: () => loadAll(true) }, "다시 시도"),
        ),
      );
    if (!data) return setChildren(body, h("div", { class: "empty" }, "불러오는 중…"));
    setChildren(
      body,
      lastTab === "emoji"
        ? emojiTab()
        : lastTab === "kaomoji"
          ? kaomojiTab()
          : lastTab === "game"
            ? gameTab()
            : stickerTab(),
    );
  }

  return {
    el,
    get open() {
      return !el.hidden;
    },
    show() {
      el.hidden = false;
      draw();
      if (!data) loadAll();
    },
    hide() {
      el.hidden = true;
      query = "";
    },
    /** Read the chat's stickers and emojis again (after the chat or its cast changed). */
    reload: () => loadAll(true),
  };
}
