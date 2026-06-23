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

  async function load() {
    if (!caseId) { $("body").innerHTML = '<div class="muted">No case selected.</div>'; return; }
    try {
      const r = await fetch(`${apiBase}/api/cases/${encodeURIComponent(caseId)}/reverse-sync`, { headers: { "x-easyflow-broker-token": token } });
      const j = await r.json().catch(() => ({}));
      diffs = (j && j.diffs) || [];
    } catch (_e) { $("body").innerHTML = '<div class="muted">Could not read changes.</div>'; return; }
    setSub(diffs.length ? `${diffs.length} change(s) found — tick the ones to apply.` : "No changes.");
    render();
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
      // Reload the diff — the applied rows should now be gone, confirming it stuck.
      $("apply").disabled = false; $("apply").style.display = "none";
      await load();
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
