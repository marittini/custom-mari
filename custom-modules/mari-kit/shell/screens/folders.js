// 폴더 관리, in Mari: make, rename, reorder and delete the Engine's folders, and move things into them.
//   #/folders/convo  #/folders/rp      chat folders of that mode (+ 채팅 가져오기)
//   #/folders/connections               connection folders (an account moves with all its models)
//   #/folders/presets  #/folders/lorebooks   library folders
// Everything goes through the Engine's own folder routes; deleting a folder moves what was in it to 폴더 없음.

import { h, setChildren } from "../lib/h.js";
import { api, upload } from "../lib/api.js";
import { data, characterIndex, chatTitle, byBranchGroup } from "../lib/data.js";
import { pageHead, toast, errorBox, hbox, sheet } from "../lib/ui.js";
import { forgetGroups, foldGroup, splitByGroup } from "../lib/groups.js";

const KINDS = {
  convo: { title: "대화 폴더", parent: "convos", chat: "conversation" },
  rp: { title: "작품 폴더", parent: "library", chat: "roleplay" },
  connections: { title: "연결 폴더", parent: "settings/connections" },
  presets: { title: "프리셋 폴더", parent: "settings/presets", library: "presets" },
  lorebooks: { title: "로어북 폴더", parent: "settings", library: "lorebooks" },
};

export function foldersScreen({ mount, args, back }) {
  const kind = KINDS[args[0]] ? args[0] : "convo";
  const k = KINDS[kind];
  let alive = true;
  let folders = [];
  let items = []; // { id, name, folderId, ids: [rows to move] }
  const body = h(
    "div",
    { class: "scroll roomy", style: { padding: "0 20px 40px" } },
    h("div", { class: "empty" }, "불러오는 중…"),
  );
  mount.append(pageHead(k.title, { label: "폴더 관리", back: () => back(k.parent) }), body);

  // The Engine's routes for this kind of folder.
  const base = k.chat
    ? "/chat-folders"
    : kind === "connections"
      ? "/connection-folders"
      : `/library-folders/${k.library}`;
  const groupKind = k.chat ? "chats" : k.library || "connections";

  async function load() {
    try {
      if (k.chat) {
        const [list, chars, chats] = await Promise.all([api.get(base), data.characters(), data.chats(true)]);
        const index = characterIndex(chars);
        folders = list.filter((f) => f.mode === k.chat).sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
        items = byBranchGroup(chats.filter((c) => c.mode === k.chat)).map((c) => ({
          id: c.id,
          name: chatTitle(c, index) + (c.branches.length > 1 ? ` · 분기 ${c.branches.length}` : ""),
          folderId: c.folderId || null,
        }));
      } else if (kind === "connections") {
        const [list, accounts, conns] = await Promise.all([
          api.get(base),
          api.get("/connection-accounts").catch(() => []),
          api.get("/connections"),
        ]);
        folders = list.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
        // An account sits where its models are; moving it moves every model row.
        items = accounts.map((a) => {
          const rows = conns.filter((c) => c.accountId === a.id);
          return {
            id: a.id,
            name: a.name,
            folderId: rows.find((c) => c.folderId)?.folderId || null,
            ids: rows.map((c) => c.id),
          };
        });
        for (const c of conns.filter((c) => !c.accountId))
          items.push({ id: c.id, name: c.name, folderId: c.folderId || null, ids: [c.id] });
      } else {
        const [list, rows] = await Promise.all([
          api.get(base),
          api.get(k.library === "presets" ? "/prompts" : "/lorebooks"),
        ]);
        folders = list.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
        const ids = (v) => (Array.isArray(v) ? v : typeof v === "string" ? JSON.parse(v || "[]") : []);
        items = (Array.isArray(rows) ? rows : rows.items || []).map((r) => ({
          id: r.id,
          name: r.name,
          folderId: folders.find((f) => ids(f.itemIds).includes(r.id))?.id || null,
        }));
      }
      items.sort((a, b) => String(a.name).localeCompare(String(b.name)));
      if (alive) draw();
    } catch (error) {
      if (alive) setChildren(body, errorBox(error));
    }
  }

  const run = async (fn, done) => {
    try {
      await fn();
      forgetGroups(groupKind);
      if (k.chat) await data.chats(true);
      if (done) toast(done);
      await load();
    } catch (error) {
      toast(error.message);
    }
  };

  async function moveTo(item, folderId) {
    if (k.chat) return api.post("/chat-folders/move-chat", { chatId: item.id, folderId });
    if (kind === "connections") {
      for (const id of item.ids) await api.post("/connection-folders/move-connection", { connectionId: id, folderId });
      return;
    }
    return api.post(`${base}/move`, { itemIds: [item.id], folderId });
  }

  function moveSheet(item) {
    const s = sheet(
      h(
        "div",
        { style: { display: "flex", flexDirection: "column", gap: "10px", padding: "6px 0 24px", overflowY: "auto" } },
        h("b", { style: { padding: "0 20px 6px", fontSize: "16px" } }, `${item.name} 옮기기`),
        h(
          "div",
          { class: "list" },
          [...folders.map((f) => [f.id, f.name]), [null, "폴더 없음"]].map(([id, name]) =>
            h(
              "button",
              {
                type: "button",
                class: "r two",
                "aria-pressed": item.folderId === id ? "true" : "false",
                onClick: () => {
                  s.close();
                  if (item.folderId !== id)
                    run(() => moveTo(item, id), id ? `'${name}'로 옮겼어요` : "폴더에서 뺐어요");
                },
              },
              h("span", null, name),
              h("span", { class: "val" }, item.folderId === id ? "지금" : ""),
            ),
          ),
        ),
      ),
      { label: "옮기기" },
    );
  }

  function folderBox(f, i) {
    const name = h("input", { class: "inp", value: f.name, maxlength: 80, "aria-label": "폴더 이름" });
    const count = items.filter((x) => x.folderId === f.id).length;
    const swap = (j) => {
      const order = folders.map((x) => x.id);
      [order[i], order[j]] = [order[j], order[i]];
      // Library folders have no reorder route: each folder keeps its own sortOrder.
      if (k.library)
        return run(() =>
          Promise.all(order.map((id, n) => api.patch(`${base}/${encodeURIComponent(id)}`, { sortOrder: n }))),
        );
      return run(() => api.post(`${base}/reorder`, { orderedIds: order }));
    };
    return hbox(
      `${f.name} · ${count}`,
      h(
        "div",
        { class: "rowform" },
        name,
        h(
          "button",
          {
            type: "button",
            class: "pill",
            onClick: () =>
              name.value.trim() &&
              run(
                () => api.patch(`${base}/${encodeURIComponent(f.id)}`, { name: name.value.trim() }),
                "이름을 바꿨어요",
              ),
          },
          "이름 저장",
        ),
      ),
      h(
        "div",
        { class: "rowform", style: { justifyContent: "space-between" } },
        h(
          "span",
          { style: { display: "flex", gap: "8px" } },
          h("button", { type: "button", class: "pill", disabled: i === 0, onClick: () => swap(i - 1) }, "위로"),
          h(
            "button",
            { type: "button", class: "pill", disabled: i === folders.length - 1, onClick: () => swap(i + 1) },
            "아래로",
          ),
        ),
        h(
          "button",
          {
            type: "button",
            class: "pill",
            onClick: () =>
              confirm(`'${f.name}' 폴더를 지울까요? 안에 있던 ${count}개는 지워지지 않고 '폴더 없음'으로 가요.`) &&
              run(() => api.delete(`${base}/${encodeURIComponent(f.id)}`), "폴더를 지웠어요"),
          },
          "폴더 지우기",
        ),
      ),
    );
  }

  function draw() {
    const name = h("input", { class: "inp", placeholder: "새 폴더 이름", maxlength: 80, "aria-label": "새 폴더 이름" });
    const parts = splitByGroup(
      items,
      folders.map((f) => ({ id: f.id, name: f.name, items: null })),
      {
        folderOf: (x) => x.folderId,
      },
    );
    setChildren(
      body,
      h(
        "div",
        { class: "rowform", style: { padding: "12px 0 8px" } },
        name,
        h(
          "button",
          {
            type: "button",
            class: "pill main",
            onClick: () => {
              if (!name.value.trim()) return toast("폴더 이름을 적어 주세요");
              run(
                () => api.post(base, { name: name.value.trim(), ...(k.chat ? { mode: k.chat } : {}) }),
                "폴더를 만들었어요",
              );
            },
          },
          "폴더 만들기",
        ),
      ),
      folders.length
        ? h(
            "div",
            { style: { display: "flex", flexDirection: "column", gap: "24px", marginTop: "16px" } },
            folders.map(folderBox),
          )
        : h("p", { class: "hint", style: { margin: "8px 0 0" } }, "폴더가 아직 없어요."),
      h("div", { class: "gsec" }, h("span", null, "옮기기"), h("span", null, "눌러서 폴더 고르기")),
      items.length
        ? parts.map((p) =>
            foldGroup(
              h,
              `move-${kind}`,
              p.label || "폴더 없음",
              p.items.length,
              h(
                "div",
                { class: "list" },
                p.items.map((x) =>
                  h(
                    "button",
                    { type: "button", class: "r two", onClick: () => moveSheet(x) },
                    h("span", null, x.name),
                    h("span", { class: "val" }, "옮기기 ›"),
                  ),
                ),
              ),
            ),
          )
        : h("div", { class: "empty" }, "옮길 것이 없어요."),
      k.chat ? importBox() : null,
    );
  }

  // 채팅 가져오기: a SillyTavern / Marinara .jsonl file becomes a new chat of this mode.
  function importBox() {
    const file = h("input", {
      type: "file",
      accept: ".jsonl,application/jsonl,application/json",
      hidden: true,
      onChange: async () => {
        const f = file.files?.[0];
        if (!f) return;
        const form = new FormData();
        form.append("mode", k.chat);
        form.append("file", f, f.name);
        await run(() => upload("/import/st-chat", form), "채팅을 가져왔어요");
        file.value = "";
      },
    });
    return h(
      "div",
      null,
      h("div", { class: "gsec" }, h("span", null, "채팅 가져오기")),
      h(
        "button",
        { type: "button", class: "gcard grow", onClick: () => file.click() },
        h("span", null, ".jsonl 파일 고르기", h("small", null, "실리태번이나 마리나라에서 내보낸 채팅")),
        h("span", { class: "val" }, "고르기 ›"),
      ),
      file,
    );
  }

  load();
  return { dispose: () => (alive = false) };
}
