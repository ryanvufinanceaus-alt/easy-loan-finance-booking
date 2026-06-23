// Standalone "Update EasyFlow from live Infinity/AOL" review window. Opened by the popup with ?case=<id>.
// Reads the broker token + API base from chrome.storage.local, shows the diff as a wide table, applies the
// ticked changes to the versioned overlay, then auto re-prepares so a Start uses the new data.
(function () {
  const params = new URLSearchParams(location.search);
  const caseId = params.get("case") || "";
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  let token = null, apiBase = "https://booking.easyloanfinance.com.au/infinity-aol", diffs = [];

  function setSub(t) { $("sub").textContent = t; }

  function render() {
    if (!diffs.length) { $("body").innerHTML = '<div class="muted">EasyFlow already matches the captured Infinity/AOL data — nothing to update.<br>(Data is captured when you run Start or generate a document.)</div>'; return; }
    let html = '<table><thead><tr><th></th><th>Field</th><th>EasyFlow</th><th></th><th>Live Infinity / AOL</th></tr></thead><tbody>';
    diffs.forEach((d, i) => {
      html += `<tr><td class="ck"><input type="checkbox" class="ck" data-i="${i}" checked></td>`
        + `<td class="sec">${esc(d.section)}<br><span class="muted">${esc(d.label)}</span></td>`
        + `<td class="old">${esc(d.easyflow) || "—"}</td>`
        + `<td class="arrow">→</td>`
        + `<td class="new">${esc(d.live)}</td></tr>`;
    });
    html += "</tbody></table>";
    $("body").innerHTML = html;
    $("apply").style.display = "inline-block";
  }

  // Read-only sweep of every Infinity tab (Client Details, Financials, Loans & Products, SOCA) so the diff is
  // current. You'll see the Infinity tab switch through the tabs — it only READS, never fills.
  async function sweepLiveData() {
    try {
      const tabs = await chrome.tabs.query({});
      const inf = tabs.find((t) => /infynity|infinity/i.test(t.url || ""));
      if (!inf) { window._noInfinityTab = true; return; }   // can't read live data without an Infinity tab
      setSub("Scanning all Infinity tabs (read-only)…");
      const scraped = await chrome.tabs.sendMessage(inf.id, { type: "EF_FULL_CAPTURE", full: true }).catch(() => null);
      // `swept` is only returned by the NEW content script. If absent, the Infinity tab still runs an OLD
      // script — tell the broker to reload that tab (we do NOT auto-reload: reloading an Infinity account URL
      // drops the account context and lands on the generic dashboard).
      if (!scraped || scraped.swept === undefined) window._needTabReload = true;
      if (scraped && scraped.ok && scraped.snapshot) {
        await fetch(`${apiBase}/api/cases/${encodeURIComponent(caseId)}/live-snapshot`, {
          method: "POST", headers: { "Content-Type": "application/json", "x-easyflow-broker-token": token },
          body: JSON.stringify(scraped.snapshot)
        }).catch(() => {});
      }
    } catch (_e) { /* use captures already on file */ }
  }
  async function load(skipSweep) {
    if (!caseId) { $("body").innerHTML = '<div class="muted">No case selected.</div>'; return; }
    if (!skipSweep) await sweepLiveData();
    setSub("Reading changes…");
    try {
      const r = await fetch(`${apiBase}/api/cases/${encodeURIComponent(caseId)}/reverse-sync`, { headers: { "x-easyflow-broker-token": token } });
      const j = await r.json().catch(() => ({}));
      diffs = (j && j.diffs) || [];
    } catch (_e) { $("body").innerHTML = '<div class="muted">Could not read changes.</div>'; return; }
    setSub(diffs.length ? `${diffs.length} change(s) found — tick the ones to apply.` : "No changes.");
    render();
    const banner = (bg, bd, fg, html) => $("body").insertAdjacentHTML("afterbegin",
      `<div style="margin:0 0 10px;padding:9px 12px;background:${bg};border:1px solid ${bd};border-radius:8px;color:${fg};font-size:12.5px;">${html}</div>`);
    if (window._noInfinityTab) {
      banner("#fef2f2", "#fecaca", "#991b1b", "⚠ No Infinity tab is open, so live data could not be read — this shows the last captured data. <b>Open the case in Infinity</b> (in a browser tab), then click Sync again.");
    } else if (window._needTabReload) {
      banner("#fff7ed", "#fed7aa", "#9a3412", "⚠ The Infinity tab is running an older version, so it did <b>not</b> scan all tabs. Reload the Infinity tab (press <b>F5</b>) and click Sync again.");
    }
  }

  async function apply() {
    const fields = {};
    document.querySelectorAll("input.ck:checked").forEach((c) => { const d = diffs[Number(c.getAttribute("data-i"))]; if (d) fields[d.key] = d.value; });
    if (!Object.keys(fields).length) { setSub("Nothing ticked."); return; }
    $("apply").disabled = true; setSub("Applying…");
    try {
      const r = await fetch(`${apiBase}/api/cases/${encodeURIComponent(caseId)}/reverse-sync/apply`, {
        method: "POST", headers: { "Content-Type": "application/json", "x-easyflow-broker-token": token },
        body: JSON.stringify({ fields })
      });
      if (!r.ok) { setSub("Apply failed (" + r.status + ")."); $("apply").disabled = false; return; }
      // Re-prepare so Start uses the updated data immediately.
      await fetch(`${apiBase}/api/cases/${encodeURIComponent(caseId)}/prepare-infinity-aol`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).catch(() => {});
      // Reload the diff (no re-sweep) — the applied rows should now be gone, confirming it stuck.
      $("apply").disabled = false; $("apply").style.display = "none";
      await load(true);
      setSub(diffs.length ? `✓ Applied. ${diffs.length} item(s) still differ.` : "✓ All changes applied to EasyFlow.");
      if (!diffs.length) $("body").innerHTML = '<div class="muted">✓ EasyFlow case updated from Infinity/AOL and re-prepared. Start now uses the new data. You can close this window.</div>';
    } catch (e) { setSub("Apply failed: " + e.message); $("apply").disabled = false; }
  }

  $("close").addEventListener("click", () => window.close());
  $("apply").addEventListener("click", apply);
  chrome.storage.local.get(["brokerToken", "apiBase"], (s) => {
    token = s.brokerToken || null;
    if (s.apiBase) apiBase = s.apiBase.replace(/\/$/, "");
    if (!token) { $("body").innerHTML = '<div class="muted">Sign in to the extension first, then reopen.</div>'; return; }
    load();
  });
})();
