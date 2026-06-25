// SnapJot background service worker (MV3)
// Flow: toolbar click → capture visible tab → inject content.js → send start msg

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab || !tab.id) return;

  try {
    // activeTab permission is granted by the toolbar click (user gesture)
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
      format: "png",
    });

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content.js"],
    });

    await chrome.tabs.sendMessage(tab.id, { type: "SNAPJOT_START", dataUrl });
  } catch (err) {
    console.warn("[SnapJot] capture failed:", err);
    // Protected pages (chrome://, web store, etc.) block injection/capture
    try {
      const msg = chrome.i18n.getMessage("restrictedPage");
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (m) => alert(m),
        args: [msg],
      });
    } catch (_) {
      /* even alert is blocked → ignore silently */
    }
  }
});
