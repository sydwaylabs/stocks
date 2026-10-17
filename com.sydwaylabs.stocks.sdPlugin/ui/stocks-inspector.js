// Shared by every Stocks inspector: the Finnhub key section, the "Search…" button and the name
// line under the symbol. Each page includes the markup (ids below) and then this script.
// Every message to the plugin carries an `event` discriminator.
document.addEventListener("DOMContentLoaded", () => {
  const client = SDPIComponents.streamDeckClient;
  const send = (payload) => client.send("sendToPlugin", payload);
  const byId = (id) => document.getElementById(id);

  // The name search stored, shown under the symbol field (only where the page has one).
  const showName = (settings) => {
    const line = byId("symbolName");
    if (line) line.textContent = settings?.name ?? "";
  };
  client.getSettings().then((info) => showName(info?.payload?.settings)).catch(() => {});
  client.didReceiveSettings.subscribe((info) => showName(info?.payload?.settings));

  byId("search")?.addEventListener("click", () => send({ event: "search" }));

  const status = byId("keyStatus");
  client.sendToPropertyInspector.subscribe((ev) => {
    const p = ev?.payload;
    if (p?.event !== "keyStatus" || !status) return;
    const base = p.hasKey
      ? "Key saved (" + p.hint + "). Finnhub is used where it covers the symbol; Yahoo fills in the rest."
      : "Without a key, quotes come from Yahoo Finance.";
    status.textContent = p.message ? p.message + " " + (p.ok ? "" : base) : base;
    status.className = "hint" + (p.ok === false ? " bad" : p.ok === true ? " good" : "");
  });
  send({ event: "getKeyStatus" });

  byId("signup")?.addEventListener("click", () => send({ event: "openSignup" }));
  byId("saveKey")?.addEventListener("click", () => {
    // An unbound sdpi-password still exposes its input; read the property, then the input.
    const field = byId("fhKey");
    const input = field?.shadowRoot?.querySelector("input");
    const key = String(field?.value || input?.value || "").trim();
    if (!key) return;
    status.textContent = "Checking the key with Finnhub…";
    status.className = "hint";
    send({ event: "setFinnhubKey", key });
    if (field) field.value = "";
    if (input) input.value = "";
  });
  byId("removeKey")?.addEventListener("click", () => send({ event: "setFinnhubKey", key: "" }));
});
