// 남은 크레딧 설정: how the home receipt shows money, Google Cloud / Vertex accounts (one JSON key file each, any
// number), and which Engine connections with a balance it lists.

import { h, setChildren } from "../lib/h.js";
import { api } from "../lib/api.js";
import { pageHead, toast, errorBox, hbox, openEngine } from "../lib/ui.js";
import { loadCredit, forgetCredit } from "../lib/credit.js";

const sw = (on) => h("span", { class: on ? "sw on" : "sw" }, h("span"));
const field = (label, input, hint) =>
  h("label", { class: "fld flush" }, label, input, hint ? h("span", { class: "hint" }, hint) : null);
const input = (value, attrs = {}) => h("input", { class: "inp", value: value ?? "", ...attrs });

export function creditScreen({ mount, back }) {
  let alive = true;
  let model = null;
  let outside = null; // the Engine's "read outside sites" switch: balances need it
  let list = [];
  const body = h(
    "div",
    { class: "scroll", style: { padding: "0 20px 32px" } },
    h("div", { class: "empty" }, "불러오는 중…"),
  );
  mount.append(pageHead("남은 크레딧", { label: "설정 · 홈 카드", back: () => back("home") }), body);

  async function load(refresh = false) {
    try {
      const [m, accounts, reads] = await Promise.all([
        loadCredit({ refresh }),
        api.get("/connection-accounts").catch(() => []),
        api.get("/app-settings/outside-reads").catch(() => null),
      ]);
      model = m;
      list = Array.isArray(accounts) ? accounts : [];
      outside = reads?.value ?? null;
      if (alive) draw();
    } catch (error) {
      if (alive) setChildren(body, errorBox(error));
    }
  }
  const run = async (fn, done) => {
    try {
      await fn();
      forgetCredit();
      if (done) toast(done);
      await load();
    } catch (error) {
      toast(error.message);
    }
  };
  const patch = (b) => run(() => api.patch("/mari-kit/credit", b));

  function readKeyFile(onText) {
    const file = h("input", { type: "file", accept: ".json,application/json", hidden: true });
    file.addEventListener("change", async () => {
      const f = file.files?.[0];
      file.remove();
      if (!f) return;
      if (f.size > 20000) return toast("JSON 키 파일이 아닌 것 같아요");
      onText(await f.text());
    });
    document.body.append(file);
    file.click();
  }

  function googleBox(g) {
    const name = input(g.name, { "aria-label": "이름" });
    const balance = input(g.balance ?? "", {
      type: "number",
      inputmode: "decimal",
      step: "0.01",
      placeholder: "예: 212.40",
    });
    const total = input(g.total ?? "", { type: "number", inputmode: "decimal", placeholder: "예: 300" });
    const expires = input(g.expires, { type: "date" });
    const lag = input(g.lagHours ?? 24, { type: "number", inputmode: "numeric", min: "0" });
    const save = () =>
      run(
        () =>
          api.patch(`/mari-kit/credit/google/${encodeURIComponent(g.id)}`, {
            name: name.value,
            total: total.value === "" ? null : Number(total.value),
            expires: expires.value,
            lagHours: Number(lag.value || 24),
            // A changed console figure restarts the count from now (minus the console's delay).
            ...(String(balance.value) !== String(g.balance ?? "")
              ? { balance: balance.value === "" ? null : Number(balance.value) }
              : {}),
          }),
        "저장했어요",
      );
    const since = g.since ? new Date(g.since) : null;
    return hbox(
      g.name,
      h("div", { class: "hint", style: { marginBottom: "10px", wordBreak: "break-all" } }, `${g.project} · ${g.email}`),
      g.left !== null
        ? h(
            "div",
            { class: "rcl", style: { fontVariantNumeric: "tabular-nums", marginBottom: "6px" } },
            h("span", null, "지금 남은 금액 (추정)"),
            h("i"),
            h("span", null, `$${g.left.toFixed(2)}`),
          )
        : null,
      g.used !== null && since
        ? h(
            "div",
            { class: "hint", style: { marginBottom: "10px" } },
            `${since.getMonth() + 1}/${since.getDate()} ${since.getHours()}시부터 구글이 센 사용량 약 $${g.used.toFixed(2)}`,
          )
        : null,
      g.unknown?.length
        ? h(
            "div",
            { class: "hint", style: { marginBottom: "10px" } },
            `가격표에 없어 기본값으로 센 모델: ${g.unknown.join(", ")}`,
          )
        : null,
      g.error ? h("div", { class: "hint", style: { marginBottom: "10px", color: "var(--ink)" } }, g.error) : null,
      h(
        "div",
        { style: { display: "flex", flexDirection: "column", gap: "12px" } },
        field("이름", name),
        field(
          "콘솔에 나온 남은 금액 ($)",
          balance,
          "구글 클라우드 콘솔 › 결제 › 크레딧의 남은 금액. 바꾸면 그때부터 다시 세요.",
        ),
        field("총 크레딧 ($)", total, "막대에 쓰여요. 무료 체험은 300"),
        field("만료일", expires),
        field("콘솔이 늦게 반영하는 시간", lag, "콘솔 숫자는 보통 하루쯤 늦어요(24). 그만큼 앞에서부터 세요."),
      ),
      h(
        "div",
        { style: { display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "14px", flexWrap: "wrap" } },
        h(
          "button",
          {
            type: "button",
            class: "pill",
            onClick: () => {
              if (!confirm(`'${g.name}' 계정을 지울까요? 저장한 키 파일도 지워져요.`)) return;
              run(() => api.delete(`/mari-kit/credit/google/${encodeURIComponent(g.id)}`), "지웠어요");
            },
          },
          "지우기",
        ),
        h(
          "button",
          {
            type: "button",
            class: "pill",
            onClick: () =>
              readKeyFile((key) =>
                run(
                  () => api.patch(`/mari-kit/credit/google/${encodeURIComponent(g.id)}`, { key }),
                  "키 파일을 바꿨어요",
                ),
              ),
          },
          "키 파일 바꾸기",
        ),
        h("button", { type: "button", class: "pill main", onClick: save }, "저장"),
      ),
    );
  }

  function draw() {
    const { view, accounts } = model;
    const fx = input(view.fx ?? "", {
      type: "number",
      inputmode: "numeric",
      placeholder: `자동 (오늘 ${Math.round(view.rates.KRW).toLocaleString("ko-KR")})`,
      onChange: (e) => patch({ fx: e.target.value === "" ? null : Number(e.target.value) }),
    });
    const withBalance = list.filter((a) => a.balanceSource);
    const shownBy = new Map(accounts.map((a) => [a.id, a]));
    setChildren(
      body,
      h("div", { class: "gsec" }, h("span", null, "보는 방법")),
      h(
        "div",
        { class: "chips", style: { padding: "0 0 12px" } },
        [
          ["KRW", "원화로"],
          ["USD", "달러로"],
        ].map(([v, label]) =>
          h(
            "button",
            {
              type: "button",
              class: "chip",
              "aria-pressed": view.display === v ? "true" : "false",
              onClick: () => patch({ display: v }),
            },
            label,
          ),
        ),
      ),
      field("1달러 환율 (원)", fx, "비워 두면 하루에 한 번 자동으로 받아요"),
      h("div", { style: { height: "12px" } }),
      field(
        "이보다 적으면 '적음' 표시 ($)",
        input(view.low ?? "", {
          type: "number",
          inputmode: "decimal",
          placeholder: "끄려면 비우기",
          onChange: (e) => patch({ low: e.target.value === "" ? null : Number(e.target.value) }),
        }),
        "계정마다 남은 금액을 달러로 바꿔 비교해요",
      ),

      h(
        "div",
        { class: "gsec" },
        h("span", null, "구글 클라우드 · 버텍스"),
        h("span", null, `${model.google.length}개`),
      ),
      h(
        "p",
        { class: "hint", style: { margin: "0 0 14px", lineHeight: "1.6" } },
        "계정마다 서비스 계정 JSON 키 파일을 하나씩 넣어요. 그 계정에 '모니터링 뷰어' 권한이 있어야 사용량을 읽을 수 있어요(구글 클라우드 콘솔 › IAM). 키 파일은 Mari Kit 서버에만 저장되고 이 화면으로 다시 오지 않아요.",
      ),
      h("div", { style: { display: "flex", flexDirection: "column", gap: "20px" } }, model.google.map(googleBox)),
      h(
        "div",
        { style: { display: "flex", justifyContent: "flex-end", marginTop: "16px" } },
        h(
          "button",
          {
            type: "button",
            class: "pill main",
            onClick: () =>
              readKeyFile((key) => run(() => api.post("/mari-kit/credit/google", { key }), "계정을 추가했어요")),
          },
          "+ JSON 키 파일로 계정 추가",
        ),
      ),

      h("div", { class: "gsec" }, h("span", null, "엔진 연결"), h("span", null, "엔진에 넣은 키로 읽어요")),
      outside !== "on"
        ? h(
            "div",
            { class: "gcard grow", style: { gridTemplateColumns: "minmax(0,1fr) auto", marginBottom: "12px" } },
            h(
              "span",
              { style: { fontSize: "13px", lineHeight: "1.6" } },
              "엔진이 바깥 사이트에서 잔액을 읽는 게 꺼져 있어요. 켜면 엔진이 오픈라우터·나노GPT 같은 사이트에 잔액을 물어봐요.",
            ),
            h(
              "button",
              {
                type: "button",
                class: "pill",
                onClick: () => run(() => api.put("/app-settings/outside-reads", { value: "on" }), "켰어요"),
              },
              "켜기",
            ),
          )
        : null,
      withBalance.length
        ? h(
            "div",
            { class: "gcard" },
            withBalance.map((a) => {
              const on = !view.hidden.includes(a.id);
              const b = shownBy.get(a.id);
              const value = b ? (b.left === null ? b.note : `${b.left.toFixed(2)} ${b.unit}`) : "카드에서 숨김";
              return h(
                "button",
                {
                  type: "button",
                  class: "grow",
                  role: "switch",
                  "aria-checked": on ? "true" : "false",
                  onClick: () => patch({ hidden: on ? [...view.hidden, a.id] : view.hidden.filter((x) => x !== a.id) }),
                },
                h("span", null, a.name, h("small", null, value), b?.notice ? h("small", null, b.notice) : null),
                sw(on),
              );
            }),
            // LinkAPI's account balance needs the dashboard token, entered in the Engine's connection editor.
            withBalance
              .filter((a) => a.balanceSource === "linkapi" && shownBy.get(a.id)?.notice)
              .map((a) =>
                h(
                  "button",
                  { type: "button", class: "grow linkline", onClick: () => openEngine(null, { account: a.id }) },
                  h("span", null, `${a.name} · 대시보드 토큰 넣기`),
                  h("span", null, "엔진 ›"),
                ),
              ),
          )
        : h("p", { class: "hint" }, "잔액을 알려 주는 연결(오픈라우터, 나노GPT, 딥시크, 링크API 등)이 아직 없어요."),
      h(
        "button",
        {
          type: "button",
          class: "grow linkline",
          style: { marginTop: "8px" },
          onClick: () => openEngine(null, { panel: "connections" }),
        },
        h("span", null, "엔진 연결 관리 · 키 넣기"),
        h("span", null, "엔진 ›"),
      ),
      h(
        "p",
        { class: "hint", style: { margin: "16px 0 0", lineHeight: "1.6" } },
        "구글 금액은 토큰 수에 가격을 곱한 추정치라 콘솔과 조금 다를 수 있어요. 가끔 콘솔 숫자로 다시 맞춰 주세요.",
      ),
    );
  }

  load();
  return { dispose: () => (alive = false) };
}
