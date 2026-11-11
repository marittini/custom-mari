const root = document.getElementById("app");
const res = await fetch("/api/chats", { credentials: "same-origin" });
const chats = res.ok ? await res.json() : [];
root.textContent = `shell ok · chats ${Array.isArray(chats) ? chats.length : "?"} · ${res.status}`;
